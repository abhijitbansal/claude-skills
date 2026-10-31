# Harness findings (claude-skills), 2026-10-30

Phase A output of `2026-10-30-harness-learnings-design.md`. Each row is a counted
signal with session or PR references, a cost, the rule that already covers it and
a proposed home. No transcript text is quoted; guard messages and user turns are
described by category only.

## Method

Run date: 2026-10-31 (session logs up to and including that day; the live
authoring session is itself in the sweep, so refs under `wt/skills-improvement`
keep growing).

**Sources swept (measured at run time by the script):**

- Transcript directories matching `~/.claude/projects/-Users-abhijitbansal-projects-claude-skills*/`:
  21 matched, 20 included (one unrelated sibling directory with the suffix `-temp`
  excluded). Entries were kept only when `cwd` is the repo root or under
  `<root>/`; entries with no `cwd` inherit the last one seen in the file.
- 273 session files and 535 subagent files (`<uuid>/subagents/agent-*.jsonl`),
  2,384,402,443 bytes. 380,214 entries were in scope in 269 files; 38 entries
  that repeated an earlier `uuid` (resumed sessions) were skipped.
- 21 out-of-line `tool-results/*.txt` files of 160 KB or more (28,736,399 bytes),
  counted by size only, never read.
- Memory: the 11 files in the repo's project memory directory (read in full) and
  `~/.claude/harness-changelog.md`.
- PRs #40 to #50, one `gh pr view` call per PR (commit headlines, reviews,
  comments). Review objects exist only on #48 (0), #49 (0), #50 (2), #45 (1);
  every other PR has none, so fix-up commit headlines are the signal there.
  PR counts are by hand from those calls, and are recorded as constants in the
  script so `counts.json` covers every row.

**Script:** `.scratch/harness-finder/finder.py` (gitignored), run as
`python3 -I /Users/abhijitbansal/projects/claude-skills/.claude/worktrees/skills-improvement/.scratch/harness-finder/finder.py`
with no arguments. It streams each file line by line and writes
`.scratch/harness-finder/counts.json`: `{ "<signal>": { "<ref>": <count> } }`,
plus `_meta` and `_extra` side tables. The signal key of each row is in the
Signal column below.

**Predicate table (verbatim from the plan):**

| Signal | Predicate on an entry `e` |
|---|---|
| Guard refusal | `e.message.content[]` block with `type == "tool_result"` and `is_error == true` whose text starts with one of: `This session is isolated in the worktree` (worktree guard, built into Claude Code), `<tool_use_error>Blast Radius held` (Blast Radius mod), `Fact-Forcing Gate` or `GateGuard` as the first word (ecc GateGuard), `ui-input-guard` (`~/.claude/hooks/ui-input-guard.sh`). |
| Refusal then retry | guard refusal followed, within the next 3 assistant entries of the same session, by a `tool_use` with the same `name`. Count retries per guard. |
| Repeated command | within one session, 3 or more Bash `tool_use` blocks in any 10 consecutive assistant entries whose `input.command` share the same first two whitespace-separated tokens and are not identical. |
| User correction | a `user` entry whose `message.content` is a string (typed, not a tool result) matching `\b(no\|don't\|stop\|I said\|not what I\|again\|wrong)\b` case-insensitive, or any `tool_result` containing `The user doesn't want to proceed` or `doesn't want to take this action`. Report the count and the category only; never the text. |
| Dispatch with both knobs implicit | `tool_use` with `name` in `Agent`, `Task` and `input.model` absent or `input.effort` absent. |
| Redone dispatch | two `Agent`/`Task` `tool_use` blocks in one session with the same `input.description` or the same `input.subagent_type` and overlapping first 200 chars of `input.prompt`. |
| Subagent commit (trailer risk) | Bash `tool_use` whose `input.command` contains `git commit` in an entry with `isSidechain == true` or in a `subagents/agent-*.jsonl` file. |
| False completion claim | no transcript predicate; take these from the memory files, the changelog and PR fix-up commits, and say so in the row. |
| Unwrapped noisy output | Bash `tool_use` whose `input.command` first token is one of `bats`, `pytest`, `npm`, `node`, `shellcheck`, `xcodebuild`, `swift` and contains `\| head`, `\| tail` or `\| grep` (defeats the cartoon hook). |
| Large read | a `tool_result` block whose text is 40,000 chars or more, or a `tool-results/*.txt` file of 160 KB or more. Cost `tokens≈chars/4`. |
| Rule missed | any signal above with a non-`none` `Existing rule` column; the proposed home for these is enforcement or relocation, not a new sentence. |

**Deviations and caveats (read before trusting a number):**

- The guard-refusal "starts with" test is applied to the left-trimmed text. The
  subagent wording of the worktree guard ("This agent is isolated in the
  worktree") and the sleep guard (`<tool_use_error>Blocked: sleep`) were found
  by an error-prefix histogram and are counted as separate signals
  (`guard_worktree_agent`, `guard_sleep`). `GateGuard` and `ui-input-guard`
  produced no `is_error` match at all (see HF-08).
- "Retry" means a tool call with the same tool name (always `Bash` here) in the
  next 3 assistant entries. It is usually a rewritten command, not the identical
  one, so `retries=N` reads as "N extra round trips after a refusal", not "the
  same command sent N times".
- User correction counts only typed strings of 1,500 chars or fewer and not
  starting with `<`; longer typed turns are pasted briefs and inflate the
  predicate (266 uncapped vs 11 capped). Subagent files are excluded from this
  signal because their first turn is the dispatch prompt.
- Redone dispatch is reported but not trusted: the prompt-overlap arm fires on
  deliberate fan-out with a shared template (414 of 428 hits), so only the
  same-description arm (14) is a candidate.
- "Date split" columns use the memory file's date: events with timestamp on or
  after 2026-10-12 are "after the memory rule existed".
- Cost `tokens≈` is chars/4 of the tool results named in the row.
- Commit trailer counts come from the `git commit` command text in the
  transcript (an attempt), and from `git rev-list --count --all --grep=...` for
  history (measured, reachable commits only).

**Also seen, below the cut (no rows):**

- Dispatch with the `effort` knob missing: 276 of 703 dispatches, but 4 of 74
  since 2026-10-21 (signals `dispatch_no_effort`, `dispatch_no_effort_since_1021`);
  the model knob was missing on 4. The global dispatch rule is working; no edit.
- Typed user corrections: 11 in 7 sessions (category `no`: 9, `again`: 1, `wrong`: 1);
  denied tool calls: 7; interrupted turns: 8; auto-mode classifier denials: 16 in
  9 refs. Corrections are rare, so they do not drive any edit.
- Repeated similar Bash commands: 1,311 episodes by the plan predicate, but
  dominated by `cd <dir> &&` prefixes; with the prefix stripped, 997 episodes
  (`repeated_command_stripped`), led by inline `python3 -` scripts (196), `sed -n`
  slices (176) and `grep -n` (132). Heuristic, low confidence; nothing to edit
  without per-episode review.
- Piped output through head, tail or grep next to a noisy tool anywhere in a
  command (not only as the first token): 3,300 hits (`noisy_piped_loose`), too
  loose to act on; HF-06 uses the strict form.
- Read refused for size ("exceeds maximum", 14), Read of a missing path (19), call
  to a tool that is not available (19), teammate-pane send or create failures
  (29), edit on a stale file (8), edit before read (2), no-match edit (1),
  session-compass "no session" (9). Small and scattered.
- Hook non-blocking errors: 33 in 11 refs (`Stop` 16, `PostToolUse:Write` 12,
  `PostToolUse:Edit` 3); the hook behind them is not identified in the logs.
- Spilled tool outputs of 160 KB or more: 21 files, 28.7 MB, 13 sessions. They
  are not in context beyond a short preview, so no token cost is claimed.
- Fix-up commits per PR (headline starts `fix`): #40 13/47, #41 22/47, #43 6/23,
  #44 16/26, #46 3/6, #47 21/45, #48 5/5, #49 2/2, #50 4/9; #42 and #45 are
  one-commit PRs that were closed.
- Raw Bash non-zero exits: 547 (`err_exit_code`); expected noise from tests that
  were meant to fail.

## Session aliases

Alias is the transcript directory name with the prefix
`-Users-abhijitbansal-projects-claude-skills` removed. A ref is
`<alias>/<first 8 chars of session uuid>`; a subagent ref appends
`/agent-<id>`.

| alias | transcript dir (after the prefix) |
|---|---|
| `main` | (empty: the main checkout) |
| `wt/New-skills` | `--claude-worktrees-New-skills` |
| `wt/cache-tax-for-copilot` | `--claude-worktrees-cache-tax-for-copilot` |
| `wt/claude-mods` | `--claude-worktrees-claude-mods` |
| `wt/fix-vulnerability` | `--claude-worktrees-fix-vulnerability` |
| `wt/improve-skills` | `--claude-worktrees-improve-skills` |
| `wt/inspiration-to-motion` | `--claude-worktrees-inspiration-to-motion` |
| `wt/motion-improvement` | `--claude-worktrees-motion-improvement` |
| `wt/skills-improvement` | `--claude-worktrees-skills-improvement` (the live session) |
| `scratch-showcase`, `scratch-showcase-stories` | `--scratch-showcase`, `--scratch-showcase-stories` |
| `sub/<path>` | `-plugins-portable-artifacts...` (seven sessions started inside a plugin directory; no hits in any row) |
| `wt/<name>--superpowers-sdd-...`, `wt/motion-improvement-plugins-...` | two nested-directory variants of the worktree sessions above; no hits in any row |

## Findings

Ordered by cost, highest first. Count is measured by the script unless the Refs
column holds only `PR#nn` (then it is by hand). Refs list the five largest
per-ref counts; the full per-ref map is in `counts.json` under the signal key.

| ID | Signal | Count | Refs | Cost | Existing rule | Proposed home | Status |
|---|---|---|---|---|---|---|---|
| HF-01 | Large read, `large_read` | 130 | main/f601d050, main/bed33bab, main/bed33bab/agent-ad6ceeb141e056743, main/bed33bab/agent-a0cc02b515b707d80, main/c6ec0975/agent-a0eb2620ee0acc219 | tokens≈1574074 | none | AGENTS.md | edited (+4/-1) |
| HF-02 | Guard refusal then retry: worktree guard, `guard_worktree` | 241 | main/c6ec0975, main/c36539bd, main/e9097288, main/8b03aa8a/agent-a4d3519108ebcea31, main/f601d050 | retries=188 | memory `worktree-guard-refuses-eval-paths` | AGENTS.md | edited (shared with HF-04, HF-07: +9/-1 total) |
| HF-03 | Fix-up commits and late review finds, `pr_fixup_commits` | 92 | PR#41, PR#47, PR#44, PR#40, PR#43 | fixup-commits=92 | AGENTS.md "Branch & commit workflow" (pre-review gates) | AGENTS.md | edited (+11/-7) |
| HF-04 | Guard refusal then retry: Blast Radius hold, `guard_blastradius` | 94 | main/bed33bab, main/bd41599b, main/0d2d8518/agent-a43f0e00bbaf0fde1, main/bed33bab/agent-ab16e20ffc706582c, main/bed33bab/agent-adbfb7e7134869dbc | retries=88 | memory `worktree-guard-refuses-eval-paths` | AGENTS.md | edited (shared with HF-02: +9/-1 total, no separate lines) |
| HF-05 | Subagent commit with a session trailer, `commit_with_session_trailer_sidechain` | 57 | main/8b03aa8a/agent-a4d3519108ebcea31, main/802ac7c7/agent-a49e964f14247d21d, main/802ac7c7/agent-af57fdfcea0e28a21, main/802ac7c7/agent-a1a6afeca72766e74, main/802ac7c7/agent-a5cefc6b339e9ffdd | retries=57 | memory `subagent-commits-wrong-trailers`; AGENTS.md "Commit / PR trailers" | AGENTS.md | edited (+4/-1) |
| HF-06 | Unwrapped noisy output, `noisy_piped_strict` | 273 | main/c36539bd, main/c6ec0975, main/bed33bab, wt/motion-improvement/2ab5f862, main/8b03aa8a | tokens≈63704 | `~/.claude/CLAUDE.md` "Noisy CLI output: run bare, let cartoon wrap it" | ~/.claude/hooks/bash-guard.sh | open |
| HF-07 | Guard refusal then retry: foreground sleep block, `guard_sleep` | 15 | main/4165da11, main/c33995d6, main/c36539bd, main/f601d050, main/0d2d8518/agent-a042347f55b50098e | retries=13 | none | AGENTS.md | edited (shared with HF-02: +9/-1 total, no separate lines) |
| HF-08 | Stale rule: GateGuard memory, `marker_GateGuard` | 2 | main/ae5f1f65, main/f601d050 | tokens≈245 | memory `gateguard-write-retry` | prune:/Users/abhijitbansal/.claude/projects/-Users-abhijitbansal-projects-claude-skills/memory/gateguard-write-retry.md | open |
| HF-09 | Redone PR, `pr_redone` | 2 | PR#42, PR#45 | redone-PR | AGENTS.md "Branch & commit workflow" (work on the PR's own branch) | AGENTS.md | edited (+4/-3) |

### Row notes

Confidence is high where the count is a direct predicate hit and low where it
leans on a heuristic. Severity is the estimated cost to a future session.

**HF-01 (confidence high, severity high).** 130 tool results of 40,000 chars or
more, 128 of them from the `Read` tool, 6,296,296 chars in total. 5,279,971
chars (84%) sit in subagent files, 112 of 130 events came after 2026-10-11, and
101 distinct refs hit it, so it is spread out rather than one bad session. By
the file read: 87 events were `.diff` files, 34 were `.txt`, 5 `.md`, 2 `.html`
(extension tallies cover the 128 `Read` calls); 79 of those 128 passed no
`offset` or `limit`. Reading: reviewers and verifiers are handed a saved diff
and read it whole. The fix is in the review dispatch template: give the changed
file list plus a `git diff --stat`, and tell the reviewer to read hunks by
`offset`/`limit` or per file. No existing rule in `AGENTS.md`, `CLAUDE.md` or
`~/.claude` covers this; the global `performance.md` talks about context window
share in general only.

**HF-02 (confidence high on the count, medium on "retry", severity high).** 241
refusals by the worktree guard plus 5 by its subagent wording (`guard_worktree_agent`,
4 retries). 158 of 241 (66%) are in subagent files; 130 of 241 came after the
memory rule was written on 2026-10-11, so the rule is missed, not absent. The
refused command shapes (flags overlap): compound with `&&`, `;` or a pipe 234
of 240; a shell variable 139; `cd <dir> &&` first 112; a loop 104; a heredoc 98;
`/tmp` path 95; the word `eval` in a path 32. This is a rule that exists as a
memory but does not reach subagents or fresh sessions, so the home is the
dispatch preamble in `AGENTS.md`: one plain command, literal absolute paths, no
`cd`, no shell variables or loops, scripts via the Write tool. The guard itself
is covered in "Proposed, not built".

**HF-03 (confidence medium, severity medium).** 92 of 210 commits across the nine
PRs that carry work have a `fix` headline (measured by `gh pr view <n> --json
commits --jq` per PR). Not all of these are waste: part is normal fix-forward.
The review-driven part is visible in three PR bodies: #40 (second review round: 2
high, 2 medium-high), #48 and #49 (an independent review reproduced a HIGH bug
after local tests and CI were green; the owner's follow-up comment says each fix
has a test that failed on the old head). Signal `pr_late_review_high` is 1 for
each of #40, #48, #49. Proposed edit: in the pre-review gates, run the
fresh-context reviewer before the first push and require a failing-first
regression test per fix, so the finds land as one commit instead of a
follow-up wave. Review objects are sparse (see Method), so this row leans on
commit headlines and PR comments.

**HF-04 (confidence medium, severity medium).** 94 Blast Radius holds, every one
on a Bash command with `rm`; 76 mention `/tmp`, 73 use a shell variable, 55 start
with `cd`. 88 were followed by another Bash call within 3 entries (65 in subagent
files; 80 holds and 76 retries after 2026-10-11). The hold text says not to
retry unless the user asks, and the retried call is usually a rewrite, but the
round trip is the cost. The memory already says "never `rm -rf` a scratch dir,
`mkdir -p` over it"; the instruction should live in the same dispatch preamble as
HF-02. The hold itself is in "Proposed, not built".

**HF-05 (confidence medium, severity medium).** 66 `git commit` commands ran in
subagent files across 15 refs; 57 of them carry a `Claude-Session:` line in the
message and the same 57 a model-name `Co-Authored-By` line. `retries=57` is an
upper bound: the number of commits that would need an amend under the
`AGENTS.md` rule, not a measured amend count. Main sessions show the same
pattern: 306 commit commands with a session line (signal
`commit_with_session_trailer_main`), and in history 197 of 437 reachable commits
have a `Claude-Session:` line and 86 have a model-name trailer
(`git rev-list --count --all --grep=...`). `AGENTS.md` names the required trailer
but is silent on forbidding the session and model lines, and the harness
attribution text for the session adds them, so the two conflict. Proposed edit:
one sentence in "Commit / PR trailers" saying exactly one trailer, and that
implementers do not commit (the memory's content, relocated to where dispatch
prompts are written).

**HF-06 (confidence high on the count, low on the cost, severity medium).**
273 commands put `| head`, `| tail` or `| grep` after `bats`, `pytest`, `npm`,
`node` or `shellcheck` as the first token (node 203, bats 35, npm 25, pytest 6,
shellcheck 4); 189 came after 2026-10-11; 67 distinct refs. `tokens≈63704` is the
size of the sliced results, not waste; the real cost is the error line the slice
dropped, which the script cannot measure. A written rule exists and is missed
(`~/.claude/CLAUDE.md` "Noisy CLI output"), so the home is enforcement: a
PreToolUse warning on a piped noisy command. I did not read `bash-guard.sh`, so
whether it is the right file is unverified; the edit author decides. A hook
change needs a RED run. The cartoon plugin hook skips piped commands by design.

**HF-07 (confidence high, severity low).** 15 refusals with the foreground
`sleep` guard (the Bash tool points to Monitor or background runs), 13 followed
by another Bash call, 9 in subagent files, 10 after 2026-10-11. No rule in the
repo mentions it. One clause in the HF-02 dispatch preamble is enough.

**HF-08 (confidence medium, severity low; this is a prune).** The memory
`gateguard-write-retry` says the gate blocks the first Write or Edit per file and
first Bash per session. Across 808 transcript files the markers occur twice
total, in 2 sessions, and neither is an error result; no `Fact-Forcing Gate` or
`GateGuard` first-word refusal exists. Either the gate is off in this setup
(the memory itself mentions `ECC_GATEGUARD=off`) or it moved. The memory file is
982 bytes (tokens≈245) plus its index line, loaded every session. Verify the
current setting before deleting. Also `ui-input-guard` produced zero matches.

**HF-09 (confidence medium, severity low).** #42 was folded into #43 (closed, one
commit re-landed there with a plugin bump and a regenerated image); #45 was
closed and superseded by #46, which kept its commit unchanged and added the
review follow-ups. Both reworks cost a second PR, CI cycle and review. `AGENTS.md`
already tells reviewers to work on the PR's own branch (added in #46); the
remaining gap is to push follow-ups to the original PR branch where allowed
instead of opening a superseding PR. Low count, so the edit is one clause.

## Proposed, not built

Findings whose fix lives in Claude Code, a mod or a plugin. Not part of this
branch.

- **Worktree guard accepts `cd <path-inside-worktree> && <cmd>`** (from HF-02:
  112 of 240 refused commands start with `cd`). The guard is built into Claude
  Code.
- **Blast Radius hold allows `rm` on paths under a scratch directory** (from
  HF-04: all 94 holds are `rm` commands, 76 mention `/tmp`). The mod is edited in
  its source repo, not in the marketplace clone (memory
  `never-author-in-marketplace-clone`); the changelog entry of 2026-10-25 is the
  precedent for a quote-aware split.
- **A size warning on Read of a diff file** (from HF-01), or a review harness that
  passes diffs in chunks. Needs a product or hook change.
- **Find which hook raises the 33 non-blocking errors** on `Stop` and
  `PostToolUse:Write`, if it is a user hook.

## Footprint

Filled by Task 6: lines added and removed per edited file.

## Edits outside git

Filled by Task 4 and Task 5: `~/.claude` file, change, changelog heading.

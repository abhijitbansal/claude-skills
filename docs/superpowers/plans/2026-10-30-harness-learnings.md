# Harness Learnings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mine this repo's past sessions and PRs for counted waste, then make the smallest harness edits that remove it, each traced to a finding ID.

**Architecture:** Phase A is one finder dispatch that streams the session JSONL and PR history through a script and writes a findings doc with a fixed row format. Phase B applies the findings in three blast-radius groups (`AGENTS.md`; the `CLAUDE.md` guidelines block; `~/.claude`), each with its own acceptance check and commit. Phase C prunes stale rules and memory inside the group that owns them. The findings are unknown until Phase A runs, so Tasks 2–5 are templates: the same steps repeat per finding routed to that group, and a group with zero findings is closed with a one-line note in the findings doc.

**Tech Stack:** Python 3 (`json`, streaming per line) for the transcript sweep, `gh` for PR history, bats for the guidelines-block check, the existing `~/.claude/hooks/tests/test-*.sh` pattern for hook RED runs, `git`.

**Spec:** `docs/superpowers/specs/2026-10-30-harness-learnings-design.md`

## Global Constraints

- Findings doc path: `docs/superpowers/specs/2026-10-30-harness-findings.md`, committed.
- Each finding carries a count, at least one session or PR reference, the cost (retries, tokens, or a user correction) and a proposed home. Prefer the top ten or so by cost to a long tail.
- No raw transcript quotes anywhere in the findings doc or in an edit.
- No paths or names from other projects. A finding says "another repo's session", never a project name (see the Privacy constraint below). Cubby is published on purpose and may be named.
- Other projects' transcripts are not mined for content; other repos count only as context, such as how a guard behaved.
- Every harness edit cites a finding ID (`HF-nn`) in its commit subject. No edit is made "while we're here".
- Net-neutral or smaller instruction footprint is preferred: a finding that only needs a sentence moved gets the sentence moved. Prefer tightening an existing section to adding one.
- `CLAUDE.md` guidelines block: only lessons that hold in any repo; run `bats tests/bats` afterwards.
- Every `~/.claude` change has one entry in `~/.claude/harness-changelog.md`; every hook change has a proven RED run (shown firing on a bad input before it is trusted).
- No new plugins or skills, and no change to Claude Code itself: a finding that needs one is proposed in the findings doc, not built.
- Verify write access under `~/.claude` before Phase B group 3. If an `Edit` there is refused, write those edits as a patch in `.scratch/` and hand it to the owner. Do not route around the guard.
- Shared branch `worktree-skills-improvement`; execution order across sibling plans: KPI polish, then this plan, then make-motion parity. Run everything from `/Users/abhijitbansal/projects/claude-skills/.claude/worktrees/skills-improvement`.
- The orchestrating session runs every commit step itself; implementer subagents never commit (memory `subagent-commits-wrong-trailers`: they stamp their own trailers). `AGENTS.md` "Commit / PR trailers" wins: every commit message is a conventional commit and ends with exactly one trailer line, no `Claude-Session` line and no model name:

  ```
  Co-Authored-By: Claude <noreply@anthropic.com>
  ```

- Precondition: the orchestrator has already committed the three sibling plan docs (`docs/superpowers/plans/2026-10-30-*.md`) before any task runs, so they never show as untracked or modified in this plan's status checks.
- Dispatch routing: implementers are executor tier (Sonnet, effort `high`); the Task 1 finder is a breadth finder (executor, `medium`); phase and group reviewers are reviewer tier (Opus, effort `medium`), report-only, and each reviewer prompt carries the report-everything sentence from `~/.claude/rules/ecc/common/code-review.md` verbatim, plus "report only — never write session logs or project docs". The orchestrator applies the gate: CRITICAL or HIGH findings are fixed (a follow-up commit citing the same `HF-nn`) before the next group starts.
- Privacy (the repo is public; `tests/bats/no_private_names.bats` exempts `docs/superpowers/`): nothing in this plan, the findings doc or a PR body names another project. Say "another repo". Where a grep for private names is needed, it reads its patterns from the gitignored `.scratch/private-names.txt` (one extended-regex pattern per line: the pattern in `tests/bats/no_private_names.bats` plus the further names the owner supplies); the list is never inlined in a plan, doc or commit message.
- The worktree Bash guard refuses compound commands, loops feeding `git`/`gh`/`node`/`find`, shell variables in paths, and `/tmp` paths (memory `worktree-guard-refuses-eval-paths`). Every command in this plan is one plain command with literal absolute paths under the worktree or `~/.claude`; multi-step logic lives in a script written with the `Write` tool under `.scratch/` and run with no arguments, or with only the literal-path flags the step names.

## Review Focus

1. The finder returns a schema-valid findings doc whose rows are placeholders (count `1`, a made-up reference): the orchestrator must catch it before committing. Test: Task 1 steps 2–3 (row and source minimums; the three highest-cost rows are re-counted by an independent predicate script and match the finder's per-ref counts).
2. The findings doc leaks a private project name or a transcript quote because `tests/bats/no_private_names.bats` exempts `docs/superpowers/`: Task 1 step 4 greps the doc directly.
3. An `Edit` under `~/.claude` is refused after some group-3 edits already landed, and a patch made from "the remainder" leaves the owner with half a change: Task 4 step 1 snapshots every group-3 target before the first edit, so the patch is always the full diff.
4. A guidelines-block edit changes a section heading and breaks `setup.sh`'s additive merge (it skips sections already present by heading): Task 3 step 4 runs the four guideline tests in `tests/bats/setup.bats` by name.
5. A memory file is deleted but `MEMORY.md` still links it, or a new memory file is not indexed: Task 5 step 4 checks both directions.

---

### Task 1: Phase A — find, write and commit the findings doc

**Files:**
- Create: `docs/superpowers/specs/2026-10-30-harness-findings.md`
- Create (gitignored, not committed): `.scratch/harness-finder/finder.py` — the sweep script, written by the finder with the `Write` tool and run as `python3 -I /Users/abhijitbansal/projects/claude-skills/.claude/worktrees/skills-improvement/.scratch/harness-finder/finder.py` with no arguments.
- Read only: transcripts, memory, changelog, PRs (see Interfaces).

**Interfaces:**
- Consumes (sources, exact):
  - Transcripts: every directory matching `/Users/abhijitbansal/.claude/projects/-Users-abhijitbansal-projects-claude-skills*/`, except the one for the unrelated sibling project `claude-skills-temp`, which is excluded (the glob matches 21 dirs today including it; the finder records the real included-directory count as "measured at run time" in the Method section, never a fixed number). The main checkout dir holds 78 session files, 2.2 GB, so the script streams line by line and never loads a file whole. Session files are `<dir>/*.jsonl`; subagent transcripts are `<dir>/<session-uuid>/subagents/agent-*.jsonl`; out-of-line tool outputs are `<dir>/<session-uuid>/tool-results/*.txt` and are counted by byte size only, never read. Entries are kept only when `cwd == '/Users/abhijitbansal/projects/claude-skills'` or `cwd.startswith('/Users/abhijitbansal/projects/claude-skills/')` (segment-safe, so a `claude-skills-*` sibling never matches; worktrees live under `.claude/worktrees/` inside the root and pass). This is also the other-project filter.
  - Memory: `/Users/abhijitbansal/.claude/projects/-Users-abhijitbansal-projects-claude-skills/memory/*.md` (11 files incl. `MEMORY.md`) and `/Users/abhijitbansal/.claude/harness-changelog.md`.
  - PRs #40–#50, one `gh` call per number (never in a loop): `gh pr view <n> --json number,state,title,commits,reviews,comments`, `gh api repos/abhijitbansal/claude-skills/pulls/<n>/comments`, `gh api repos/abhijitbansal/claude-skills/pulls/<n>/reviews`. Known states: #42 and #45 CLOSED without merge (folded into #43 / superseded by #46 — each counts as a redone unit of work), #50 OPEN, the rest MERGED. PR #46 has zero review and zero comment objects, so the automated `claude-code-review.yml` output may not land as review objects: when a PR has none, record `no review objects` and use fix-up commit titles (`fix`, `supersedes`, `fold in`, `address review`, `amend`) as the signal.
- Produces: the findings doc, with this structure and row format, which Tasks 2–6 read and update:

  ```markdown
  # Harness findings (claude-skills), 2026-10-30
  ## Method        — sources swept, the predicate table below verbatim, the script path and invocation, date run
  ## Session aliases — table `alias | transcript dir` so refs stay short (e.g. `main`, `wt/New-skills`)
  ## Findings      — one row per finding, top ten or so by cost, highest cost first
  | ID | Signal | Count | Refs | Cost | Existing rule | Proposed home | Status |
  ## Proposed, not built — findings whose home is a plugin, a mod or Claude Code itself
  ## Footprint     — filled by Task 6: lines added/removed per edited file
  ## Edits outside git — filled by Task 4/5: `~/.claude` file, change, changelog heading
  ```

  Column rules: `ID` is `HF-01`, `HF-02`, … in cost order. `Count` is an integer (measured by the script, or by hand for PR rows, say which). `Refs` are `<alias>/<first 8 chars of session uuid>` or `PR#nn`, one or more, comma-separated; a subagent ref adds `/agent-<name>`. `Cost` is one of `retries=N`, `tokens≈N` (chars/4 of the wasted tool results), `user-correction×N`, `fixup-commits=N`, `redone-PR`. `Existing rule` is the file and heading of a rule that already covers the signal, or `none`. `Proposed home` is exactly one of: `AGENTS.md`, `CLAUDE.md guidelines`, `~/.claude/CLAUDE.md`, `~/.claude/rules/ecc/common/<file>`, `~/.claude/hooks/<file>`, `memory`, `prune:<path>` (a rule or memory file to shorten or delete), `proposed-not-built`. `Status` starts as `open`; Tasks 2–5 set it to `edited`, `pruned`, `patched` (in the `.scratch` patch), `proposed`, or `dropped: <reason>`; Task 6 appends the short sha of the commit whose subject carries the ID (`edited 1a2b3c4`). The commit subject's `(HF-nn)` is the trace; the sha is a convenience.

- Predicate table (signals as JSONL predicates, not string mentions — `GateGuard` and `cartoon` appear in over 1,200 files because hook and CLAUDE.md text is attached to every session; only events count):

  | Signal | Predicate on an entry `e` |
  |---|---|
  | Guard refusal | `e.message.content[]` block with `type == "tool_result"` and `is_error == true` whose text starts with one of: `This session is isolated in the worktree` (worktree guard, built into Claude Code), `<tool_use_error>Blast Radius held` (Blast Radius mod), `Fact-Forcing Gate` or `GateGuard` as the first word (ecc GateGuard), `ui-input-guard` (`~/.claude/hooks/ui-input-guard.sh`). |
  | Refusal then retry | guard refusal followed, within the next 3 assistant entries of the same session, by a `tool_use` with the same `name`. Count retries per guard. |
  | Repeated command | within one session, 3 or more Bash `tool_use` blocks in any 10 consecutive assistant entries whose `input.command` share the same first two whitespace-separated tokens and are not identical. |
  | User correction | a `user` entry whose `message.content` is a string (typed, not a tool result) matching `\b(no|don't|stop|I said|not what I|again|wrong)\b` case-insensitive, or any `tool_result` containing `The user doesn't want to proceed` or `doesn't want to take this action`. Report the count and the category only; never the text. |
  | Dispatch with both knobs implicit | `tool_use` with `name` in `Agent`, `Task` and `input.model` absent or `input.effort` absent. |
  | Redone dispatch | two `Agent`/`Task` `tool_use` blocks in one session with the same `input.description` or the same `input.subagent_type` and overlapping first 200 chars of `input.prompt`. |
  | Subagent commit (trailer risk) | Bash `tool_use` whose `input.command` contains `git commit` in an entry with `isSidechain == true` or in a `subagents/agent-*.jsonl` file. |
  | False completion claim | no transcript predicate; take these from the memory files, the changelog and PR fix-up commits, and say so in the row. |
  | Unwrapped noisy output | Bash `tool_use` whose `input.command` first token is one of `bats`, `pytest`, `npm`, `node`, `shellcheck`, `xcodebuild`, `swift` and contains `| head`, `| tail` or `| grep` (defeats the cartoon hook). |
  | Large read | a `tool_result` block whose text is 40,000 chars or more, or a `tool-results/*.txt` file of 160 KB or more. Cost `tokens≈chars/4`. |
  | Rule missed | any signal above with a non-`none` `Existing rule` column; the proposed home for these is enforcement or relocation, not a new sentence. |

- [ ] **Step 1: Dispatch the finder**

Dispatch one subagent, executor tier at effort `medium` (AGENTS.md dispatch matrix, "Breadth finders / reviewers": executor, medium; current mapping executor = Sonnet). Set both knobs explicitly. The prompt contains, in this order: the spec path and this task's Interfaces block (paste it; the finder has no other context), the privacy rules verbatim from Global Constraints, "Write the sweep as one Python script with the `Write` tool to `.scratch/harness-finder/finder.py` and run it with `python3 -I <absolute path>` and no arguments; never `Read` a `.jsonl` file and never pipe transcripts through `head`/`tail`; one `gh` command per Bash call", "Do not commit, push, or write any file other than the findings doc, the script and `.scratch/harness-finder/counts.json`" (a map `{ "<signal>": { "<ref>": <count> } }` of the per-ref counts behind every row, which Step 3 checks), and a structured return schema: `{ "path": string, "finding_ids": string[], "row_count": number, "sources_swept": { "session_files": number, "subagent_files": number, "prs": number[] } }`. Include the report-everything sentence from `~/.claude/rules/ecc/common/code-review.md` so the long tail reaches the doc's Method section as a one-line "also seen, below the cut" list without rows.

- [ ] **Step 2: Content sanity check on the return**

Reject and redispatch once (same prompt plus the rejection reason) if any of: `row_count < 5`, `sources_swept.session_files < 200`, `prs` is not `[40..50]`, any `finding_ids` entry is missing from the doc, or `.scratch/harness-finder/counts.json` is missing or has no entry for a row's signal.

- [ ] **Step 3: Verify three findings by hand**

A string grep proves nothing here (guard names sit in hook and `CLAUDE.md` text attached to every session, and count-only signals such as repeated command, large read and implicit-knob dispatch have no string at all). Re-run the predicate instead. For the three highest-cost rows, the orchestrator writes `.scratch/harness-finder/verify.py` with the `Write` tool, independent of `finder.py` (never imports it): constants at the top list, per row, the signal name and each ref's transcript file (`<dir>/<uuid>*.jsonl`, found with `ls <dir>` and the 8-char prefix); it parses the file line by line, applies that signal's predicate from the table above (for `is_error` signals: `tool_result` blocks with `is_error == true` and the listed text prefix; for count-only signals: the table's threshold), and prints `<ID> <ref> <count>`. Run: `python3 -I /Users/abhijitbansal/projects/claude-skills/.claude/worktrees/skills-improvement/.scratch/harness-finder/verify.py`. Expected: every printed count is at least 1, equals the finder's `counts.json` entry for that ref, and the per-ref counts sum to the row's `Count` (for PR rows, re-run the `gh` call by hand and compare). A mismatch or a ref that resolves to no file sends the row back to the finder with the reason (one more dispatch at most; otherwise mark the row `dropped: unverified`).

- [ ] **Step 4: Check privacy**

Run: `grep -n -i -w -E -f /Users/abhijitbansal/projects/claude-skills/.claude/worktrees/skills-improvement/.scratch/private-names.txt /Users/abhijitbansal/projects/claude-skills/.claude/worktrees/skills-improvement/docs/superpowers/specs/2026-10-30-harness-findings.md`
Expected: no output (exit 1). The pattern file is gitignored and supplied by the orchestrator (see the Privacy constraint); `tests/bats/no_private_names.bats` does not cover `docs/superpowers/`. If the file is missing the step stops: do not substitute an inline list.
Run: `grep -n '^>' /Users/abhijitbansal/projects/claude-skills/.claude/worktrees/skills-improvement/docs/superpowers/specs/2026-10-30-harness-findings.md`
Expected: no output (no blockquotes).
Run: `grep -n -o -E '/Users/abhijitbansal/projects/[A-Za-z0-9_.-]+' /Users/abhijitbansal/projects/claude-skills/.claude/worktrees/skills-improvement/docs/superpowers/specs/2026-10-30-harness-findings.md`
Expected: every match ends in `claude-skills` (no other project path). Then read the doc once for quoted strings longer than a few words; a quote is rewritten as a paraphrase before commit.

- [ ] **Step 5: Check the home column**

Every row's `Proposed home` is one of the eight allowed values. Rows naming the worktree guard, Blast Radius or GateGuard as the thing to change have home `proposed-not-built` (they live in Claude Code, a mod, and the ecc plugin; memory `never-author-in-marketplace-clone`). A row whose home is `~/.claude/rules/ecc/common/<file>` carries a note that the ecc installer may overwrite the file (changelog precedent 2026-10-21).

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-10-30-harness-findings.md
git commit -m "docs(harness): findings from claude-skills sessions and PRs 40-50" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

Note the short sha (`git rev-parse --short HEAD`): the group reviews in Tasks 2, 3 and 5 diff from it.

---

### Task 2: Phase B group 1 — `AGENTS.md` (blast radius: this repo)

**Files:**
- Modify: `AGENTS.md` (read it fresh: the KPI-polish plan runs first on this branch and may have touched it)
- Modify: `docs/superpowers/specs/2026-10-30-harness-findings.md` (Status column)

**Interfaces:**
- Consumes: findings rows with `Proposed home` = `AGENTS.md` or `prune:AGENTS.md#<heading>`.
- Produces: nothing other tasks depend on.

Repeat steps 1–4 per finding; one commit per finding; step 5 runs once per group. If no row routes here, add `Group 1 (AGENTS.md): no findings` under `## Footprint` and skip to Task 3.

- [ ] **Step 1: Place the edit**

Find the existing section the finding belongs to (`Agent behavior`, `Orchestration modes`, `Model routing & dispatch cost`, `Branch & commit workflow`, `Commit / PR trailers`). Tighten or move a sentence there; add a bullet only when no sentence covers the case; add a section never. A `prune:` row deletes or shortens the named text. Record the line delta (`+a/-b`) for the Status update.

- [ ] **Step 2: Scannability check**

Run: `wc -l /Users/abhijitbansal/projects/claude-skills/.claude/worktrees/skills-improvement/AGENTS.md`
Expected: not more lines than before the edit unless the finding row's Cost justifies it in the commit body; `grep -c '^## ' AGENTS.md` unchanged.

- [ ] **Step 3: Update the Status column**

Set the row's `Status` to `edited` (or `pruned`) in the findings doc; it goes in the same commit as the `AGENTS.md` change. Task 6 appends the sha.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md docs/superpowers/specs/2026-10-30-harness-findings.md
git commit -m "docs(agents): <one-line change> (HF-nn)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

- [ ] **Step 5: Group review (once, after the last finding's commit)**

Dispatch one reviewer (Opus, effort `medium`, report-only; Global Constraints "Dispatch routing") scoped to `git diff <Task 1 sha>..HEAD -- AGENTS.md`. Prompt: the diff command, each edited finding row, and "check that every changed line traces to its `HF-nn` row, that no instruction contradicts another section of `AGENTS.md`, that no command or script named exists, and that nothing was added where a sentence could have been moved". The prompt carries the report-everything sentence verbatim. The orchestrator applies the gate; fixes are follow-up commits citing the same `HF-nn`. Skip with the findings-doc note when the group had no findings.

---

### Task 3: Phase B group 2 — `CLAUDE.md` guidelines block (blast radius: every repo `setup.sh` merges into)

**Files:**
- Modify: `CLAUDE.md` lines 33–80 only (between `<!-- claude-skills:guidelines:begin -->` and `<!-- claude-skills:guidelines:end -->`)
- Test: `tests/bats/setup.bats` (existing tests; one new test only when a finding adds a `##` section, see Step 3)
- Modify: `docs/superpowers/specs/2026-10-30-harness-findings.md` (Status column)

**Interfaces:**
- Consumes: findings rows with `Proposed home` = `CLAUDE.md guidelines` or `prune:CLAUDE.md#<heading>`.
- Produces: nothing other tasks depend on.

Repeat steps 1–5 per finding; one commit per finding; step 6 runs once per group. Zero rows: note `Group 2 (guidelines): no findings` under `## Footprint`.

- [ ] **Step 1: Confirm the lesson holds in any repo**

The row's Signal must not depend on this repo's tooling (bats, sweep counts, portable-artifacts). If it does, re-route the row to `AGENTS.md` (Task 2) and set Status `dropped: repo-specific, moved to HF-nn/AGENTS.md`.

- [ ] **Step 2: Decide propagation**

`setup/merge_guidelines.py` is additive by section heading: it adds missing `##` sections and skips sections already present (`setup.bats` test "guidelines step is additive"). So an edit inside an existing section reaches this repo and repos set up in future, not repos already set up. If the finding's cost comes from already-set-up repos, the edit must be either a new `##` section (reaches them on the next `setup.sh` run) or a `~/.claude` home (Task 4); write the choice in the commit body.

- [ ] **Step 3: Place the edit**

Default: edit the sentence inside the existing section (`Think before coding`, `Simplicity first`, `Surgical changes`, `Goal-driven execution`); keep the heading text byte-identical. Record the line delta.

A new `##` section is permitted only when Step 2 found the cost comes from already-set-up repos and no existing heading fits the lesson. Then add it at the end of the block (before the `end` marker), same style as its neighbours (a heading, one sentence, a few bullets), and add this test to `tests/bats/setup.bats` first, named "setup.sh guidelines step adds a newly introduced section to an existing CLAUDE.md": mirror the "additive" test (write a `${HOME}/CLAUDE.md` that lacks the new heading, run `--only guidelines`, assert `grep -q "^## <new heading>"` and that the existing content is intact). Run it before adding the section to `CLAUDE.md`. Expected: FAIL (the heading is not in the repo guidelines yet). Add the section, run again. Expected: PASS. No new section without this test.

- [ ] **Step 4: Run the guidelines tests, then the full suite**

Run: `bats /Users/abhijitbansal/projects/claude-skills/.claude/worktrees/skills-improvement/tests/bats/setup.bats`
Expected: all pass, including "setup.sh --only guidelines creates ~/CLAUDE.md from the repo guidelines when none exists", "setup.sh guidelines step is additive: keeps existing content, skips sections already present", "setup.sh guidelines step is idempotent", "setup.sh --merge-claude-md merges guidelines into an explicit path".
Run: `bats /Users/abhijitbansal/projects/claude-skills/.claude/worktrees/skills-improvement/tests/bats`
Expected: all pass (run bare; the cartoon hook wraps the output).

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-10-30-harness-findings.md
git commit -m "docs(guidelines): <one-line change> (HF-nn)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

(A finding that adds a section stages `tests/bats/setup.bats` too.)

- [ ] **Step 6: Group review (once, after the last finding's commit)**

Dispatch one reviewer (Opus, effort `medium`, report-only; Global Constraints "Dispatch routing") scoped to `git diff <Task 1 sha>..HEAD -- CLAUDE.md tests/bats/setup.bats`. Prompt: the diff command, each edited finding row, and "check that every lesson holds in any repo, that every section heading outside the edit is byte-identical, that a new section (if any) has its test and RED evidence, and that no guideline contradicts another". The prompt carries the report-everything sentence verbatim. The orchestrator applies the gate; fixes are follow-up commits citing the same `HF-nn`. Skip when the group had no findings.

---

### Task 4: Phase B group 3 — `~/.claude` global CLAUDE.md, rules and hooks (blast radius: every project on this machine)

**Files:**
- Modify (outside git): `/Users/abhijitbansal/.claude/harness-changelog.md`, and per finding one of `/Users/abhijitbansal/.claude/CLAUDE.md`, `/Users/abhijitbansal/.claude/rules/ecc/common/<file>.md`, `/Users/abhijitbansal/.claude/hooks/<hook>.sh|.py`
- Test (outside git): `/Users/abhijitbansal/.claude/hooks/tests/test-<hook>.sh` (existing pattern: `test-ui-input-guard.sh`, `test-design-nudge.sh`; `jq`-built PreToolUse payload piped to the hook, exit code asserted)
- Create (gitignored): `.scratch/harness-learnings-home/before/` (snapshot), `.scratch/harness-learnings-home/after/`, `.scratch/harness-learnings-home.patch` (fallback only)
- Modify: `docs/superpowers/specs/2026-10-30-harness-findings.md` (Status, `## Edits outside git`)

**Interfaces:**
- Consumes: findings rows with `Proposed home` in `~/.claude/CLAUDE.md`, `~/.claude/rules/ecc/common/<file>`, `~/.claude/hooks/<file>`, or `prune:` of one of those.
- Produces: `## Edits outside git` rows `| file | change | changelog heading | HF-nn |` that Task 6 copies into the PR body; `.scratch/harness-learnings-home.patch` when access is refused.

Zero rows: note `Group 3 (~/.claude): no findings` under `## Footprint` and skip to Task 5, which runs the Step 2 access probe itself if it has rows.

- [ ] **Step 1: Snapshot every target before the first edit**

For each file a group-3 row names (for a hook row, the hook and its `test-<hook>.sh`), plus `harness-changelog.md`: `cp <absolute source> /Users/abhijitbansal/projects/claude-skills/.claude/worktrees/skills-improvement/.scratch/harness-learnings-home/before/<basename>` (one `mkdir -p` then one `cp` per file). The patch in step 7, if needed, is the full diff against this snapshot, never "the remainder".

- [ ] **Step 2: Probe write access with the changelog heading (the first real edit)**

`Edit` `/Users/abhijitbansal/.claude/harness-changelog.md`: insert, after the intro paragraph and before the newest existing dated `## 2026-…` heading (newest first; `Read` shows it), the heading `## 2026-10-30: claude-skills harness learnings` and one line: `Origin: findings doc docs/superpowers/specs/2026-10-30-harness-findings.md in abhijitbansal/claude-skills (branch worktree-skills-improvement). One bullet per change below; each names its finding ID.`
`Read` the file first (the `Edit` tool refuses a file not read in this session; that error is not a refusal). Three outcomes:
- The Edit succeeds: group 3 proceeds live.
- ECC GateGuard blocks it (a "Fact-Forcing Gate" message asking for facts): state the four facts and retry the identical call once (memory `gateguard-write-retry`); this is the gate's block-then-retry design, not a denial. A second block counts as refused.
- A permission denial, a worktree-isolation message, or a Blast Radius hold: refused. Stop editing under `~/.claude`, record `write access: refused — <first line of the refusal>` under `## Edits outside git`, and do every group-3 and Task 5 edit in step 7's patch flow instead. Do not retry with a different tool, path or wording.

- [ ] **Step 3: Per finding — place the edit (repeat 3–6 per row)**

Text homes (`~/.claude/CLAUDE.md`, `rules/ecc/common/*.md`): tighten the existing sentence under the heading the row's `Existing rule` column names; a `prune:` row shortens or deletes. For `rules/ecc/common/*` the changelog bullet ends with `The ecc installer may overwrite this file; re-add if the change disappears.` Hook homes: do not touch the hook yet; step 4 writes the test first.

- [ ] **Step 4: Hook change — test first, prove RED, then change the hook**

First make the test overridable. The existing tests hardcode the hook path (`HOOK="$HOME/.claude/hooks/ui-input-guard.sh"` at line 18 of `test-ui-input-guard.sh`, `HOOK="$HOME/.claude/hooks/design-nudge.sh"` at line 6 of `test-design-nudge.sh`), which silently overrides any `HOOK` in the environment: change that line to `HOOK="${HOOK:-$HOME/.claude/hooks/<hook>.sh}"` (a new test is created that way). Without this, a patch-mode run would test the live, unchanged hook and the RED/GREEN evidence would be false.
Then add one case to `/Users/abhijitbansal/.claude/hooks/tests/test-<hook>.sh` (create it in the `test-ui-input-guard.sh` form if the hook has none: `jq`-built PreToolUse payload, `run_hook` returns the exit code, PASS/FAIL tally) with the bad input the finding describes (expected exit `2`, a PreToolUse deny) and one good input that must stay allowed (expected exit `0`).
Run: `bash /Users/abhijitbansal/.claude/hooks/tests/test-<hook>.sh`
Expected: the new bad-input case FAILS (the unchanged hook lets it through). Now edit the hook. Run again.
Expected: all cases PASS, including every pre-existing case. The changelog bullet records both runs: `RED: <case> failed on the old hook; GREEN: N/N after.` A hook that was not shown failing on the old version does not ship.

- [ ] **Step 5: Changelog bullet**

Under the new heading, one bullet per change: `- <file>: <what changed>. **Why:** <finding ID and one sentence>.` plus the RED/GREEN line for hooks.

- [ ] **Step 6: Record the edit in the findings doc**

Append a row to `## Edits outside git` and set the finding's Status to `edited (home)`; commit the findings doc:

```bash
git add docs/superpowers/specs/2026-10-30-harness-findings.md
git commit -m "docs(harness): record ~/.claude edit for HF-nn" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

- [ ] **Step 7: Fallback when access is refused — build the patch**

Copy each `before/` file to `after/<basename>`, apply every group-3 edit (steps 3–5 content, including the changelog heading and bullets, and the hook test cases) to the `after/` copies with `Edit`, then write the patch with one command per file pair, appending, with labels relative to the home directory so the owner can apply it with `-p1`: `diff -u -L a/<path relative to /Users/abhijitbansal> -L b/<same> /Users/abhijitbansal/projects/claude-skills/.claude/worktrees/skills-improvement/.scratch/harness-learnings-home/before/<basename> /Users/abhijitbansal/projects/claude-skills/.claude/worktrees/skills-improvement/.scratch/harness-learnings-home/after/<basename> >> /Users/abhijitbansal/projects/claude-skills/.claude/worktrees/skills-improvement/.scratch/harness-learnings-home.patch` (for example `-L a/.claude/CLAUDE.md -L b/.claude/CLAUDE.md`; diff exits 1 when files differ, which is the expected result). For a hook, the `after/` copy of the test already carries the `HOOK="${HOOK:-…}"` change from Step 4. RED: run the `after/` test with `HOOK` pointing at the `before/` hook copy (the old hook): `env HOOK=<before hook path> bash <after test path>` is one command; expected: the new bad-input case FAILS. GREEN: `env HOOK=<after hook path> bash <after test path>`; expected: all cases PASS. Record both in the changelog bullet in `after/harness-changelog.md`. Set each Status to `patched`. The `## Edits outside git` section gets the line: `Owner applies: patch -p1 -d /Users/abhijitbansal < <absolute patch path>` with the file list, and the PR body says the same (Task 6).

---

### Task 5: Phase C — memory prune and `MEMORY.md` index (blast radius: this repo's sessions; lives under `~/.claude`)

**Files:**
- Modify/Delete (outside git): `/Users/abhijitbansal/.claude/projects/-Users-abhijitbansal-projects-claude-skills/memory/*.md`, `.../memory/MEMORY.md`
- Modify (outside git): `/Users/abhijitbansal/.claude/harness-changelog.md` (same heading as Task 4)
- Create (gitignored): `.scratch/harness-learnings-home/check_memory_index.py`, `.scratch/harness-learnings-home/red-fixture/`, and in patch mode `before/memory/` and `after/memory/`
- Modify: `docs/superpowers/specs/2026-10-30-harness-findings.md`

**Interfaces:**
- Consumes: rows with home `memory` or `prune:<memory file>`, and any Task 2–4 edit that makes a memory file redundant (the finding row says which file in its `Existing rule` column).
- Produces: `## Edits outside git` rows for Task 6.

Zero rows from every source (including edits that make a memory file redundant): note `Group 3 (memory): no findings` under `## Footprint` and skip to Task 6.

Write access: if Task 4 ran, its Step 2 result applies here (same `~/.claude` tree, same three outcomes: `Read` before `Edit`, one GateGuard retry, anything else is refused). If Task 4 was skipped for zero rows, the probe has not run: do Task 4 Step 2 now (insert the `## 2026-10-30: claude-skills harness learnings` changelog heading) and treat its outcome the same way. Refused → the `before/`/`after/` patch flow from Task 4 Step 7, with memory files included in the patch under `before/memory/` and `after/memory/` (the full memory directory is copied into both, so the index check sees the complete set; patch labels are `a/.claude/projects/-Users-abhijitbansal-projects-claude-skills/memory/<file>`).

- [ ] **Step 1: Write and prove the index check, then list the memory files the edits made redundant**

Write `/Users/abhijitbansal/projects/claude-skills/.claude/worktrees/skills-improvement/.scratch/harness-learnings-home/check_memory_index.py` with the `Write` tool now (contract in step 4). Prove it fires before trusting it: write a fixture directory `.scratch/harness-learnings-home/red-fixture/` with the `Write` tool holding a `MEMORY.md` that links `missing.md` and a stray `orphan.md` that `MEMORY.md` does not link.
Run: `python3 -I /Users/abhijitbansal/projects/claude-skills/.claude/worktrees/skills-improvement/.scratch/harness-learnings-home/check_memory_index.py --dir /Users/abhijitbansal/projects/claude-skills/.claude/worktrees/skills-improvement/.scratch/harness-learnings-home/red-fixture`
Expected: names both `missing.md` and `orphan.md` and exits 1.

Then, before any edit, in patch mode copy the whole memory directory into `before/memory/` and `after/memory/` (one `mkdir -p`, one `cp -R <memory dir>/. <dest>` each); in live mode copy it to `before/memory/` for the footprint count.

For each Task 2–4 edit, if the lesson now lives in `AGENTS.md`, `CLAUDE.md` or `~/.claude`, the memory file that carried it is redundant: shorten it to a one-line pointer to the new home (keep the frontmatter) or delete it when nothing else in it survives. Decide per file and write the decision in the changelog bullet.

- [ ] **Step 2: Apply the row's edit**

`memory` rows add or update a file in the existing frontmatter form (`name`, `description`, `metadata.node_type`, `metadata.type`); `prune:` rows shorten or delete.

- [ ] **Step 3: Update `MEMORY.md`**

One index line per remaining file, in the existing form `- [Title](file.md) — one-line gist`; remove lines for deleted files.

- [ ] **Step 4: Check the index both ways**

`check_memory_index.py --dir <absolute directory>` (written and proven in step 1; `--dir` is required and any other argument is rejected with the accepted list) reads `<dir>/MEMORY.md`, collects every `](<name>.md)` target, asserts each exists in the directory, and asserts every `*.md` in the directory other than `MEMORY.md` is linked; prints `ok` or the offending names and exits 1.
Run after step 3, live mode: `python3 -I /Users/abhijitbansal/projects/claude-skills/.claude/worktrees/skills-improvement/.scratch/harness-learnings-home/check_memory_index.py --dir /Users/abhijitbansal/.claude/projects/-Users-abhijitbansal-projects-claude-skills/memory`
Patch mode: the same command with `--dir /Users/abhijitbansal/projects/claude-skills/.claude/worktrees/skills-improvement/.scratch/harness-learnings-home/after/memory`.
Expected: `ok`. The RED evidence is the step 1 fixture run, which fires whether or not this batch adds or deletes a file; a shorten-only batch leaves the index valid and is not expected to fail.

- [ ] **Step 5: Changelog bullets and findings doc, then commit**

One changelog bullet per memory change under the Task 4 heading (`- memory/<file>: deleted|shortened|added. **Why:** HF-nn ...`). Append rows to `## Edits outside git`, set Status, commit:

```bash
git add docs/superpowers/specs/2026-10-30-harness-findings.md
git commit -m "docs(harness): record memory prune for HF-nn" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

- [ ] **Step 6: Group 3 review (once, covering Task 4 and Task 5 edits)**

Dispatch one reviewer (Opus, effort `medium`, report-only; Global Constraints "Dispatch routing"). Scope: live mode, each edited `~/.claude` file against its `before/` snapshot (`diff -u <before path> <live path>`, one command per file) plus the changelog section; patch mode, `.scratch/harness-learnings-home.patch` and the `after/` tree. Prompt: the scope, the `## Edits outside git` rows, and "check that every changed line traces to an `HF-nn` row, that every hook change has a RED run on the old hook and a GREEN run after (and that the run really exercised the intended hook, not the live one), that each change has exactly one changelog bullet, that `rules/ecc/common/*` bullets carry the installer-overwrite note, that no deleted memory file is still indexed, and that nothing from another project is named". The prompt carries the report-everything sentence verbatim. The orchestrator applies the gate; fixes are applied the same way as the original edit (live or in the patch) and re-logged. Skip when group 3 had no findings.

---

### Task 6: Close-out — trace audit, footprint, PR-body block

**Files:**
- Modify: `docs/superpowers/specs/2026-10-30-harness-findings.md` (`## Footprint`, `## Proposed, not built`, Status column complete)
- Read: `git log`

**Interfaces:**
- Consumes: everything Tasks 1–5 wrote.
- Produces: the `## Edits outside git` and `## Proposed, not built` sections in a form the PR author pastes into the PR body (the spec's "Decided" bullet: `~/.claude` edits are not in git, so the PR body lists them with their changelog entries).

- [ ] **Step 1: Every row has a terminal status**

Run: `grep -c '| open |' /Users/abhijitbansal/projects/claude-skills/.claude/worktrees/skills-improvement/docs/superpowers/specs/2026-10-30-harness-findings.md`
Expected: `0`. Rows with home `proposed-not-built` have Status `proposed` and a one-paragraph entry under `## Proposed, not built` naming the component (plugin, mod, Claude Code) and the change it would need.

- [ ] **Step 2: Every harness edit cites a finding**

Run: `git log --format=%s 23778e2..HEAD -- AGENTS.md CLAUDE.md`
Expected: every subject line contains `HF-`, except commits from the sibling KPI-polish plan (scope `explainer`/`portable-artifacts`), which run first on this branch; list any such subject under `## Footprint` as `sibling plan, not a harness edit`. (`23778e2` is the branch tip before the three sibling plans started.) Then check the changelog with a script, not a bare `grep -c` (a count includes `HF-` text elsewhere in the file, continuation lines, and bullets that cover several IDs). Write `.scratch/harness-learnings-home/check_changelog.py` with the `Write` tool: `--changelog <absolute file> --findings <absolute findings doc>`, other arguments rejected with the accepted list. It reads only the bullets (lines starting `- `) under the `## 2026-10-30: claude-skills harness learnings` heading up to the next `## `, fails if any bullet has no `HF-nn`, then compares the set of IDs in those bullets with the set of IDs in the `## Edits outside git` rows; prints `ok` or the IDs missing on either side and exits 1.
Prove it fires first: write `.scratch/harness-learnings-home/red-changelog.md` with the `Write` tool (the heading and one bullet without an ID) and run the script with `--changelog` on it. Expected: exit 1 naming the bullet.
Run (live mode): `python3 -I /Users/abhijitbansal/projects/claude-skills/.claude/worktrees/skills-improvement/.scratch/harness-learnings-home/check_changelog.py --changelog /Users/abhijitbansal/.claude/harness-changelog.md --findings /Users/abhijitbansal/projects/claude-skills/.claude/worktrees/skills-improvement/docs/superpowers/specs/2026-10-30-harness-findings.md`
Patch mode: the same with `--changelog /Users/abhijitbansal/projects/claude-skills/.claude/worktrees/skills-improvement/.scratch/harness-learnings-home/after/harness-changelog.md`.
Expected: `ok`. Skip this run when groups 3 and memory both had no findings.

- [ ] **Step 2b: Re-run the privacy checks on the final doc**

Tasks 4–6 appended sections that Task 6 step 5 copies into a public PR body. Run the three greps from Task 1 step 4 again on the findings doc.
Expected: no private name, no blockquote, no non-`claude-skills` project path.

- [ ] **Step 3: Footprint**

Run: `git diff --numstat 23778e2..HEAD -- AGENTS.md CLAUDE.md`
Record `added removed file` per line under `## Footprint`, plus the `wc -l` before/after of each edited `~/.claude` file (from `before/` vs live or `after/`). Write one sentence: net lines across all harness files, and whether the footprint is net-neutral or smaller as the spec prefers; if it grew, name the finding IDs that justify it.

- [ ] **Step 4: Guidelines block still green and tree clean**

Run: `bats /Users/abhijitbansal/projects/claude-skills/.claude/worktrees/skills-improvement/tests/bats`
Expected: all pass.
Run: `git status --short`
Expected: only the findings doc modified (before the commit below); nothing under `.scratch/` is tracked. The three sibling plan docs do not appear: the orchestrator committed them before any task ran (Global Constraints, Precondition). If they appear as untracked or modified, stop and report; do not stage them in this commit.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-10-30-harness-findings.md
git commit -m "docs(harness): close out findings with footprint and out-of-git edits" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

The PR for the shared branch copies `## Edits outside git` (file, change, changelog heading, and the `patch -p1 -d /Users/abhijitbansal` line if access was refused) and `## Proposed, not built` into its body under a `Harness learnings` heading.

---

## Self-review notes

- Spec coverage: Sources 1–3 → Task 1 Interfaces; "What to look for" → the predicate table (false completion claims have no automatic predicate and the row says so); Phase A → Task 1; Phase B rows → Tasks 2, 3, 4; Phase C → Task 5 (memory) and the `prune:` home handled inside Tasks 2–4; Goals → Task 6 checks; Non-goals → `proposed-not-built` home and Task 1 step 5; Decided bullets → Task 4 steps 1–2 and 7, Task 6 step 5.
- Gaps carried to the spec author (not resolvable in a plan): see the orchestrator's report. Defaults taken here: the finder script stays gitignored in `.scratch/` and the findings doc records the predicate table and invocation so counts are reproducible from the doc; commit trailers follow `AGENTS.md` "Commit / PR trailers" (one `Co-Authored-By: Claude <noreply@anthropic.com>` line). The harness plan never touches the plugin `CHANGELOG`. Spec Phase B's "each group is reviewed separately" → Task 2 step 5, Task 3 step 6, Task 5 step 6.

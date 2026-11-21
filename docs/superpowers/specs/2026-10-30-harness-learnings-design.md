# Harness learnings: mine past sessions, make future ones cheaper

Date: 2026-10-30. Branch: `worktree-skills-improvement`. Shares one branch and one
PR with the explainer-KPI and make-motion parity specs (same date).

## Intent

The owner wants future agent sessions to go faster and waste less, using what
past sessions taught. That covers this repo's sessions and the owner's
user-level harness. The findings are not known yet, so this spec defines the
method and what counts as done. It does not define the edits.

## Sources (owner's pick: all three)

1. **This repo's transcripts.** The session logs under
   `~/.claude/projects/-Users-abhijitbansal-projects-claude-skills*/` (the main
   checkout and its worktrees).
2. **Memory and changelog.** The memory files in
   `~/.claude/projects/-Users-abhijitbansal-projects-claude-skills/memory/` and
   `~/.claude/harness-changelog.md`.
3. **PR review history.** Review comments and fix-up commits on PRs #40–#50
   (`gh pr view`, `gh api`).

## What to look for

Concrete, countable waste. Each signal is a pattern to search for, not a
finished finding:

- Tool calls refused by a guard (worktree guard, GateGuard, Blast Radius,
  ui-input-guard), and then retried.
- The same command run several times with small changes before it worked.
- User corrections: "no", "don't", "stop", "I said", a re-asked question, a
  denied tool call.
- Subagent dispatches that were redone, ran on the wrong model or effort tier,
  had bad trailers, or made false completion claims.
- Fix-up commits and review findings that repeat across PRs.
- Context spent on large reads or unwrapped noisy output (CLAUDE.md's cartoon
  rule).
- Rules that exist but kept getting missed. These need to be found faster or
  enforced, not written again.

## Phases

**A. Find.** A finder dispatch scans transcripts and PRs and writes a findings
doc. The transcripts are large, so this runs at executor or chore tier. Each
finding carries a count, at least one session or PR reference, the cost
(retries, tokens, or a user correction) and a proposed home. No raw transcript
quotes. No paths from other projects. A finding says "another repo's session",
never by name. The findings doc goes to
`docs/superpowers/specs/2026-10-30-harness-findings.md` and is committed.

**B. Edit.** Each edit traces to a finding by its ID. Edits are grouped by blast
radius, and each group is reviewed separately:

| Target | Blast radius | Extra rule |
|---|---|---|
| `AGENTS.md` | this repo only | Keep it scannable; prefer tightening an existing section to adding one. |
| `CLAUDE.md` guidelines block | `setup/setup.sh` merges it into other repos | Only lessons that hold in any repo. Run `bats tests/bats` afterwards. |
| `~/.claude` (global `CLAUDE.md`, `rules/`, hooks, memory) | every project on this machine | One entry per change in `~/.claude/harness-changelog.md`. A hook change must be shown firing on a bad input before it is trusted (agent-autonomy: guardrails must prove they fire). |

**C. Prune.** Where a finding shows that a rule is stale, wrong or duplicated,
fix or remove it in the same group. Memory files that the edits make redundant
are updated or deleted, and `MEMORY.md` is updated with them.

## Goals

- A committed findings doc with counted, referenced findings.
- Every harness edit cites a finding ID. No edit is made "while we're here".
- A net-neutral or smaller instruction footprint is preferred. A finding that
  only needs a sentence moved gets the sentence moved.
- Each `~/.claude` change has a changelog entry, and each hook change has a
  proven RED run.

## Non-goals

- Mining other projects' transcripts for content. Other repos count only as
  context, such as how a guard behaved.
- New plugins or skills. If a finding calls for one, it is proposed in the
  report, not built.
- Changing Claude Code itself, or anything that needs a product change.

## Decided

- Sources: all three (owner).
- Write scope: the repo plus `~/.claude` (owner). Edits under `~/.claude` are
  not in git, so the PR body lists them along with their changelog entries.
- **Verify write access first** (this session's call). This session is
  isolated to a worktree. Before Phase B group 3, confirm that an `Edit` under
  `~/.claude` is allowed. If it is not, the plan writes those edits as a
  patch file in the repo's `.scratch/` and hands it to the owner to apply. The
  plan does not route around the guard.

## Left to the builder

- The finder's search strategy and tooling (grep over JSONL, `jq`, a small node
  script in the scratchpad).
- How many findings make the cut. Prefer the top ten or so by cost to a long
  tail.
- The wording and placement of each edit.

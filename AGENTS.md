# AGENTS.md — claude-skills conventions

The engineering guide for **claude-skills**, for human contributors and AI
coding agents (Claude Code, Cursor, Codex, …). [`CLAUDE.md`](./CLAUDE.md)
points here and instructs Claude Code to read this file before dispatching
subagents or opening a PR (it is not auto-loaded into context); other tools
read it directly.
`CLAUDE.md` remains the source of truth for the **behavioral guidelines** (the
`claude-skills:guidelines` block merged into other repos by
`setup/merge_guidelines.py`) — this file covers **process**: orchestration,
model routing, and the branch/commit/CI workflow. Where the two overlap,
CLAUDE.md wins on behavioral guidelines; this file wins on process.

This file is adapted from the portable Part 2 of Cubby's `AGENTS.md`. Cubby's
process is battle-tested; the claude-skills adaptations below swap Cubby's
solo-developer / on-device-testing gate for this repo's **PR + CI gate** and
drop Cubby-specific ceremony (SwiftData, `project.yml`, device checklists) that
doesn't apply to a plugin/skill monorepo.

---

## Repo shape (what agents touch)

- **Plugins** live under `plugins/<name>/` (skills, commands, hooks, agents);
  the machine bootstrap is `setup/setup.sh`, driven by `claude-setup.toml`.
- **Tests** are bats under `tests/bats/` and pytest under `tests/pytest/`.
  Run `bats tests/bats` after touching anything in `setup/` or a skill's
  shell scripts.
- **CI** (`.github/workflows/test.yml`) runs on every PR across macOS +
  Ubuntu: plugin-manifest validation, `shellcheck`, `bats`, `pytest`. A second
  workflow (`claude-code-review.yml`) posts an automated review; `pages.yml`
  deploys the site from `docs/`/`site/`.
- **Site** pages (`docs/`, `site/`) follow the per-line copy-button contract
  documented in `CLAUDE.md` — one copy button per command, comments stripped
  from `data-copy`.

---

## Agent behavior

The behavioral guidelines (Think before coding · Simplicity first · Surgical
changes · Goal-driven execution) are the `claude-skills:guidelines` block in
[`CLAUDE.md`](./CLAUDE.md) — read them there; they are not duplicated here. Two
that bite hardest in this repo:

- **Surgical changes only.** Touch only what the task requires — don't
  reformat or "clean up" adjacent skill prose while editing a skill for an
  unrelated reason. If your change orphans a helper/import, remove it (yours);
  pre-existing dead code isn't — flag it instead.
- **Inventory counts are cross-file invariants.** Adding/removing a skill
  changes counts in multiple docs (`docs/skills-catalog.md`,
  `docs/architecture.*`, `docs/catalog.html`, `site/*`, plugin `README`s).
  Update them atomically with one scripted sweep, never hand-edit each site:
  `python3 scripts/sweep_counts.py --check` finds stale counts, `--write` fixes
  them (CI runs the check via `tests/pytest/test_sweep_counts.py`). For the
  plugins listed in `SITES`, it rewrites skill counts: footers carry only the
  total, while per-plugin counts live in mermaid labels, `data-count` stat
  bands, kickers, and site index rows. Never hand-edit what the sweep covers.
  It only checks catalog Skill rows, which are still added by hand. Still a
  manual grep: the second-wind and mods feature pages and diagram nodes, the
  portable-artifacts and mods index rows, word forms ("five"/"5"),
  `data-to`/`data-target` attributes, meta/OG descriptions, other diagram node
  lists, "each/every/deep-dive" prose, and plugin/command/agent/hook counts.
  Regenerate `site/og.png` from `site/og.html` only when a total shown there
  changed.

### Lessons from the voiceover dependency fix (PRs #45, #46)

- **Dependencies installed on demand are invisible to `npm audit`.** A package
  the doctor installs with `npm install <pin> --no-save` (make-motion's
  voiceover: `kokoro-js`) is not in the skill's `package-lock.json`, so audit,
  Dependabot and CI all report clean while the user's machine gets the
  vulnerable tree (PR #45/#46: `sharp` 0.34.5, 3 high). When you add or bump
  one: (1) audit it with `scripts/audit-on-demand-deps.sh`, which CI also runs
  weekly in `audit-on-demand-deps.yml` because advisories land without a
  commit; (2) fix transitive advisories with exact-version `overrides` in the
  skill's `package.json`, not by waiting on upstream; (3) install from inside
  the skill folder (`cd <skill-dir> && npm install …`), the form that applies
  `overrides` on every npm we tried (`--prefix` did too on npm 10.9 and 11.5;
  a report that it does not on npm 10.8.2 was never reproduced, so do not state
  it as fact). In a guarded worktree (Shell rules below), run `npm --prefix
  <absolute skill dir> install …` or a `.scratch/` script instead of `cd … &&`.
- **Changing an install command or pin is a cross-surface edit.** The doctor
  fix (`shared/doctor.mjs`, synced into every skill with `node
  bin/sync-shared.mjs`), the runtime error hint (`doctor-hint.mjs`), README,
  USAGE, `references/schema.md` and the changelog all print it. Grep the old
  form across the whole plugin before you push (PR #45 fixed the doctor and
  missed the hint and schema.md; `bin/test/install-commands.test.mjs` now
  guards the docs).
- **A pin that fixes a vulnerability must also reach existing installs.** The
  doctor's check must go red for an install made before the pin (see
  `staleOverrides` in `shared/doctor.mjs`), otherwise everyone who already
  installed keeps the vulnerable version and is never told. Prove it with a
  real pre-pin install, not a mock: install without the pin, restore it, run the
  doctor, run `--fix`, confirm the version moved.
- **Never assert a root cause you did not reproduce.** "npm ignores overrides
  under `--prefix`" went into a PR body and a code comment from one
  environment; a second environment disproved it. Say "reported" and name the
  environment, as the CHANGELOG now does.

---

## Orchestration modes

Pick the cheapest mode that fits the task shape — escalate the mode, don't
default to the heaviest:

| Mode | When |
|---|---|
| **Solo** (orchestrator edits directly) | Single-file skill/doc edits, conversational turns, mid-review touch-ups — no dispatch ceremony |
| **Single Agent dispatch** | One bounded delegation with one perspective: a search, a focused skill review, a bats-run verify, a doc lookup |
| **Workflow** | Deterministic fan-out over a known work-list (e.g. audit every skill's frontmatter); find→verify pipelines; loop-until-dry discovery; anything needing schema-validated aggregation of many agents |
| **Agent team** | Long-lived roles that need cross-talk and mid-flight steering across phases — determinism matters less than interaction |

A standing ultracode/session directive authorizes orchestration; it does not
mandate the heaviest mode — this rubric picks it. Verification-heavy work
(skill audits, reviews, research) defaults to **Workflow with adversarial
verify**.

---

## Model routing & dispatch cost

Claude Code's orchestrator dispatches subagents with per-subagent **model
tier** and **reasoning effort** overrides. This section governs those
decisions. It is **dispatch guidance only — never grounds for the current
session to refuse or deflect work because of the model it runs as.** If the
session's model is below the tier named for a task, note the mismatch once and
proceed.

Rules use **tiers**, not model names (names rot). The mapping is the only line
to edit when the lineup changes:

> **Current tier mapping (edit me, not the rules):** planner/orchestrator tier
> = **Fable 5 / Opus** · executor tier = **Sonnet** · chore tier = **Haiku**.
> Fable is the fast planner-tier default for fan-out orchestration; reserve
> Opus for the hardest single planning/verification step.

- **Never dispatch with both knobs implicit.** An unset knob silently inherits
  the orchestrator's — top tier, high effort — which for mechanical work is
  pure waste. Workflow stages set `opts.effort` always, and `opts.model`
  whenever the stage doesn't genuinely need session tier. Agent-tool
  dispatches likewise. Custom agents pin `model:` in frontmatter.
- **Dispatch matrix:**
  | Task | Tier | Effort |
  |---|---|---|
  | Plan authoring · architecture · adversarial verify · judging | planner | high–xhigh (`max` for one hardest verify, never fleets) |
  | Skill/doc implementation · TDD | executor | medium–high |
  | Breadth finders / reviewers | executor | medium |
  | Inventory, grep sweeps, digests, file moves, git summaries, checklist generation | chore | low |
- **Effort escalates before tier.** Bump effort one step first, then tier.
  Escalate when: (a) the *identical* diagnostic survives two materially
  different fix strategies (a *changing* diagnostic is progress — keep
  iterating); (b) a subagent reports a framework-level anomaly or something
  contradicting the spec — escalate immediately; (c) the task turns out to
  amend a locked convention. Both escalations logged with cause.
- **Executor tier is the floor for any code/skill change.** Chore tier only
  for the explicit list above — never drafts skill content, never edits a
  `SKILL.md` body or a plugin manifest.
- **Caching etiquette.** Subagents do **not** share the session's prompt cache
  — each pays its own context from zero. Anchor `file:line` in prompts, never
  re-paste repo code; continue a warm agent via `SendMessage` instead of
  respawning cold; iterate inside the ~5-minute prompt-cache TTL; prefer
  Workflow **resume** over rerun (completed stages replay from cache). For a
  large package (diff over ~40,000 chars or 1,000 lines) the review prompt
  gives the diff path plus `git diff --stat` and says to read by `offset` and
  `limit` or per file; small diffs may be read whole.
- **Schema every data-returning dispatch** — parse-and-retry loops are pure
  token burn.
- **Shell rules.** In Claude Code sessions with the worktree guard, follow,
  and put in every dispatch prompt: one plain command per Bash call with
  literal absolute paths; no `cd … &&`, pipes, `;`, shell variables, loops,
  heredocs, or paths outside the worktree except the session scratchpad;
  scripts via the Write tool under `.scratch/`; remove your own scratch dir
  with one plain `rm -rf <literal absolute path>` when the guard allows it,
  never a variable path; no foreground `sleep` (use Monitor).

---

## Branch & commit workflow

Context: multiple contributors, **PR + CI is the gate** (no on-device testing
step as in Cubby). Work batches onto a feature branch, opens a PR, merges once
CI is green and review passes.

- **Branch first — never commit work directly to `main`.** One branch per
  logical unit of work (`feat/<slug>`, `fix/<slug>`, `docs/<slug>`).
- **Reviewing or testing a PR: work on that PR's own branch.** Check it out
  (`gh pr checkout <n>`, or fetch `pull/<n>/head` and switch to it), test
  there, and put follow-up commits (learnings, fixes) on the same branch so
  they ship with the PR. Push author rework (yours, or a reviewer's
  follow-up) to the original PR branch, not a new branch unless asked; open a
  superseding PR only when that branch cannot be pushed, and say why in the
  new PR. In a session worktree, push with
  `git push origin HEAD:<pr-branch>` rather than inventing a branch name.
- **Commits are task-level and atomic** — conventional format
  (`feat`/`fix`/`refactor`/`docs`/`test`/`chore`), one logical change, each
  leaving the tree green (`bats tests/bats` + `shellcheck` where scripts
  changed). Prefer several focused commits over one sprawling commit; never
  bundle unrelated edits.
- **Standing authorization to commit and push** at natural boundaries — no
  per-commit confirmation. Still pause and confirm before a **force-push**, a
  history rewrite of shared history, or pushing directly to a protected branch.
- **Push feature branches** with `-u` once a unit of work is complete and has
  had the pre-push review (gates below), then open a PR. PR body: analyze the
  full commit history (`git diff main...HEAD`), draft a comprehensive summary,
  include a test plan.
- **Pre-review gates, in order:** relevant tests green locally → a
  fresh-context reviewer (`/code-review` on the diff) **before the first
  push** → CI green on the PR, whose automated `claude-code-review` workflow
  also reviews → merge (`--squash --delete-branch`) with no CRITICAL/HIGH
  unfixed from either review. Each code fix ships with a regression test that
  failed first (docs and prose fixes are exempt). MEDIUM/LOW may defer as
  follow-up commits.
- **Site/inventory changes** that touch counts or the copy-button contract
  must pass the per-line-copy discipline in `CLAUDE.md`; verify rendered pages
  locally (Chrome MCP: navigate, inspect DOM, screenshot) before committing
  when the change is visual.

---

## Commit / PR trailers

End commit messages with exactly this one trailer:

```
Co-Authored-By: Claude <noreply@anthropic.com>
```

No model-named `Co-Authored-By` or `Claude-Session:` line, even where the
harness asks. Dispatch prompts here deny commit; the orchestrating session
commits.

End PR bodies with the Claude Code generation trailer. Follow the repo's
existing PR style (see recent merged PRs for the house format).

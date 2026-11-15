# AGENTS.md — claude-skills conventions

The engineering guide for **claude-skills**, for human contributors and AI
coding agents (Claude Code, Cursor, Codex, …). [`CLAUDE.md`](./CLAUDE.md)
imports this file (`@AGENTS.md`), so Claude Code loads it every session in this
repo; other tools read it directly. Whether the import loads it in a given
session is checked from the next session's context listing, not assumed.
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
> = **Fable 5 / Opus** · reviewer tier = **Opus** · executor tier = **Sonnet** ·
> chore tier = **Haiku** (**Sonnet** at low effort when the chore needs a little
> judgment). Fable is the fast planner-tier default for fan-out orchestration;
> reserve Opus at planner effort for the hardest single planning/verification
> step. Nothing else in this file names a model; `subagent-dispatch` defers to
> this line.

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
  | Breadth finders | executor | medium |
  | Phase-gate review of an executor-authored diff, verifier fleets | reviewer | medium (`high` for an adversarial or final review) |
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
- **Report delivery.** A subagent report is cut at about 3,000 to 4,000
  characters (estimated from transcripts). Put in every prompt for an agent
  whose report you need in full: write the full report to a named file, return
  its path plus a summary of at most 2,500 characters, verdict first, ending
  `END OF REPORT`; send it once. If a report never arrives, follow the Recovery
  section of `core-workflow:subagent-report-truncation-delivery-contract`.
- **Shell rules, every session** (macOS zsh, BSD userland): quote globs
  (`'*.md'`), because zsh stops with `no matches found`; no `====` separator
  lines (zsh reads `=` as a command); use the Edit tool instead of `sed -i`
  (BSD `sed` needs a backup suffix and a failed chain writes nothing); no
  `timeout` command, it is missing here; list a directory before opening a
  guessed path. `grep` may be ugrep: run `grep -n 'word' <file>`, then Read with
  an offset, and never use `.{0,N}` windows (ugrep stops on complexity).
- **Shell rules with the worktree guard.** Follow these, and put them in every
  dispatch prompt as COMMAND LIMITS: one plain command per Bash call with
  literal absolute paths; no `cd … &&`, pipes, `;`, shell variables, loops,
  heredocs, or paths outside the worktree except the session scratchpad;
  scripts via the Write tool under `.scratch/`; run noisy commands bare, with
  no pipe into `head`, `tail` or `grep`. A subagent never runs `rm`: the
  Blast Radius hold stops an `rm` for 10 minutes and a subagent cannot answer
  it. It writes scratch under `.scratch/` or the session scratchpad by literal
  path, leaves it in place, and lists it in its report; the attended
  orchestrator removes it with one plain `rm -rf <literal absolute path>`,
  never a variable path. No foreground `sleep` and no `timeout`: use Monitor
  with an until-loop.
- **Close what you start.** Stop an agent or teammate with `TaskStop` once its
  result is read and no follow-up is planned. Commit on green only when the
  dispatch prompt authorises it; otherwise the orchestrator commits.

---

## Branch & commit workflow

Context: multiple contributors, **PR + CI is the gate** (no on-device testing
step as in Cubby). Work batches onto a feature branch, opens a PR, merges once
CI is green and review passes.

- **Branch first — never commit work directly to `main`.** One integration
  branch and one PR per plan, wave or topic (`feat/<slug>`, `fix/<slug>`,
  `docs/<slug>`); the phases are commits on it (`fix(phaseN):` for follow-ups).
  Default to the session's current branch. On `main`, branch off and say so in
  one line, without asking. A second branch only when the owner asks;
  follow-ups go on the existing branch and PR, and sibling PRs are folded into
  it and closed. Stack branches only when the owner picks that. In a session
  worktree, rename a `worktree-*` branch to the prefix above before the first
  commit.
- **No finishing menu.** When `superpowers:finishing-a-development-branch`
  asks how to integrate and the plan names a PR, push the branch and open the
  PR; skip the merge/PR/keep menu.
- **Reviewing or testing a PR: work on that PR's own branch.** Check it out
  (`gh pr checkout <n>`, or fetch `pull/<n>/head` and switch to it), test
  there, and put follow-up commits (learnings, fixes) on the same branch so
  they ship with the PR. Push author rework (yours, or a reviewer's
  follow-up) to the original PR branch, not a new branch unless asked; open a
  superseding PR only when that branch cannot be pushed, and say why in the
  new PR. In a session worktree, push with
  `git push origin HEAD:<pr-branch>` rather than inventing a branch name.
  For a contributor's PR:
  - Reproduce each claimed bug with a failing test before you fix it, then
    leave one PR comment naming the fix commit sha and what it changed.
  - When several contributor PRs overlap, merge the oldest first and rebase
    the rest before re-review.
  - Close a duplicate PR with a comment that points at the surviving one;
    never merge it.
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
  include a test plan. A bug-fix PR body opens with four lines: the symptom,
  the root cause, the fix, and the test that failed before it.
- **Pre-review gates, in order:** relevant tests green locally → a
  fresh-context reviewer (`/code-review` on the diff) **before the first
  push** → CI green on the PR, whose automated `claude-code-review` workflow
  also reviews → merge (see Merging) with no CRITICAL/HIGH unfixed from either
  review. Each code fix ships with a regression test that failed first (docs
  and prose fixes are exempt). MEDIUM/LOW may defer as follow-up commits.
- **Merging.** `main` needs the owner's approval, so the owner merges with one
  plain command: `gh pr merge <N> --squash --admin`. An agent confirms CI is
  green (`gh pr checks <N>`), then ends its report with that line, ready to
  paste; it runs the merge itself only when the owner asks for it in that turn,
  and then as the single plain command, never inside a pipe, `&&` chain or
  `$(…)`, which skip the allow rule and reach the auto-mode classifier (it
  denies `[Merge Without Review]`; see
  `core-workflow:github-solo-branch-protection-codeowners`). Before merging a
  parent PR with `--delete-branch`, retarget each open child PR
  (`gh pr edit <child> --base main`): deleting the parent's branch closes the
  child, and a closed PR's base cannot be changed.
- **After the merge, verify the deploy.** A merge that touches `site/**` or
  `docs/**` triggers `pages.yml` (while Pages is enabled; see its header). Run `gh run list --workflow pages.yml
  --limit 3`; if no run started for the merge commit, start one with
  `gh workflow run pages.yml`. Poll until it is green, then fetch the live page
  and look for a marker from the change before saying it is deployed.
- **Plugin versions.** The `plugin-version-guard` job in `test.yml` fails a PR
  that touches `plugins/<name>/**` and leaves that plugin's
  `.claude-plugin/plugin.json` `version` unchanged. Make one bump per plugin per
  PR, and one `CHANGELOG.md` heading where the plugin keeps one (today only
  `portable-artifacts`): one version bump per merged release, not per commit. A
  change that ships nothing to users puts `[skip-plugin-bump]` in a commit
  message, which skips the check for the whole PR.
- **Site/inventory changes** that touch counts or the copy-button contract
  must pass the per-line-copy discipline in `CLAUDE.md`; verify rendered pages
  locally (Chrome MCP: navigate, inspect DOM, screenshot) before committing
  when the change is visual. `scripts/site-preview.sh` stages `site/` and
  `docs/` exactly as `pages.yml` does into `.scratch/_site`, serves it on a free
  loopback port, checks the index page and `assets/site.css` for 200, and
  prints each page URL; `scripts/site-preview.sh --stop` stops it.
- **Local gate for the two mods** (`session-compass`, `test-board`). CI does
  not run their TypeScript tests or type check, so run before you push, from
  the repo root:

  ```
  claude plugin validate plugins/session-compass
  claude --plugin-dir plugins/session-compass
  npx -y -p typescript@5.6.3 tsc -p plugins/session-compass
  claude plugin test plugins/session-compass
  ```

  and the same four with `plugins/test-board`. The `claude --plugin-dir` run
  lays the gitignored `.claude-plugin/types` that `tsc` needs. Whether
  `claude plugin test` runs unauthenticated on a CI runner is unconfirmed, so
  there is no CI job for it yet.
- **Test installs in a temp dir.** Run an installer (`adapters/install.sh`,
  `plugins/portable-artifacts/bin/install.mjs`, `npx skills add`) against a
  temporary directory or a fake `HOME`, never the repo checkout: a project-scope
  install leaves `.agents/`, `.claude/skills/` and `skills-lock.json` that shadow
  the plugin's skills for every later session here.

---

## Shipping a portable-artifacts change

Before the PR for any change under `plugins/portable-artifacts/`. These are the
steps no test already enforces; `sweep_counts.py --check`, the install-command
guard and the copy-button lint cover the rest.

- **Version and notes.** Bump `plugins/portable-artifacts/.claude-plugin/plugin.json`
  once (`marketplace.json` carries no per-plugin version). Write the new
  `CHANGELOG.md` heading as user-facing release notes with behaviour changes
  first, then copy it into the `#whats-new` block of
  `docs/features/portable-artifacts.html`, and update the plugin `README.md`
  and `USAGE.md`.
- **Shared code.** After editing `shared/`, run
  `node plugins/portable-artifacts/bin/sync-shared.mjs`, then `--check`.
- **Goldens** change only for an intended visual change, stated in the commit.
  Never regenerate one to clear a red test.
- **Gallery.** Rebuild each page under
  `docs/features/showcase/portable-artifacts/gallery/` that the change affects,
  from its source spec; set `SOURCE_DATE_EPOCH` so the stamped date is stable
  and record the value in the PR body. Run `check.mjs` on each rebuilt page one
  at a time (one browser at a time) and open the `--shots` PNGs. Hero images
  and clips come from real files in the repo, never mock-ups.
  `tests/pytest/test_portable_artifacts_page.py` checks the page. No script
  lists gallery pages that lack a source spec; check by hand.
- **A new skill** also needs its `test.yml` matrix row and `npm ci` loop entry,
  its doctor requirements, and an icon in `shared/icons.mjs`; the full list is "Adding a sibling
  skill" in `plugins/portable-artifacts/shared/README.md`.
- **A release showcase** (feature clips, a promo, an explainer with the clips
  embedded, a guide) follows one order: read the `CHANGELOG.md` entry for the
  release; render one draft clip per capability, one at a time; render one
  promo in viral mode (with voiceover only after `doctor --for voiceover` and
  one ask); build the explainer in a folder where the relative `video` paths
  resolve (`sections[n].video: file not found` otherwise); write the guide from
  `USAGE.md`; copy the results into the gallery and run the page test; add the
  site anchors; zip without `rm`; end the report with the steps only the owner
  can do.

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

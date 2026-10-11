---
name: contribute
description: "Contribute a change or new skill back to the claude-skills seeding repo from any working directory. Use when the user says \"contribute this back\", \"add this to claude-skills\", \"share this skill\", or invokes /contribute-skill. Wraps the claude-skills-contribute script: branches, validates, commits, opens a PR. Refuses on dirty tree and unauthenticated gh."
---

# Contribute to claude-skills

Drives `claude-skills-contribute` from any repo or machine.

## When to use

- User wrote a new custom skill locally and wants it shared.
- User changed an existing skill, agent, hook, or command in claude-skills and wants the change captured + reviewed.
- User installed/removed a Claude plugin or npx skill and wants the manifest snapshotted.

## Steps

1. Confirm the user's intent — capture state, or scaffold a new skill? Ask if ambiguous.
2. Run `claude-skills-contribute --skill <name> [--plugin <plugin>] --message "<msg>"` for a brand-new skill, or `claude-skills-contribute --message "<msg>"` to capture live state.
   - `--plugin` picks the target plugin; default `core-workflow`. It must already exist under `plugins/`.
   - `--skill` scaffolds the `templates/skill.md.example` placeholder (substituting the name) into `plugins/<plugin>/skills/<name>/`, then runs bats and pytest BEFORE committing. It fails on a dirty claude-skills tree and if the skill dir already exists (that failure leaves you on a new `contrib/…` branch; switch back and delete it).
   - A freshly scaffolded skill fails `test_sweep_counts.py::test_live_tree_counts_in_sync` and the catalog-row invariant (stale counts, no catalog row), so the script stops with "pytest failing — leaving branch contrib/…" and the scaffold stays UNCOMMITTED on that branch. Expect this. To ship real content, add `--no-pr`, then on that branch overwrite the scaffold, run `python3 scripts/sweep_counts.py --write`, add the hand rows from step 3, run `bats tests/bats` and `pytest tests/pytest -q`, commit, push, and `gh pr create` yourself.
   - Extending an existing skill is not a `--skill` job: start from an updated `main` in `${CLAUDE_SKILLS_HOME:-$HOME/projects/claude-skills}` on a clean tree, branch manually, edit, commit, push, `gh pr create`.
   - Capture mode (no `--skill`) copies `~/CLAUDE.md` and `~/.claude/settings.json` into `templates/` and rewrites `claude-setup.toml`. Review the diff for secrets and private names before pushing.
3. If this added or removed a skill, command, agent, or hook: update the site
   so it isn't stale the moment this merges (this has bitten the repo before —
   see the "sync" commits in git log). In the same PR, run
   `python3 scripts/sweep_counts.py --check` to find stale skill counts and
   `python3 scripts/sweep_counts.py --write` to fix them (CI runs the check via
   `tests/pytest/test_sweep_counts.py`). The sweep rewrites counts, not rows:
   the rows below are still added by hand. Files the sweep covers, and what
   stays manual:
   - `docs/catalog.html` — badge count (swept) + one `.crow` entry per skill/command/etc. (by hand; the sweep only checks that Skill rows equal the live total).
   - `docs/skills-catalog.md` — the matching table row (by hand).
   - `docs/features/<plugin>.html` — stat count and kicker (swept) + "What's inside" inventory row (by hand).
   - `docs/architecture.html` and `docs/architecture.md` — the per-plugin count in the diagram labels (swept).
   - `site/index.html` — total-count strings and plugin-row counts (swept).
   - `site/og.html` — total count (swept). Regenerate `site/og.png` (screenshot og.html at 1200x630) only when a total shown there changed; the sweep prints a reminder when the total moved.

   Sweep coverage, for the plugins listed in `SITES` in `scripts/sweep_counts.py`: footers ("N plugins · M skills") carry only the total; per-plugin skill counts live in mermaid labels, `data-count="N">N<` stat bands, feature kickers, and site index plugin rows. Never hand-edit what the sweep covers. Gaps, grep manually for the old number: the second-wind and mods feature pages and diagram nodes, the portable-artifacts and mods site index rows, word forms ("five" vs "5"), `data-to` / `data-target` attributes, meta and OG descriptions, other diagram node lists, "each/every/deep-dive" prose, and plugin/command/agent/hook counts.
   Skip this step only for changes that touch no skill/command/agent/hook (e.g. a pure bugfix inside an existing skill's script).
   If the change adds or edits a command block on any site page, follow the per-line copy-button convention in this repo's `CLAUDE.md` ("Working in this repo") — one button per command, comment-free `data-copy`.
4. Surface the PR URL printed by `gh`.
5. If `--no-pr` was used (e.g. offline), tell the user the branch name so they can push later.

## Hard rules

- Never run with `--auto-merge` unless the user explicitly asks.
- Refuse if `gh auth status` fails — tell the user to run `gh auth login` first.
- Do not stash or rewrite working tree state in the user's current repo. claude-skills-contribute operates on `$CLAUDE_SKILLS_HOME`, not the caller's cwd.
- Never skip the site-sync step (3) silently when it applies — a new skill with no site entry is what caused this exact drift previously.

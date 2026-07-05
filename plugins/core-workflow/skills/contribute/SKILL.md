---
name: contribute
description: Contribute a change or new skill back to the claude-skills seeding repo from any working directory. Use when the user says "contribute this back", "add this to claude-skills", "share this skill", or invokes /contribute-skill. Wraps the claude-skills-contribute script: branches, validates, commits, opens a PR. Refuses on dirty tree and unauthenticated gh.
---

# Contribute to claude-skills

Drives `claude-skills-contribute` from any repo or machine.

## When to use

- User wrote a new custom skill locally and wants it shared.
- User changed an existing skill, agent, hook, or command in claude-skills and wants the change captured + reviewed.
- User installed/removed a Claude plugin or npx skill and wants the manifest snapshotted.

## Steps

1. Confirm the user's intent — capture state, or scaffold a new skill? Ask if ambiguous.
2. Run `claude-skills-contribute --skill <name> --message "<msg>"` for a brand-new skill, or `claude-skills-contribute --message "<msg>"` to capture live state.
3. If this added or removed a skill, command, agent, or hook: update the site
   so it isn't stale the moment this merges (this has bitten the repo before —
   see the "sync" commits in git log). In the same PR, update:
   - `docs/catalog.html` — badge count + one `.crow` entry per skill/command/etc.
   - `docs/skills-catalog.md` — the matching table row.
   - `docs/features/<plugin>.html` — stat count + "What's inside" inventory row.
   - `docs/architecture.html` and `docs/architecture.md` — the per-plugin count in the diagram.
   - `site/index.html` — any total-count strings (search for the old total, e.g. "35 skills").
   - `site/og.html` + regenerate `site/og.png` (screenshot og.html at 1200x630) — only if the totals shown there changed.
   Skip this step only for changes that touch no skill/command/agent/hook (e.g. a pure bugfix inside an existing skill's script).
   If the change adds or edits a command block on any site page, follow the per-line copy-button convention in this repo's `CLAUDE.md` ("Working in this repo") — one button per command, comment-free `data-copy`.
4. Surface the PR URL printed by `gh`.
5. If `--no-pr` was used (e.g. offline), tell the user the branch name so they can push later.

## Hard rules

- Never run with `--auto-merge` unless the user explicitly asks.
- Refuse if `gh auth status` fails — tell the user to run `gh auth login` first.
- Do not stash or rewrite working tree state in the user's current repo. claude-skills-contribute operates on `$CLAUDE_SKILLS_HOME`, not the caller's cwd.
- Never skip the site-sync step (3) silently when it applies — a new skill with no site entry is what caused this exact drift previously.

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
3. Surface the PR URL printed by `gh`.
4. If `--no-pr` was used (e.g. offline), tell the user the branch name so they can push later.

## Hard rules

- Never run with `--auto-merge` unless the user explicitly asks.
- Refuse if `gh auth status` fails — tell the user to run `gh auth login` first.
- Do not stash or rewrite working tree state in the user's current repo. claude-skills-contribute operates on `$CLAUDE_SKILLS_HOME`, not the caller's cwd.

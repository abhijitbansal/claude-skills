---
description: Contribute a change or new skill back to claude-skills (creates branch + PR).
---

Invoke the `contribute` skill. Args:
- `--skill <name>` to scaffold a new skill (needs `bats` and `uv`; fails before committing without them)
- `--plugin <name>` to scaffold into that plugin instead of `core-workflow` (must exist under `plugins/`)
- `--message "<text>"` for the commit + PR title
- `--commit` / `--push` in capture mode (no `--skill`): capture stops after printing the diff unless one is given; `--commit` commits only, `--push` also pushes and opens the PR
- `--no-pr` to skip the PR step (push only)
- `--auto-merge` to queue a squash-merge with `gh pr merge --auto` (use sparingly). It is queued, not done: GitHub merges once checks pass, and on this repo the solo CODEOWNERS rule still blocks it until an admin merges with `--admin`

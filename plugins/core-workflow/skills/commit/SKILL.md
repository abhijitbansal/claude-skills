---
name: commit
description: Stage the current changes, lint shell scripts with shellcheck, and create a single git commit with a conventional message generated from the diff. Use when the user says "commit", "save this", "snapshot this state", or "checkpoint" without specifying a commit message. Skip if the user asked you to push, open a PR, or do anything beyond a local commit — those need confirmation per the global git safety protocol.
---

# Commit current work

A small, opinionated commit flow tuned for this repo's iterative shell+Swift workflow. The goal is to make snapshotting working state cheap so debug rounds don't accumulate uncommitted regressions.

## Steps

Run these in parallel where possible:
1. `git status` (no `-uall`) to see untracked + modified files.
2. `git diff` (staged + unstaged) to see what would actually be committed.
3. `git log --oneline -10` to match this repo's commit message style.

Then sequentially:

4. **Lint any changed `.sh` files** with `shellcheck`. If shellcheck reports errors (not info/style), surface them and **ask the user whether to commit anyway** — don't auto-block, but don't silently ship known issues either.
5. **Stage** the relevant changes by file name. Never `git add -A` or `git add .` — that risks committing `.env`, `.dev-team`, build artifacts, or other gitignored-but-not-yet-tracked files.
6. **Generate a commit message:**
   - Title (≤72 chars): imperative mood, lowercase, no trailing period. Match the style of recent commits in this repo.
   - Body (optional): one or two sentences focused on the *why*, not the *what*. Skip the body for trivial changes.
   - No attribution trailer — disabled globally via `~/.claude/settings.json`.
7. **Commit via heredoc** (always — preserves formatting):
   ```
   git commit -m "$(cat <<'EOF'
   <title>

   <body if any>
   EOF
   )"
   ```
8. `git status` after to confirm the commit landed.

## Hard rules

- **Never amend.** Use a new commit even if the previous one was small. Amending a pushed commit is hostile to anyone who pulled it.
- **Never `--no-verify`.** If a pre-commit hook fails, fix the underlying issue and re-stage.
- **Don't commit secrets.** If you see something that looks like a token, key, or credential staged, abort and warn the user.
- **Don't commit `Paperix.xcodeproj/`, `build/`, `.dev-team`, `.tmp/`, or anything matched by `.gitignore`.**
- **One commit per call.** If the changes are clearly two unrelated things, ask the user whether to split — don't decide unilaterally.

## When NOT to use this skill

- User asked for "push" or "open PR" — those need explicit confirmation; don't bundle them into the commit flow.
- User specified the commit message themselves — just commit with their message verbatim, skip the message-generation step.
- Mid-rebase or mid-merge — investigate state first; don't blindly snapshot a half-resolved conflict.

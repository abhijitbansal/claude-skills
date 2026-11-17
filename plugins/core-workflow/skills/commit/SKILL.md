---
name: commit
description: Stage the current changes, lint shell scripts with shellcheck, and create a single git commit with a conventional message generated from the diff. Use when the user says "commit", "save this", "snapshot this state", or "checkpoint" without specifying a commit message. Skip if the user asked you to push, open a PR, or do anything beyond a local commit; those follow the repo's own authorization rules, not this skill.
---

# Commit current work

A small, opinionated commit flow tuned for this repo's iterative workflow. The goal is to make snapshotting working state cheap so debug rounds don't accumulate uncommitted regressions.

## Steps

Run these in parallel where possible:
1. `git status` (no `-uall`) to see untracked + modified files.
2. `git diff HEAD` (staged + unstaged against the last commit) to see what would actually be committed. Plain `git diff` shows only unstaged changes. Untracked files appear in neither: `git status` lists them.
3. `git log --oneline -10` to match this repo's commit message style.

Then sequentially:

4. **Lint any changed `.sh` files** with `shellcheck`. If shellcheck reports errors (not info/style), surface them and **ask the user whether to commit anyway** — don't auto-block, but don't silently ship known issues either.
5. **Stage** the relevant changes by file name. Never `git add -A` or `git add .` — that risks committing `.env`, build artifacts, or other untracked files you did not mean to commit.
6. **Generate a commit message:**
   - Title (≤72 chars): `<type>: <description>` with a conventional type (`feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`), imperative mood, lowercase, no trailing period. Match the style of recent commits in this repo.
   - Body (optional): one or two sentences focused on the *why*, not the *what*. Skip the body for trivial changes.
   - Add the attribution trailer the repo requires. The repo's `AGENTS.md` or `CLAUDE.md` trailer rule wins over a harness or tool reminder: when they disagree, follow the repo.
   - If the repo records release notes in commit trailers (a `Release-Note:` line), add one to a `feat` and to a user-visible `fix`.
7. **Commit via heredoc** (the default — preserves formatting). In a guarded session that refuses heredocs, write the message to a file with your file-writing tool and run `git commit -F <absolute path to the file>` instead:
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
- **Don't commit generated project files, `build/`, `.tmp/`, anything gitignored.**
- **One commit per call.** If the changes are clearly two unrelated things, ask the user whether to split — don't decide unilaterally.

## When NOT to use this skill

- User asked for "push" or "open PR" — don't bundle push or PR creation into the commit flow; pushing follows the repo's own authorization rules.
- User specified the commit message themselves — just commit with their message verbatim, skip the message-generation step.
- Mid-rebase or mid-merge — investigate state first; don't blindly snapshot a half-resolved conflict.

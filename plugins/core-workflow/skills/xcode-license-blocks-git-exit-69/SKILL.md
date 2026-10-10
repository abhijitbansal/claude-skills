---
name: xcode-license-blocks-git-exit-69
description: "Every git command fails with exit 69 and 'You have not agreed to the Xcode license agreements' after an Xcode or Command Line Tools update, sudo fails with 'a terminal is required to read the password', and subagents stall with uncommitted work. Use when git starts failing on macOS right after an Xcode update, or before dispatching commit-heavy subagent waves."
---

# Xcode license not accepted: git is dead until the user runs one sudo command

## Symptom

- Any `git` call exits 69: `You have not agreed to the Xcode license
  agreements.` Often right after an Xcode or CLT auto-update (this hit
  non-iOS repos too, since `/usr/bin/git` is an Xcode shim).
- A `!`-prefixed attempt to run the fix also fails: `sudo: a terminal is
  required to read the password`.
- Dispatch prompts start saying git is blocked on this machine, and
  implementers return with uncommitted work in the tree.

## Root cause

`/usr/bin/git` forwards into the Xcode toolchain. After an update the new
license must be re-accepted with `sudo`, which needs a real TTY. An agent
session has none, so only the user can fix it.

## Fix

1. Detect it on the FIRST failing git call (exit 69 or the string `agreed to
   the Xcode license`). Stop retrying.
2. Tell the user once, plainly: run this in a real Terminal window:
   ```bash
   sudo xcodebuild -license accept
   ```
3. Meanwhile use the Command Line Tools git binary, which bypasses the xcrun
   shim for every operation (limiting it to read-only here is a policy
   choice, not a technical limit):
   ```bash
   /Library/Developer/CommandLineTools/usr/bin/git status --short
   /Library/Developer/CommandLineTools/usr/bin/git log --oneline -5
   ```
4. Tell running implementers: hold commits, leave work in the tree, report
   the file list. Do not improvise commits or pushes via other tools.
5. Preflight before commit-heavy waves: `git status` as the first call of
   the controller; if it exits 69, ask the user before dispatching.
6. After the user confirms, resume the pending commits in order.

## Evidence

Mined from session digests; 5 sessions across 4 projects (a private-project worktree `e9097288` and `e7e9ebab`, a private project
`02dd1cbe`, a private-bot worktree `9c45683b`). None were iOS projects. Quoted strings
above are the tool outputs.

## Related skills

- `core-workflow:commit` — the commit conventions to resume once git works.
- `core-workflow:subagent-buildverify-tool-grant-check` — other ways a
  dispatched implementer ends up stalled with unsaved work.
- `core-workflow:worktree-isolation-guard-refuses-complex-bash` — another
  environment limit that makes git calls fail for non-code reasons.

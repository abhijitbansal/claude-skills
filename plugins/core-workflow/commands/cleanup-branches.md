---
description: Inventory merged, stale and worktree-held branches (local and remote), print one table with merge proof, and hand over one delete line per branch. Never deletes on its own.
argument-hint: [optional base branch, default: the repo's default branch]
---

You are running the branch cleanup inventory. Deleting branches is irreversible
(agent-autonomy item 5), so this command inventories, proves, and hands over.
It never deletes a branch itself, and it never touches a branch or worktree that
another session may be using.

**Base branch:** `$ARGUMENTS`. Empty means the repo's default branch (read it
with `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`, falling
back to `main`). If `$ARGUMENTS` is more than one word, or names a branch that
does not exist, stop and say the accepted form: no argument, or one branch
name.

## Step 1 — Inventory (read-only)

Run each as its own plain command, from the repo root:

1. `git fetch --all --prune` — drops remote refs that no longer exist.
2. `git branch --format='%(refname:short) %(committerdate:short)'` — local
   branches.
3. `git branch -r --format='%(refname:short) %(committerdate:short)'` — remote
   branches.
4. `git worktree list --porcelain` — every worktree and the branch it holds.
5. `git branch --merged origin/<base>` — branches fully merged by ancestry.
6. `gh pr list --state merged --limit 200 --json number,headRefName,mergedAt`
   — branches whose PR merged. This is the proof for squash and rebase merges,
   which ancestry cannot see.
7. For a branch with no merged PR and no ancestry proof,
   `git diff --stat origin/<base> <branch>`. An empty diff means its content is
   already in the base. Anything else is unmerged work.

## Step 2 — One table

Print a single table, one row per branch, columns: `branch`, `where` (local,
remote, both), `proof` (`ancestor`, `squash PR #N`, `empty diff`, or `NONE`),
`worktree` (path or `-`), `last commit`. Sort `NONE` rows last.

Mark each row **eligible** only if the proof is not `NONE` and all of these hold:

- it is not the base branch, not the current branch and not `HEAD`;
- it is not held by any worktree. A worktree entry under `.claude/worktrees/`
  may belong to a live session: list it, never touch it;
- it has no open PR (`gh pr list --state open --head <branch>` is empty).

Rows with proof `NONE` are reported as unmerged work and are never offered for
deletion.

## Step 3 — Hand over, one line per branch

For each eligible branch print the exact lines, one per branch per location, for
the user to run themselves with the `!` prefix:

```text
! git branch -d <branch>
! git push origin --delete <branch>
```

Use `-d` for `ancestor` proof. A squash-merged branch is not an ancestor, so
`-d` refuses it; print `git branch -D <branch>` for `squash PR #N` and
`empty diff` rows and say why in the table. Print the remote line only when the
branch exists on the remote.

If the user asks you to run them instead, confirm the exact list once with
`AskUserQuestion` (offering each branch, defaulting to none), then run only the
approved lines, one command per call. If a hook holds or blocks a delete, stop
and hand the line over; do not retry, loop, or work around it.

## Step 4 — Finish

After the user confirms they ran the lines, run `git fetch --all --prune` and
`git worktree prune`, then report what is left. Do not run `git worktree remove`
on anything: removing a worktree is the owner's call.

## Hard rules

- Never delete without a printed proof for that branch in the table.
- Never delete the base branch, the current branch, a branch held by a worktree
  or a branch with an open PR.
- Never batch deletes into a loop, a variable or a script file to get past a
  hook.
- Never rewrite or force-push anything.

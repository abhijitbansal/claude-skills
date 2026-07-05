---
description: Reconcile the current branch and open PR (if any) with their Linear issue — parses the issue key from the branch name, posts a comment with the PR link, and moves the issue to In Progress (no PR) or In Review (PR open). Backfills when work was started outside /linear-pick.
model: sonnet
---

# /linear-sync

Backfill Linear state for work started by hand.

## Procedure

1. Source `${CLAUDE_PLUGIN_ROOT}/skills/linear-pm/scripts/load-config.sh` (or `.claude/skills/linear-pm/scripts/load-config.sh` if `${CLAUDE_PLUGIN_ROOT}` is unset — project-local copy instead of plugin install). Stop on error.

2. **Read current branch:**
   ```bash
   BRANCH=$(git rev-parse --abbrev-ref HEAD)
   ```
   Stop if on the default branch — there's nothing to sync.

3. **Parse the issue key:**
   ```bash
   KEY=$(bash "${CLAUDE_PLUGIN_ROOT}/skills/linear-pm/scripts/parse-issue-key.sh" "$BRANCH")
   ```
   (or `.claude/skills/linear-pm/scripts/parse-issue-key.sh` if `${CLAUDE_PLUGIN_ROOT}` is unset)
   If empty: print "No issue key in branch name `$BRANCH`. Rename the branch to include e.g. `ABH-123`, or pick a different branch."

4. **Fetch the issue:** `mcp__claude_ai_Linear__get_issue` by key.
   Stop with error if not found in the configured project (project mismatch means the user is on the wrong repo or wrong config).

5. **Check for an open PR** for this branch:
   ```bash
   PR_URL=$(gh pr view "$BRANCH" --json url -q .url 2>/dev/null || true)
   ```

6. **Determine desired state:**
   - PR exists → status `In Review`, comment `🤖 PR opened — $PR_URL` (only if no prior such comment for this PR).
   - No PR → status `In Progress`, comment `🤖 Started — branch \`$BRANCH\`` (only if no prior such comment).

7. **Apply transitions** via `save_issue`:
   - Move issue to the desired status if it's not there already.
   - Remove `agent-ready` label if present (work has started).

8. **Post the appropriate comment** via `save_comment` if the matching agent comment isn't already there. To check, list comments and grep for the same prefix + URL/branch.

9. **Print confirmation:**
   > Synced `<key>`: status → `<new status>`, branch `<branch>`, PR `<url-or-none>`.

## Side effects

- May change Linear status (Todo → In Progress, or → In Review).
- May post one comment.
- May remove `agent-ready` label.
- Never modifies code, never pushes.

## Failure modes

| Condition | Action |
|---|---|
| On default branch | Stop, "nothing to sync". |
| No issue key in branch | Stop with guidance. |
| Issue in different project | Stop, point at config mismatch. |
| Comment-grep can't decide if duplicate | Default to NOT posting (idempotency wins). |

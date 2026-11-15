---
description: Reconcile the current branch and open PR (if any) with their Linear issue — parses the issue key from the branch name, posts a comment with the PR link, and moves the issue to In Progress (no PR) or In Review (PR open). Backfills when work was started outside /linear-pick.
model: sonnet
---

# /linear-sync

Backfill Linear state for work started by hand.

## Procedure

1. **Load config and parse the issue key in ONE Bash call.** Each Bash call is a fresh shell, so exports from an earlier call are gone. Source the loader with `--print` (read the values from the printed `KEY=value` lines), then parse the key with the team so a lowercase `user/eng-123-title` matches and a token like `UTF-8` does not:
   ```bash
   source "${CLAUDE_PLUGIN_ROOT}/skills/linear-pm/scripts/load-config.sh" --print
   BRANCH=$(git rev-parse --abbrev-ref HEAD)
   KEY=$(bash "${CLAUDE_PLUGIN_ROOT}/skills/linear-pm/scripts/parse-issue-key.sh" "$BRANCH" "$LINEAR_PM_TEAM")
   echo "BRANCH=$BRANCH"; echo "KEY=$KEY"
   ```
   (use `.claude/skills/linear-pm/scripts/...` for both scripts if `${CLAUDE_PLUGIN_ROOT}` is unset — project-local copy instead of plugin install). Stop on a loader error.
   Confirm the Linear MCP tools are available first (see *Linear MCP tools* in the `linear-pm` skill).

2. **Stop if on the default branch** — there's nothing to sync.

3. **No key?** If `KEY` is empty: print "No issue key in branch name `$BRANCH`. Rename the branch to include e.g. `TEAM-123`, or pick a different branch."

4. **Fetch the issue:** `mcp__claude_ai_Linear__get_issue` by key.
   Stop with error if not found in the configured project (project mismatch means the user is on the wrong repo or wrong config).
   Read its current status (`ISSUE_STATUS`).

5. **Check for an open PR** for this branch. `gh pr view` also returns merged and closed PRs, so keep only an OPEN one:
   ```bash
   PR_URL=$(gh pr view "$BRANCH" --json url,state -q 'select(.state=="OPEN") | .url' 2>/dev/null || true)
   ```

6. **Done guard (before any change).** If `ISSUE_STATUS` is `Done` or `Cancelled`, never move it back to In Progress or In Review. Stop, print "`<key>` is already `<status>`; not moving it backwards.", and only continue if the user explicitly confirms the move.

7. **Determine desired state:**
   - OPEN PR exists → status `In Review`, comment `🤖 PR opened — $PR_URL` (only if no prior such comment for this PR).
   - No open PR → status `In Progress`, comment `🤖 Started — branch \`$BRANCH\`` (only if no prior such comment).

8. **Apply transitions** via `save_issue`:
   - Move issue to the desired status if it's not there already.
   - Remove `agent-ready` label if present (work has started).

9. **Post the appropriate comment** via `save_comment` if the matching agent comment isn't already there. To check, list comments and grep for the same prefix + URL/branch.

10. **Print confirmation:**
   > Synced `<key>`: status → `<new status>`, branch `<branch>`, PR `<url-or-none>`.

## Side effects

- May change Linear status (Todo → In Progress, or → In Review), but never out of Done or Cancelled without confirmation.
- May post one comment.
- May remove `agent-ready` label.
- Never modifies code, never pushes.

## Failure modes

| Condition | Action |
|---|---|
| On default branch | Stop, "nothing to sync". |
| No issue key in branch | Stop with guidance. |
| Issue in different project | Stop, point at config mismatch. |
| Issue already Done or Cancelled | Stop, never move it backwards without confirmation. |
| Branch's PR is merged or closed | Treat as no open PR. |
| Comment-grep can't decide if duplicate | Default to NOT posting (idempotency wins). |

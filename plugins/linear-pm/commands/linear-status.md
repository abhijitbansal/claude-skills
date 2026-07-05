---
description: Show a digest of the current repo's Linear project — In Progress (with PR links), In Review, agent-blocked (with last comment), agent-ready queue, recently shipped.
model: sonnet
---

# /linear-status

Show what's in flight on the configured Linear project for this repo.

## Procedure

1. Source the config:
   ```bash
   source "${CLAUDE_PLUGIN_ROOT}/skills/linear-pm/scripts/load-config.sh"
   ```
   If `${CLAUDE_PLUGIN_ROOT}` is unset (project-local copy instead of plugin install), use `.claude/skills/linear-pm/scripts/load-config.sh` relative to the repo root instead.
   If exit non-zero, surface the error and stop.

2. Resolve the Linear team and project IDs via MCP (treat `$LINEAR_PM_TEAM` and `$LINEAR_PM_PROJECT` as name OR ID — call `mcp__claude_ai_Linear__list_teams` filtered by query, then `mcp__claude_ai_Linear__list_projects` filtered by team + query).

3. For the resolved project, list issues with `mcp__claude_ai_Linear__list_issues`, grouped by status. Fetch with `limit: 100`, `orderBy: updatedAt`.

4. Group results in this order, printing only non-empty groups:
   - **In Progress** — for each issue: `<key> <title> · <assignee>`. If a comment by the agent matches `🤖 PR opened — <url>`, append the URL.
   - **In Review** — same format.
   - **Blocked (`agent-blocked` label)** — for each: `<key> <title>` plus first line of the latest `🤖 Blocked` comment if any (use `mcp__claude_ai_Linear__list_comments`).
   - **Ready queue (`agent-ready` label, Backlog/Todo statuses)** — sorted by priority.
   - **Shipped this week** — issues moved to `Done` in last 7 days. Use `updatedAt` filter or fetch all `Done` and filter client-side.

5. Render as plain text with section headers and a blank line between groups. No tables — keep it copy-pasteable.

## Read-only

This command never writes to Linear or git. It only calls `mcp__claude_ai_Linear__list_*` and `get_*` tools.

## Failure modes

| Condition | Action |
|---|---|
| No `.claude/linear.yml` | Print loader error, stop. Suggest `/linear-init`. |
| Team or project not found | Print the lookup that failed, list teams/projects the user does have, stop. |
| Linear MCP transient error | Surface the error, suggest retry. |

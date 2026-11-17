---
description: Add the `agent-blocked` label to a Linear issue and post a comment with the given reason. Used manually, and also internally by /linear-pick when it can't proceed.
model: sonnet
---

# /linear-block

Mark a Linear issue as blocked, with a reason.

## Usage

- `/linear-block TEAM-123 "Reason this is stuck"` — explicit issue + reason.
- `/linear-block "Reason"` — only valid if there's an obvious current issue from context (e.g. you just ran `/linear-pick` and it failed).

## Procedure

1. **Load config.** Each Bash call is a fresh shell, so exports from an earlier call are gone. Source the loader with `--print` and read the values from the printed `KEY=value` lines; re-source in any later Bash call that needs them:
   ```bash
   source "${CLAUDE_PLUGIN_ROOT}/skills/linear-pm/scripts/load-config.sh" --print
   ```
   (use `.claude/skills/linear-pm/scripts/load-config.sh` if `${CLAUDE_PLUGIN_ROOT}` is unset — project-local copy instead of plugin install). Stop on error.
   Confirm the Linear MCP tools are available first (see *Linear MCP tools* in the `linear-pm` skill).

2. **Resolve issue key.**
   - If first arg matches the configured team's key (`$LINEAR_PM_TEAM-<number>`, case-insensitive), treat it as the key, second arg is the reason.
   - Else if conversation context has a recent issue key (e.g. /linear-pick was just run), use that.
   - Else: ask the user for the key.

3. **Reason:** require non-empty. If missing as arg, prompt for it.

4. **Update the labels.** Call `mcp__claude_ai_Linear__save_issue` with the existing issue ID and the label set: existing labels, plus `agent-blocked`, minus `agent-ready`. Remove the `agent-ready` label (no-op if absent) so the next `/linear-pick` does not pick the blocked issue up again. Don't strip any other label.

5. **Post the comment.** Call `mcp__claude_ai_Linear__save_comment`:

   ```
   🤖 Blocked — <reason>
   ```

6. **Print confirmation:**
   > Marked <key> as agent-blocked.

## Side effects

- Adds `agent-blocked` label and removes `agent-ready`.
- Posts one Linear comment.
- Does NOT change status — agent-blocked is informational, not a status.
- No git operations.

## Failure modes

| Condition | Action |
|---|---|
| Issue not found | Stop with error. |
| `agent-blocked` label missing from workspace | Stop, point at `/linear-init`. |
| `save_comment` fails | Surface error, stop. Don't try to undo the label change. |

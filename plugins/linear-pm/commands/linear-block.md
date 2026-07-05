---
description: Add the `agent-blocked` label to a Linear issue and post a comment with the given reason. Used manually, and also internally by /linear-pick when it can't proceed.
model: sonnet
---

# /linear-block

Mark a Linear issue as blocked, with a reason.

## Usage

- `/linear-block ABH-123 "Reason this is stuck"` — explicit issue + reason.
- `/linear-block "Reason"` — only valid if there's an obvious current issue from context (e.g. you just ran `/linear-pick` and it failed).

## Procedure

1. Source `${CLAUDE_PLUGIN_ROOT}/skills/linear-pm/scripts/load-config.sh` (or `.claude/skills/linear-pm/scripts/load-config.sh` if `${CLAUDE_PLUGIN_ROOT}` is unset — project-local copy instead of plugin install). Stop on error.

2. **Resolve issue key.**
   - If first arg matches `[A-Z]+-[0-9]+`, treat it as the key, second arg is the reason.
   - Else if conversation context has a recent issue key (e.g. /linear-pick was just run), use that.
   - Else: ask the user for the key.

3. **Reason:** require non-empty. If missing as arg, prompt for it.

4. **Add the label.** Call `mcp__claude_ai_Linear__save_issue` with the existing issue ID + appended `labels: [..., agent-blocked]`. Don't strip other labels.

5. **Post the comment.** Call `mcp__claude_ai_Linear__save_comment`:

   ```
   🤖 Blocked — <reason>
   ```

6. **Print confirmation:**
   > Marked <key> as agent-blocked.

## Side effects

- Adds `agent-blocked` label.
- Posts one Linear comment.
- Does NOT change status — agent-blocked is informational, not a status.
- No git operations.

## Failure modes

| Condition | Action |
|---|---|
| Issue not found | Stop with error. |
| `agent-blocked` label missing from workspace | Stop, point at `/linear-init`. |
| `save_comment` fails | Surface error, stop. Don't try to undo the label add. |

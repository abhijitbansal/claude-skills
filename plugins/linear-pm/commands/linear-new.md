---
description: File a new Linear issue in the configured project using the standard template (Why / What / Acceptance criteria / Notes). Pulls relevant context from the current conversation into Notes when obvious.
model: sonnet
---

# /linear-new

File a new Linear issue.

## Usage

- `/linear-new` — interactive, prompts for title.
- `/linear-new "Issue title"` — uses the provided title.

## Procedure

1. Source `${CLAUDE_PLUGIN_ROOT}/skills/linear-pm/scripts/load-config.sh` (or `.claude/skills/linear-pm/scripts/load-config.sh` if `${CLAUDE_PLUGIN_ROOT}` is unset — project-local copy instead of plugin install). Stop on error.

2. **Title:** if not given as argument, ask the user. Trim whitespace; reject empty.

3. **Type label:** ask the user to pick one of `bug` / `feature` / `chore` / `docs`. Required — no default.

4. **Body:** fill the template, pulling context from the current conversation when obvious:

   ```
   ## Why
   <ask the user for motivation in one sentence>

   ## What
   <ask the user for concrete description, OR pre-fill from conversation context if a clear request was just made>

   ## Acceptance criteria
   - [ ] <ask the user for at least one observable criterion>

   ## Notes
   <if there is a recent file path, error message, diff, or stack trace in the conversation that relates to the issue, include a short excerpt with a back-reference (e.g. "See ContentView.swift:42"); otherwise leave blank>
   ```

5. **Create the issue.** Call `mcp__claude_ai_Linear__save_issue` with:
   - `team: $LINEAR_PM_TEAM`
   - `project: $LINEAR_PM_PROJECT`
   - `title: <user title>`
   - `description: <filled template>`
   - `labels`: array containing the chosen type label PLUS each item in `$LINEAR_PM_DEFAULT_LABELS` (the loader exports this as a newline-separated string — split on newlines, skip empties, then concatenate with the type label into a single array passed to `save_issue`).

6. **Print the result:**
   > Created `<key>: <title>` — `<url>`

7. **Suggest session rename.** Follow the *Session-rename suggestion* protocol in the `linear-pm` skill: scan the conversation for prior team-prefixed keys already touched in this session, dedupe, append the new key, and emit a fenced `/rename <keys>` block as the final line.

## Side effects

- One Linear issue created.
- No labels created (only applied). If a `default_label` is missing in Linear, surface a clear error suggesting `/linear-init` to re-sync labels.
- No git operations.
- One emitted `/rename …` suggestion line (copy-pasteable text; user runs it manually).

## Failure modes

| Condition | Action |
|---|---|
| User cancels at any prompt | Stop, no issue created. |
| Required AC empty | Ask once more; stop on second empty. |
| Label not found | Stop with error pointing at `/linear-init`. |
| `save_issue` fails | Print error verbatim, stop. |

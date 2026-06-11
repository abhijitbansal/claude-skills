---
description: Bootstrap Linear PM in the current repo — interactive setup of `.claude/linear.yml` and creation of the standard label vocabulary (`agent-ready`, `agent-blocked`, `needs-spec`, `bug`, `feature`, `chore`, `docs`).
model: sonnet
---

# /linear-init

Interactive bootstrap for a new repo.

## Procedure

1. **Check for existing config.** If `.claude/linear.yml` already exists, ask: "A config already exists. Overwrite? (yes / no)". Default no. Stop on no.

2. **Ask which Linear team.** Call `mcp__claude_ai_Linear__list_teams`. Present the list with keys (e.g. "ABH — Abhijitbansal"). Ask the user to pick by key.

3. **Ask which project.** Call `mcp__claude_ai_Linear__list_projects` filtered by `team: <key>`. Present the list. Options:
   - Pick existing project by name
   - Create a new project (call `mcp__claude_ai_Linear__save_project` with the new name)

4. **Write `.claude/linear.yml`** by copying `${CLAUDE_PLUGIN_ROOT}/skills/linear-pm/templates/linear.yml.template` and substituting:
   - `REPLACE_TEAM_KEY` → user's choice
   - `REPLACE_PROJECT_NAME` → user's choice
   Default `autonomy: review-only`. Default `poll.enabled: false`. Default `verify: []`.

5. **Ensure standard labels exist.** For each of `agent-ready`, `agent-blocked`, `needs-spec`, `bug`, `feature`, `chore`, `docs`:
   - Call `mcp__claude_ai_Linear__list_issue_labels` filtered by team + query=<label name>.
   - If missing, call `mcp__claude_ai_Linear__create_issue_label` with sensible colors:
     - `agent-ready` → green
     - `agent-blocked` → red
     - `needs-spec` → orange
     - `bug` → red
     - `feature` → blue
     - `chore` → gray
     - `docs` → purple

6. **Print next steps:**
   > Created `.claude/linear.yml` with `autonomy: review-only` (skill writes to Linear, never touches code).
   >
   > Next:
   > - Review the file and commit it.
   > - Add any project-specific `verify:` commands (build, test runners).
   > - To enable autonomous code work, flip `autonomy: allowed` per repo.

## Side effects

- Writes `.claude/linear.yml` (gitignored? no — committed).
- Creates Linear labels if missing. Idempotent on re-run.
- Never deletes labels.
- Stages the config file but does not commit.

## Failure modes

| Condition | Action |
|---|---|
| User cancels at any prompt | Stop. Don't write the file. Don't create labels. |
| MCP team/project list fails | Surface error, stop. |
| `save_project` fails | Print error, ask if user wants to retry or pick existing. |
| `create_issue_label` fails for one label | Continue with others, report which failed at the end. |

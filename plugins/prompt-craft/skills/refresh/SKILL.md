---
name: refresh
description: Rebuild the prompt-craft command registry and usage profile, and print a summary of installed commands and your personalized recommendations. Use when you install or update plugins and want the advisor to pick them up immediately, or say "refresh prompt-craft", "rebuild the command registry".
disable-model-invocation: true
---

# Refresh the command advisor

Rebuilds the machine-global registry (`~/.claude/prompt-craft/registry.json`) and
usage profile (`~/.claude/prompt-craft/profile.json`) from the current repo + your
installed plugins, then summarizes what changed. Nothing is written into the repo.

## Steps

1. **Rebuild the registry** (both scopes, atomic write):
   ```sh
   /usr/bin/python3 "${CLAUDE_PLUGIN_ROOT}/scripts/build_registry.py" --repo-root "$PWD"
   ```
2. **Relearn usage** (honors `CLAUDE_CODE_SKIP_PROMPT_HISTORY`):
   ```sh
   /usr/bin/python3 "${CLAUDE_PLUGIN_ROOT}/scripts/learn_history.py"
   ```
3. **Summarize** from `~/.claude/prompt-craft/registry.json`: N commands across M
   sources; your top personalized recommendations; commands newly discovered since the
   last build. Naming: prompt-craft's own commands are `/prompt-craft:<name>`; bare
   forms (`/commit`, `/pr`, `/goal`, `/ecc:plan`, `/code-review`) are external/canonical.

## Statusline wiring (optional, reversible)

Adds a persistent next-command hint segment by pointing `~/.claude/settings.json`
`statusLine.command` at a stable shim (`~/.claude/prompt-craft/statusline.sh`).
The edit is atomic, backed up (`0600`), and reversible.

1. **Preview** the change (no write):
   ```sh
   /usr/bin/python3 "${CLAUDE_PLUGIN_ROOT}/scripts/wire_statusline.py" --wire --dry-run
   ```
2. **Confirm with the user** (show before/after). Only on explicit confirmation:
   ```sh
   /usr/bin/python3 "${CLAUDE_PLUGIN_ROOT}/scripts/wire_statusline.py" --wire
   ```
3. **Undo** anytime:
   ```sh
   /usr/bin/python3 "${CLAUDE_PLUGIN_ROOT}/scripts/wire_statusline.py" --unwire
   ```

Manual recovery: if anything looks wrong, restore the timestamped backup:
`cp ~/.claude/settings.json.bak.<ts> ~/.claude/settings.json`.

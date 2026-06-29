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
   python3 "${CLAUDE_PLUGIN_ROOT}/scripts/build_registry.py" --repo-root "$PWD"
   ```
2. **Relearn usage** (honors `CLAUDE_CODE_SKIP_PROMPT_HISTORY`):
   ```sh
   python3 "${CLAUDE_PLUGIN_ROOT}/scripts/learn_history.py"
   ```
3. **Summarize** from `~/.claude/prompt-craft/registry.json`: N commands across M
   sources; your top personalized recommendations; commands newly discovered since the
   last build. Naming: prompt-craft's own commands are `/prompt-craft:<name>`; bare
   forms (`/commit`, `/pr`, `/goal`, `/ecc:plan`, `/code-review`) are external/canonical.

## Statusline wiring (optional)

To add a persistent next-command hint segment to your statusline, see the
`--wire-statusline` / `--unwire-statusline` flags (added in Task 12). The edit to
`~/.claude/settings.json` is atomic, backed up, confirmed, and reversible.

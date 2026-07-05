#!/usr/bin/env bash
# prompt-craft statusline shim. settings.json points here so plugin updates do
# not dangle a version-pinned cache path. Resolves the current plugin version
# at runtime and runs the real statusline_hint.sh. Falls back to the recorded
# base statusline if the plugin is not found.
set -uo pipefail
INPUT="$(cat)"

HINT_SCRIPT=""
for d in "${HOME}"/.claude/plugins/cache/*/prompt-craft/*/hooks/statusline_hint.sh; do
  [ -f "$d" ] && HINT_SCRIPT="$d"
done

if [ -z "$HINT_SCRIPT" ]; then
  BASE_FILE="${HOME}/.claude/prompt-craft/base-statusline"
  if [ -f "$BASE_FILE" ]; then
    BASE_CMD="$(cat "$BASE_FILE")"
    # Guard: skip if sidecar references our own scripts (would recurse).
    case "$BASE_CMD" in
      *statusline_hint.sh*|*statusline.sh*)
        ;;
      *)
        printf '%s' "$INPUT" | bash -c "$BASE_CMD" 2>/dev/null || true
        ;;
    esac
  fi
  exit 0
fi
printf '%s' "$INPUT" | bash "$HINT_SCRIPT"
exit 0

#!/usr/bin/env bash
# prompt-craft statusline shim. settings.json points here so plugin updates do
# not dangle a version-pinned cache path. Resolves the newest installed plugin
# version at runtime and runs the real statusline_hint.sh. Falls back to the
# recorded base statusline if the plugin is not found.
set -uo pipefail
INPUT="$(cat)"

# Newest version by version order (0.3.10 after 0.3.9), not lexical glob order.
HINT_SCRIPT="$(printf '%s\n' "${HOME}"/.claude/plugins/cache/*/prompt-craft/*/hooks/statusline_hint.sh | sort -V | tail -n 1)"
[ -f "$HINT_SCRIPT" ] || HINT_SCRIPT=""

if [ -z "$HINT_SCRIPT" ]; then
  BASE_FILE="${HOME}/.claude/prompt-craft/base-statusline"
  if [ -f "$BASE_FILE" ]; then
    BASE_CMD="$(cat "$BASE_FILE")"
    SHIM="${HOME}/.claude/prompt-craft/statusline.sh"
    # Guard: skip only a base that references OUR shim or hint script (would
    # recurse). Exact paths, so a user's own statusline.sh elsewhere still runs.
    # SC2016: the quoted $HOME forms are literal text to match, not expansions.
    # shellcheck disable=SC2254,SC2016
    case "$BASE_CMD" in
      *"$SHIM"* | *'~/.claude/prompt-craft/statusline.sh'* | *'$HOME/.claude/prompt-craft/statusline.sh'* | *'${HOME}/.claude/prompt-craft/statusline.sh'* | *prompt-craft*statusline_hint.sh*)
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

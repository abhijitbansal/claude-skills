#!/usr/bin/env bash
# PostToolUse hook (OPT-IN, off by default). Enable with
# PROMPT_CRAFT_FORMAT_ON_EDIT=1. Formats the just-edited file with whatever
# formatter is installed for its type. Always non-blocking (exit 0).
set -uo pipefail

[[ "${PROMPT_CRAFT_FORMAT_ON_EDIT:-0}" == "1" ]] || exit 0

INPUT="$(cat)"
FILE="$(printf '%s' "$INPUT" | /usr/bin/python3 -c 'import sys, json
try:
    print(json.load(sys.stdin).get("tool_input", {}).get("file_path", ""))
except Exception:
    print("")' 2>/dev/null)"

[[ -n "$FILE" && -f "$FILE" ]] || exit 0

# Run a formatter only if it's installed; never fail the tool call.
run_fmt() { command -v "$1" >/dev/null 2>&1 && "$@" >/dev/null 2>&1 || true; }

case "$FILE" in
  *.py)                                run_fmt black "$FILE" ;;
  *.ts | *.tsx | *.js | *.jsx | *.json | *.css | *.md) run_fmt prettier --write "$FILE" ;;
  *.go)                                run_fmt gofmt -w "$FILE" ;;
  *.rs)                                run_fmt rustfmt "$FILE" ;;
  *.sh)                                run_fmt shfmt -w "$FILE" ;;
esac
exit 0

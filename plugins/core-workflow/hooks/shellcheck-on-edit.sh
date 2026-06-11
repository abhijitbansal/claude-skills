#!/usr/bin/env bash
# PostToolUse hook: lint .sh files with shellcheck after Edit/Write.
# Non-blocking — shellcheck output is surfaced to Claude as informational.
set -uo pipefail

input=$(cat)
file=$(printf '%s' "$input" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get("tool_input", {}).get("file_path", ""))
except Exception:
    pass
' 2>/dev/null)

[[ "$file" == *.sh ]] || exit 0
[[ -f "$file" ]] || exit 0
command -v shellcheck >/dev/null 2>&1 || exit 0

output=$(shellcheck "$file" 2>&1) || true
if [[ -n "$output" ]]; then
  printf 'shellcheck findings for %s:\n%s\n' "$file" "$output"
fi
exit 0

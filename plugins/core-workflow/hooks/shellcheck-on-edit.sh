#!/usr/bin/env bash
# PostToolUse hook: lint .sh files with shellcheck after Edit/Write.
# Non-blocking. Plain exit-0 stdout on PostToolUse goes to the debug log, never
# to Claude, so findings are returned as hookSpecificOutput.additionalContext.
# hooks.json filters this hook to *.sh paths with two `if` rules (Edit, Write);
# the extension check below stays as a backstop.
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
[[ -n "$output" ]] || exit 0

printf 'shellcheck findings for %s:\n%s\n' "$file" "$output" | python3 -c '
import sys, json
print(json.dumps({"hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": sys.stdin.read()}}))
'
exit 0

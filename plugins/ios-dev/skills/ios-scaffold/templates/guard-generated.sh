#!/usr/bin/env bash
# PreToolUse hook (matcher: Edit|Write|MultiEdit): block edits to generated
# files. Rendered by ios-dev ios-scaffold into .claude/hooks/guard-generated.sh.
#
# project.yml is the source of truth; the .xcodeproj it generates is rebuilt by
# xcodegen, so a hand edit is silently lost. Edit project.yml instead.
#
# Protocol: tool call JSON on stdin; exit 2 + stderr blocks the call, exit 0
# allows it. Fails CLOSED without jq: if the path cannot be read, nothing is
# let through. Only shell builtins are used before the jq check.
set -uo pipefail

IFS= read -r -d '' INPUT || true

if ! command -v jq >/dev/null 2>&1; then
  echo "guard-generated: jq is not installed, so the edited path cannot be checked; blocking. Install jq (brew install jq)." >&2
  exit 2
fi

FILE="$(printf '%s' "${INPUT}" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null)"
[[ -n "${FILE}" ]] || exit 0

case "${FILE}" in
  *.xcodeproj|*.xcodeproj/*|*/DerivedData/*)
    echo "guard-generated: '${FILE}' is generated (XcodeGen/Xcode output). Edit project.yml and run 'xcodegen generate' instead." >&2
    exit 2 ;;
esac
exit 0

#!/usr/bin/env bash
# Stop hook: after Claude finishes, suggest 1-3 relevant follow-up slash commands
# based on the git state of the working directory, surfaced via additionalContext.
# Silent (exit 0, no output) outside a git repo or when there's nothing to suggest.
set -uo pipefail

INPUT="$(cat)"
CWD="$(printf '%s' "$INPUT" | /usr/bin/python3 -c 'import sys, json
try:
    print(json.load(sys.stdin).get("cwd", ""))
except Exception:
    print("")' 2>/dev/null)"

[[ -n "$CWD" && -d "$CWD" ]] || exit 0
git -C "$CWD" rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

suggestions=()

if [[ -n "$(git -C "$CWD" status --porcelain 2>/dev/null)" ]]; then
  # Uncommitted work -> snapshot it, and review the diff before doing so.
  suggestions+=("/prompt-craft:review to check the diff")
  suggestions+=("/commit to save this work")
else
  # Clean tree but local commits not pushed -> offer to open a PR.
  upstream="$(git -C "$CWD" rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)"
  if [[ -n "$upstream" ]]; then
    ahead="$(git -C "$CWD" rev-list --count '@{upstream}..HEAD' 2>/dev/null || echo 0)"
    [[ "$ahead" =~ ^[0-9]+$ ]] || ahead=0
    if (( ahead > 0 )); then
      suggestions+=("/pr to open a pull request (${ahead} unpushed commit(s))")
    fi
  fi
fi

(( ${#suggestions[@]} == 0 )) && exit 0

msg="Next steps you might run:"
for s in "${suggestions[@]}"; do
  msg+=" ${s};"
done
msg="${msg%;}"

/usr/bin/python3 -c 'import json, sys
print(json.dumps({"hookSpecificOutput": {"hookEventName": "Stop", "additionalContext": sys.argv[1]}}))' "$msg"
exit 0

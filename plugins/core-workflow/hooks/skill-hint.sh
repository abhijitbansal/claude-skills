#!/usr/bin/env bash
# PostToolUse / PostToolUseFailure hook (matcher: Bash).
# Points the model at a lesson skill when that skill's literal error text shows
# up in a Bash result. Three exact-string rows, nothing fuzzy. Output is
# hookSpecificOutput.additionalContext JSON; any other outcome prints nothing.
#
# Why a hook and not a description trigger: these skills describe a literal
# error, and the model rarely loads them when the symptom appears. A hook sees
# the tool result; an `if` filter only sees the tool input, so the match is done
# here on the payload read from stdin.
#
# Suppression: when the command text itself contains the matched string (a grep
# or cat over a skill file), the hit is a quote, not a symptom, and stays silent.
set -uo pipefail

python3 -c '
import json, sys

# (skill, [any-of exact strings])
ROWS = [
    ("core-workflow:blast-radius-rm-hold-unattended-subagent-stall",
     ["Blast Radius held this command and did not run it"]),
    ("core-workflow:worktree-isolation-guard-refuses-complex-bash",
     ["redirects git to the shared checkout",
      "too complex to verify that it stays inside the worktree",
      "stay inside the worktree"]),
    ("core-workflow:xcode-license-blocks-git-exit-69",
     ["You have not agreed to the Xcode license"]),
]

def flatten(v):
    if v is None:
        return ""
    if isinstance(v, str):
        return v
    if isinstance(v, dict):
        return "\n".join(flatten(x) for x in v.values())
    if isinstance(v, (list, tuple)):
        return "\n".join(flatten(x) for x in v)
    return str(v)

try:
    d = json.load(sys.stdin)
    if not isinstance(d, dict):
        raise ValueError
except Exception:
    sys.exit(0)

tool_input = d.get("tool_input")
command = tool_input.get("command", "") if isinstance(tool_input, dict) else ""
command = command if isinstance(command, str) else ""
text = flatten(d.get("tool_response")) + "\n" + flatten(d.get("error"))

for skill, needles in ROWS:
    # A quote in the command (first 24 chars of the needle) is not a symptom.
    hit = next((n for n in needles if n in text and n[:24] not in command), None)
    if hit:
        msg = ("This output matches a known lesson. The skill %s covers it; "
               "load it with the Skill tool before retrying the command." % skill)
        event = d.get("hook_event_name") or "PostToolUse"
        print(json.dumps({"hookSpecificOutput": {
            "hookEventName": event, "additionalContext": msg}}))
        break
'
exit 0

#!/usr/bin/env bash
# statusLine command for Claude Code.
#
# Reads the standard statusLine JSON payload on stdin and prints a single
# line summarising what Claude is currently doing:
#
#   <git-branch> | skill: <skill> | (<done>/<total>) <activeForm of in-progress todo>
#
# Sections collapse cleanly when their data is missing — branch only when
# inside a git repo, skill only when a `Skill` tool_use has fired since the
# last user message, todos only when a TodoWrite has been issued.
#
# Self-contained: no dependencies beyond bash + /usr/bin/python3 + git.
# Repo-local on purpose — meant to be lifted into a shared plugin once
# proven.

set -uo pipefail

INPUT="$(cat)"

read -r TRANSCRIPT CWD < <(printf '%s' "$INPUT" | /usr/bin/python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    print(" ")
    sys.exit(0)
t = d.get("transcript_path", "") or ""
c = d.get("cwd", "") or d.get("workspace", {}).get("current_dir", "") or ""
print(f"{t}\t{c}")
' | awk -F'\t' '{print $1" "$2}')

# Git branch (when in a repo).
BRANCH=""
if [[ -n "${CWD:-}" && -d "$CWD" ]]; then
  BRANCH="$(git -C "$CWD" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
fi

# Parse the transcript for the most recent Skill call (scoped to the
# current turn — stop at the last user message) and the most recent
# TodoWrite payload.
SUMMARY=""
if [[ -n "${TRANSCRIPT:-}" && -f "$TRANSCRIPT" ]]; then
  SUMMARY="$(/usr/bin/python3 - "$TRANSCRIPT" <<'PY'
import json, sys

path = sys.argv[1]
try:
    with open(path, "r", encoding="utf-8", errors="ignore") as fh:
        lines = fh.readlines()
except OSError:
    print("")
    sys.exit(0)

skill = None         # most recent Skill within current turn
skill_locked = False # stop updating once we cross a user boundary
todos = None         # most recent TodoWrite payload (full conversation)

# Walk backwards so the FIRST match we see is the most recent.
for raw in reversed(lines):
    raw = raw.strip()
    if not raw:
        continue
    try:
        rec = json.loads(raw)
    except Exception:
        continue

    rtype = rec.get("type", "")

    # A user message bounds the "current turn" for skill detection.
    if rtype == "user" and not skill_locked:
        skill_locked = True

    if rtype != "assistant":
        continue

    msg = rec.get("message", {}) or {}
    for block in msg.get("content", []) or []:
        if not isinstance(block, dict):
            continue
        if block.get("type") != "tool_use":
            continue
        name = block.get("name", "")
        inp = block.get("input", {}) or {}

        if name == "Skill" and not skill_locked and skill is None:
            s = inp.get("skill") or ""
            if s:
                skill = s
        elif name == "TodoWrite" and todos is None:
            todos = inp.get("todos") or []

    if skill is not None and todos is not None:
        break

parts = []

if skill:
    parts.append(f"skill: {skill}")

if isinstance(todos, list) and todos:
    total = len(todos)
    done = sum(1 for t in todos if (t or {}).get("status") == "completed")
    current = next((t for t in todos if (t or {}).get("status") == "in_progress"), None)
    if current is None:
        current = next((t for t in todos if (t or {}).get("status") == "pending"), None)
    if current is None:
        # All done — surface the last completed item.
        current = next((t for t in reversed(todos) if (t or {}).get("status") == "completed"), None)
    label = ""
    if current:
        label = current.get("activeForm") or current.get("content") or ""
    counter = f"({done}/{total})"
    if label:
        parts.append(f"{counter} {label}")
    else:
        parts.append(counter)

print(" | ".join(parts))
PY
)"
fi

OUT=""
[[ -n "$BRANCH" ]] && OUT="$BRANCH"
if [[ -n "$SUMMARY" ]]; then
  if [[ -n "$OUT" ]]; then
    OUT="$OUT | $SUMMARY"
  else
    OUT="$SUMMARY"
  fi
fi

# Truncate to keep the status line readable in narrow IDE panels.
MAX=140
if (( ${#OUT} > MAX )); then
  OUT="${OUT:0:MAX-1}…"
fi

printf '%s\n' "$OUT"

#!/usr/bin/env bash
# UserPromptSubmit: surface prompt-specific command recommendations to the USER
# via a TOP-LEVEL {"systemMessage": ...}. Never feeds the model (no
# additionalContext / stdout-to-model). Silent (exit 0, no output) on no match.
set -uo pipefail

INPUT="$(cat)"
SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../scripts" && pwd)"

# Build the advisor context entirely in python so the prompt text never reaches
# bash word-splitting. Computes git state via subprocess inside the same process.
CTX="$(printf '%s' "$INPUT" | /usr/bin/python3 -c '
import sys, json, os, subprocess
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
cwd = d.get("cwd") or os.getcwd()
prompt = d.get("prompt")
dirty, unpushed = False, 0
if cwd and os.path.isdir(cwd):
    def g(*a):
        return subprocess.run(["git", "-C", cwd, *a], capture_output=True, text=True)
    if g("rev-parse", "--is-inside-work-tree").returncode == 0:
        dirty = bool(g("status", "--porcelain").stdout.strip())
        up = g("rev-list", "--count", "@{upstream}..HEAD")
        if up.returncode == 0 and up.stdout.strip().isdigit():
            unpushed = int(up.stdout.strip())
json.dump({"prompt": prompt, "git_state": {"dirty": dirty, "unpushed": unpushed}, "cwd": cwd}, sys.stdout)
' 2>/dev/null)"
[ -n "$CTX" ] || exit 0

OUT="$(printf '%s' "$CTX" | python3 "${SCRIPTS}/advisor.py" --mode prompt 2>/dev/null || true)"
[ -n "$OUT" ] || exit 0

# Wrap as TOP-LEVEL systemMessage. The banner is DATA: json.dumps escapes it.
printf '%s' "$OUT" | /usr/bin/python3 -c 'import sys, json
print(json.dumps({"systemMessage": sys.stdin.read()}))'
exit 0

#!/usr/bin/env bash
# Stop hook: after a turn, suggest follow-up slash commands based on git state,
# surfaced to the USER via a TOP-LEVEL {"systemMessage": ...} (never the model).
# Routed through advisor.py --mode=stop. Silent (exit 0) when nothing fits.
set -uo pipefail

INPUT="$(cat)"
SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../scripts" && pwd)"

CTX="$(printf '%s' "$INPUT" | /usr/bin/python3 -c '
import sys, json, os, subprocess
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
cwd = d.get("cwd") or os.getcwd()
dirty, unpushed = False, 0
if cwd and os.path.isdir(cwd):
    def g(*a):
        return subprocess.run(["git", "-C", cwd, *a], capture_output=True, text=True)
    if g("rev-parse", "--is-inside-work-tree").returncode == 0:
        dirty = bool(g("status", "--porcelain").stdout.strip())
        up = g("rev-list", "--count", "@{upstream}..HEAD")
        if up.returncode == 0 and up.stdout.strip().isdigit():
            unpushed = int(up.stdout.strip())
json.dump({"prompt": None, "git_state": {"dirty": dirty, "unpushed": unpushed}, "cwd": cwd}, sys.stdout)
' 2>/dev/null)"
[ -n "$CTX" ] || exit 0

OUT="$(printf '%s' "$CTX" | /usr/bin/python3 "${SCRIPTS}/advisor.py" --mode stop 2>/dev/null || true)"
[ -n "$OUT" ] || exit 0

printf '%s' "$OUT" | /usr/bin/python3 -c 'import sys, json
print(json.dumps({"systemMessage": sys.stdin.read()}))'
exit 0

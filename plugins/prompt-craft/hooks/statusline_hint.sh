#!/usr/bin/env bash
# statusLine segment: "<base> | 💡 next: /x". Chains to the recorded base
# statusline, appends the advisor hint, strips ANSI before width-measuring,
# appends a reset after truncation, caps at 140, guards self-reference.
set -uo pipefail

INPUT="$(cat)"
SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../scripts" && pwd)"
SIDECAR="${HOME}/.claude/prompt-craft/base-statusline"
SHIM="${HOME}/.claude/prompt-craft/statusline.sh"
MAX=140

# Base statusline (sidecar). Skip if it self-references (would recurse).
BASE=""
if [ -f "$SIDECAR" ]; then
  BASE_CMD="$(cat "$SIDECAR")"
  # SC2254: variable in case pattern is intentional (matching any path containing the name).
  # Also catch tilde-form of the shim basename (*statusline.sh*) which $SHIM (expanded) wouldn't match.
  # shellcheck disable=SC2254
  case "$BASE_CMD" in
    *statusline_hint.sh*|*statusline.sh*|*"$SHIM"*)
      BASE=""
      ;;
    *)
      BASE="$(printf '%s' "$INPUT" | bash -c "$BASE_CMD" 2>/dev/null || true)"
      ;;
  esac
fi

# Hint via advisor (statusline mode). Build context (git state) in python first.
CTX="$(printf '%s' "$INPUT" | /usr/bin/python3 -c '
import sys, json, os, subprocess
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
cwd = d.get("cwd") or d.get("workspace", {}).get("current_dir") or os.getcwd()
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
HINT=""
[ -n "$CTX" ] && HINT="$(printf '%s' "$CTX" | /usr/bin/python3 "${SCRIPTS}/advisor.py" --mode statusline 2>/dev/null || true)"

SEG=""
[ -n "$HINT" ] && SEG="💡 $HINT"
if [ -n "$BASE" ] && [ -n "$SEG" ]; then
  OUT="$BASE | $SEG"
elif [ -n "$BASE" ]; then
  OUT="$BASE"
else
  OUT="$SEG"
fi

# Strip ANSI for width measurement; cap at MAX; always append a reset.
printf '%s' "$OUT" | MAX="$MAX" /usr/bin/python3 -c '
import sys, re, os
MAX = int(os.environ["MAX"])
s = sys.stdin.read()
plain = re.sub(r"\x1b\[[0-9;]*m", "", s)
if len(plain) > MAX:
    s = plain[:MAX - 1] + "…"
sys.stdout.write(s + "\x1b[0m\n")
'
exit 0

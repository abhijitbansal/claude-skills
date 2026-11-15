#!/usr/bin/env bash
# statusLine segment: "<base> | 💡 next: /x". Chains to the recorded base
# statusline and appends the advisor hint only when the whole line fits in MAX
# columns (the user's own line is never truncated or recoloured). Strips ANSI
# before width-measuring, always appends a reset, and skips a base that points
# back at this plugin (would recurse). PROMPT_CRAFT_ADVISOR=0 drops the hint.
set -uo pipefail

INPUT="$(cat)"
SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../scripts" && pwd)"
SIDECAR="${HOME}/.claude/prompt-craft/base-statusline"
SHIM="${HOME}/.claude/prompt-craft/statusline.sh"
MAX=140

# Base statusline (sidecar). Skip it only if it references OUR shim or OUR hint
# script: an exact-path match, not a "*statusline.sh*" glob, so a user's own
# ~/.claude/statusline.sh (or mystatusline.sh) still renders.
BASE=""
if [ -f "$SIDECAR" ]; then
  BASE_CMD="$(cat "$SIDECAR")"
  # SC2254: variable in case pattern is intentional (matching any command containing the path).
  # The tilde/$HOME forms cover a sidecar written before expansion.
  # SC2016: the quoted $HOME forms are literal text to match, not expansions.
  # shellcheck disable=SC2254,SC2016
  case "$BASE_CMD" in
    *"$SHIM"* | *'~/.claude/prompt-craft/statusline.sh'* | *'$HOME/.claude/prompt-craft/statusline.sh'* | *'${HOME}/.claude/prompt-craft/statusline.sh'* | *prompt-craft*statusline_hint.sh*)
      BASE=""
      ;;
    *)
      BASE="$(printf '%s' "$INPUT" | bash -c "$BASE_CMD" 2>/dev/null || true)"
      ;;
  esac
fi

# Hint via advisor (statusline mode). Build context (git state) in python first.
HINT=""
if [ "${PROMPT_CRAFT_ADVISOR:-1}" != "0" ]; then
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
  [ -n "$CTX" ] && HINT="$(printf '%s' "$CTX" | /usr/bin/python3 "${SCRIPTS}/advisor.py" --mode statusline 2>/dev/null || true)"
fi

SEG=""
[ -n "$HINT" ] && SEG="💡 $HINT"

# Compose: base alone when it is already wide, else "<base> | <hint>". Width is
# measured on the ANSI-stripped text; the emoji counts as two columns.
BASE="$BASE" SEG="$SEG" MAX="$MAX" /usr/bin/python3 -c '
import os, re, sys
MAX = int(os.environ["MAX"])
base, seg = os.environ["BASE"], os.environ["SEG"]
def width(s):
    return len(re.sub(r"\x1b\[[0-9;]*m", "", s)) + s.count("\U0001F4A1")
if base and seg:
    out = base + " | " + seg if width(base) + 3 + width(seg) <= MAX else base
elif base:
    out = base
else:
    out = seg if width(seg) <= MAX else seg[:MAX - 1] + "…"
sys.stdout.write(out + "\x1b[0m\n")
'
exit 0

#!/usr/bin/env bash
# Stop hook: remind Claude to run ./build.sh before declaring done
# when Swift/project files are dirty in the Paperix project.
#
# Reads JSON hook input on stdin, emits decision JSON on stdout.
# Exits 0 silently when not in Paperix or when no reminder is needed.

set -uo pipefail

INPUT="$(cat)"

# Extract cwd and transcript_path from hook input.
CWD="$(printf '%s' "$INPUT" | /usr/bin/python3 -c 'import sys,json
try:
    d=json.load(sys.stdin)
    print(d.get("cwd",""))
except Exception:
    print("")')"
TRANSCRIPT="$(printf '%s' "$INPUT" | /usr/bin/python3 -c 'import sys,json
try:
    d=json.load(sys.stdin)
    print(d.get("transcript_path",""))
except Exception:
    print("")')"

[[ -z "$CWD" ]] && exit 0

# Walk up to find Paperix project root (must have build.sh AND project.yml).
PROJECT_ROOT=""
DIR="$CWD"
while [[ "$DIR" != "/" && -n "$DIR" ]]; do
  if [[ -f "$DIR/build.sh" && -f "$DIR/project.yml" ]]; then
    PROJECT_ROOT="$DIR"
    break
  fi
  DIR="$(dirname "$DIR")"
done

[[ -z "$PROJECT_ROOT" ]] && exit 0

# Look for dirty Swift / project / build.sh changes.
DIRTY="$(cd "$PROJECT_ROOT" && git status --porcelain 2>/dev/null \
  | awk '{print $NF}' \
  | grep -E '\.swift$|(^|/)project\.yml$|(^|/)build\.sh$' || true)"

[[ -z "$DIRTY" ]] && exit 0

# If build.sh ran recently in the transcript, don't nag.
if [[ -n "$TRANSCRIPT" && -f "$TRANSCRIPT" ]]; then
  if tail -n 200 "$TRANSCRIPT" 2>/dev/null | grep -q -E '(\./|/)build\.sh'; then
    exit 0
  fi
fi

# Inject a blocking reminder so Claude actually runs the build before stopping.
DIRTY_LIST="$(printf '%s' "$DIRTY" | head -n 10 | tr '\n' ',' | sed 's/,$//')"
cat <<EOF
{
  "decision": "block",
  "reason": "Paperix has uncommitted Swift/project changes ($DIRTY_LIST) and ./build.sh has not run this turn. Run it from $PROJECT_ROOT before declaring done (per CLAUDE.md: 'Build before declaring done')."
}
EOF

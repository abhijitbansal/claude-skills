#!/usr/bin/env bash
# Stop hook: remind Claude to run ./build.sh before declaring done
# when Swift/project files are dirty in the configured iOS app.
#
# Reads JSON hook input on stdin, emits decision JSON on stdout.
# The app is identified structurally (a dir with both build.sh and
# project.yml); its display name comes from .claude/app.yml (app.name),
# falling back to the project directory name.
# Exits 0 silently when outside such a project or when no reminder is needed.

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

# Walk up to find the app project root (must have build.sh AND project.yml).
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

# Resolve a display name for the reminder: prefer .claude/app.yml app.name,
# else fall back to the project directory's basename. Keeps the message
# app-specific without hardcoding any one app.
APP_NAME=""
if [[ -f "$PROJECT_ROOT/.claude/app.yml" ]]; then
  APP_NAME="$(awk '
    /^app:/        {ina=1; next}
    /^[^[:space:]]/ {ina=0}
    ina && /^[[:space:]]+name:/ {
      sub(/^[[:space:]]+name:[[:space:]]*/, "")
      gsub(/^["'\'']|["'\'']$/, "")
      print; exit
    }' "$PROJECT_ROOT/.claude/app.yml" 2>/dev/null)"
fi
[[ -z "$APP_NAME" ]] && APP_NAME="$(basename "$PROJECT_ROOT")"

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
  "reason": "$APP_NAME has uncommitted Swift/project changes ($DIRTY_LIST) and ./build.sh has not run this turn. Run it from $PROJECT_ROOT before declaring done (per CLAUDE.md: 'Build before declaring done')."
}
EOF

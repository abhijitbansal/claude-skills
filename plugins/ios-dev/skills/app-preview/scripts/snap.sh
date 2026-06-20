#!/usr/bin/env bash
#
# app-preview: take a screenshot of the booted simulator and print the
# absolute path on the LAST line of stdout. The caller is expected to Read
# that path so the image appears inline in the conversation.
#
# Output lands in /tmp/${APP_NAME_LC}-snaps/<branch>/ by default, where <branch>
# is the current git branch with slashes flattened to '--' (see
# branch-dir.sh). This keeps screenshots from different branches from
# stomping each other when the user flips between lines of work.
#
# Usage:
#   snap.sh                # /tmp/${APP_NAME_LC}-snaps/<branch>/${APP_NAME_LC}-snap-YYYYmmdd-HHMMSS.png
#   snap.sh my-label       # ...${APP_NAME_LC}-snap-YYYYmmdd-HHMMSS-my-label.png
#   snap.sh --dir DIR ...  # custom output directory (no branch subfolder appended)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../_lib/load_app_config.sh
source "${SCRIPT_DIR}/../../_lib/load_app_config.sh"
APP_NAME_LC="$(echo "${APP_NAME}" | tr '[:upper:]' '[:lower:]')"

# shellcheck source=branch-dir.sh
source "$SCRIPT_DIR/branch-dir.sh"

OUT_DIR=""
LABEL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) OUT_DIR="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,18p' "$0"; exit 0 ;;
    *) LABEL="${LABEL:+$LABEL-}$1"; shift ;;
  esac
done

# Default to the per-branch subfolder. When --dir is passed, honor it
# verbatim so callers (tests, ad-hoc one-offs) can opt out.
if [[ -z "$OUT_DIR" ]]; then
  OUT_DIR="/tmp/${APP_NAME_LC}-snaps/$(app_branch_slug)"
fi

mkdir -p "$OUT_DIR"

if ! xcrun simctl list devices booted 2>/dev/null | grep -q "(Booted)"; then
  echo "No simulator is booted. Run launch.sh first." >&2
  exit 1
fi

TS="$(date +%Y%m%d-%H%M%S)"
SUFFIX="${LABEL:+-$LABEL}"
PATH_OUT="$OUT_DIR/${APP_NAME_LC}-snap-$TS$SUFFIX.png"

xcrun simctl io booted screenshot "$PATH_OUT" >/dev/null

# Print path last so the caller can `... | tail -1` if scripting, and so the
# Read tool target is unambiguous when scanning output.
echo "$PATH_OUT"

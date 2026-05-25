#!/usr/bin/env bash
#
# app-preview: multi-screen, text-driven preview bundle.
#
# The model uses this script after mapping a textual UI description (e.g.
# "spacing on the home row", "the new doc sheet doesn't show the title")
# to a list of screen IDs from the SKILL's screen vocabulary. The script
# is the deterministic side of the loop: launch once, walk each screen,
# screenshot it, deliver it, and write a MANIFEST.md so the user can
# scan the folder later and remember what the run was about.
#
# Screen IDs (Paperix-shaped examples — your app's vocabulary is shaped by
# its handleDeepLink implementation):
#   home              cold launch (ContentView)
#   scan              ${APP_URL_SCHEME}://scan — triggers the scanner sheet over home
#   doc:<rel-path>    ${APP_URL_SCHEME}://doc?path=<rel-path> — opens that document
#
# Anything outside this vocabulary cannot be reached by deep link today;
# the SKILL.md "Navigation" section explains the alternatives.
#
# Flags:
#   --description "<text>"   Verbatim user request, written into MANIFEST.md.
#                            Required (we need *something* to put in the
#                            manifest — empty manifests are confusing later).
#   --screen <id>            Repeatable. One per screen to capture.
#                            At least one is required.
#   --no-build               Forwarded to launch.sh.
#   --sim "<name>"           Forwarded to launch.sh.
#   --no-deliver             Skip deliver.sh entirely (local-only run).
#
# Usage:
#   bundle.sh --description "home row spacing" \
#             --screen home \
#             --screen doc:Receipts/2026-receipt.pdf
#
# Output:
#   /tmp/${APP_NAME_LC}-snaps/<branch>/${APP_NAME_LC}-snap-<ts>-<screen>.png  (one per --screen)
#   /tmp/${APP_NAME_LC}-snaps/<branch>/MANIFEST.md                            (per-run section appended)
#   $(basename "${APP_PREVIEW_ROOT}")/<branch>/...                            (iCloud mirror via deliver.sh)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../_lib/load_app_config.sh
source "${SCRIPT_DIR}/../../_lib/load_app_config.sh"
APP_NAME_LC="$(echo "${APP_NAME}" | tr '[:upper:]' '[:lower:]')"

# shellcheck source=branch-dir.sh
source "$SCRIPT_DIR/branch-dir.sh"

BUNDLE_ID="${APP_BUNDLE_ID}"
DESCRIPTION=""
SCREENS=()
LAUNCH_ARGS=()
DO_DELIVER=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --description) DESCRIPTION="$2"; shift 2 ;;
    --screen)      SCREENS+=("$2"); shift 2 ;;
    --no-build)    LAUNCH_ARGS+=("--no-build"); shift ;;
    --sim)         LAUNCH_ARGS+=("--sim" "$2"); shift 2 ;;
    --no-deliver)  DO_DELIVER=false; shift ;;
    -h|--help)     sed -n '2,38p' "$0"; exit 0 ;;
    *)             echo "[bundle] Unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$DESCRIPTION" ]]; then
  echo "[bundle] --description is required (verbatim user request for the MANIFEST)" >&2
  exit 1
fi
if [[ ${#SCREENS[@]} -eq 0 ]]; then
  echo "[bundle] at least one --screen is required (try: --screen home)" >&2
  exit 1
fi

BRANCH_SLUG="$(paperix_branch_slug)"
SNAP_DIR="/tmp/${APP_NAME_LC}-snaps/$BRANCH_SLUG"
mkdir -p "$SNAP_DIR"
MANIFEST="$SNAP_DIR/MANIFEST.md"

# 1. Build + install + launch (once for the whole bundle).
echo "==> bundle: launching for ${#SCREENS[@]} screen(s)"
# Bash 3.2 (macOS /bin/bash) treats `"${empty_array[@]}"` as an unbound
# variable expansion under `set -u`. The +"${arr[@]}" form expands to
# nothing when the array is empty and to the elements otherwise.
"$SCRIPT_DIR/launch.sh" ${LAUNCH_ARGS[@]+"${LAUNCH_ARGS[@]}"}

# Walk the screen list. Between screens we terminate + relaunch + openurl
# (instead of just openurl) so a previous screen's sheet/modal doesn't
# stack underneath the next one. Cost: ~1s of app cold-start per screen,
# which is fine for a bundle of 2-5 captures.
declare -a CAPTURED=()

snap_to() {
  local label="$1"
  local stamp
  stamp="$(date +%Y%m%d-%H%M%S)"
  local out="$SNAP_DIR/${APP_NAME_LC}-snap-$stamp-$label.png"
  xcrun simctl io booted screenshot "$out" >/dev/null
  echo "$out"
}

for raw in "${SCREENS[@]}"; do
  # Split 'doc:<path>' into id + arg. For other screens the arg is empty.
  id="${raw%%:*}"
  arg=""
  if [[ "$raw" == *:* ]]; then
    arg="${raw#*:}"
  fi

  echo "==> bundle: screen '$id'${arg:+ ($arg)}"

  # Cold-restart between screens so sheets/modals from the previous deep
  # link don't bleed into this capture. The very first iteration skips
  # this because launch.sh already did a clean cold start.
  if [[ ${#CAPTURED[@]} -gt 0 ]]; then
    xcrun simctl terminate booted "$BUNDLE_ID" 2>/dev/null || true
    xcrun simctl launch booted "$BUNDLE_ID" >/dev/null
    # Give the home screen a beat to settle before the next deep link.
    sleep 1
  fi

  case "$id" in
    home)
      # No deep link — launch already landed us here.
      ;;
    scan)
      xcrun simctl openurl booted "${APP_URL_SCHEME}://scan" >/dev/null
      sleep 2  # scanner sheet animation
      ;;
    doc)
      if [[ -z "$arg" ]]; then
        echo "[bundle] 'doc' screen requires a path: --screen doc:<rel-path>" >&2
        exit 1
      fi
      # URL-encode spaces minimally; the only realistic case in store paths.
      local_path="${arg// /%20}"
      xcrun simctl openurl booted "${APP_URL_SCHEME}://doc?path=$local_path" >/dev/null
      sleep 2  # navigation push animation
      ;;
    *)
      echo "[bundle] Unknown screen '$id'. Vocabulary: home, scan, doc:<path>" >&2
      echo "[bundle]   For other surfaces, snap the cold-launch state with --screen home" >&2
      echo "[bundle]   and document the limitation in the MANIFEST." >&2
      exit 1
      ;;
  esac

  # Label suffix: strip the arg for the filename (path separators and dots
  # would make a mess), keep just the screen id.
  out="$(snap_to "$id")"
  CAPTURED+=("$out|$raw")
done

# 2. Append a section to MANIFEST.md. We append rather than overwrite so a
#    folder used across several runs accumulates history — the user can
#    scroll back and see what each batch was about.
{
  echo "## $(date '+%Y-%m-%d %H:%M:%S') — $BRANCH_SLUG"
  echo ""
  echo "**Request:** $DESCRIPTION"
  echo ""
  echo "**Screens captured:**"
  for entry in "${CAPTURED[@]}"; do
    path="${entry%%|*}"
    spec="${entry#*|}"
    echo "- \`$spec\` → \`$(basename "$path")\`"
  done
  echo ""
} >> "$MANIFEST"

# 3. Deliver each captured screenshot. The first one carries the iMessage
#    ping (gives the user a single notification); the rest suppress the
#    ping to avoid notification spam, while still mirroring to iCloud.
if $DO_DELIVER; then
  first=true
  for entry in "${CAPTURED[@]}"; do
    path="${entry%%|*}"
    if $first; then
      "$SCRIPT_DIR/deliver.sh" "$path"
      first=false
    else
      "$SCRIPT_DIR/deliver.sh" --no-ping "$path"
    fi
  done
  # Also mirror the MANIFEST itself, so the user has the index on the phone.
  "$SCRIPT_DIR/deliver.sh" --no-ping "$MANIFEST" || true
fi

# 4. Summary lines on stdout — last line is the manifest path so the caller
#    can grab it with `... | tail -1`.
echo ""
echo "==> bundle: captured ${#CAPTURED[@]} screen(s) into $SNAP_DIR"
for entry in "${CAPTURED[@]}"; do
  echo "    $(basename "${entry%%|*}")  (${entry#*|})"
done
echo "$MANIFEST"

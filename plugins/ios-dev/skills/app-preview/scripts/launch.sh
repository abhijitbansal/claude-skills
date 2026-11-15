#!/usr/bin/env bash
#
# app-preview: build for a simulator, install, and launch.
#
# Usage:
#   launch.sh                     # build, install, launch on the target simulator
#   launch.sh --no-build          # skip build script, just reinstall last build
#   launch.sh --sim "iPhone 17"   # target one simulator by name or UDID
#
# Target simulator: --sim <name|UDID> if given; else the only booted
# simulator; else (none booted) the first iPhone of the newest iOS runtime,
# which is booted. With more than one booted and no --sim, launch.sh refuses
# rather than letting simctl pick. Every simctl call uses the resolved UDID.
# Any other argument exits 2.
#
# Exits non-zero on build/install/launch failure with the underlying error
# surfaced so the caller can react.

set -euo pipefail

ACCEPTED="--no-build, --sim <name|UDID>, -h|--help"
DO_BUILD=true
SIM_NAME=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-build) DO_BUILD=false; shift ;;
    --sim)
      [[ $# -ge 2 ]] || { echo "launch: --sim needs a simulator name or UDID (accepted: ${ACCEPTED})" >&2; exit 2; }
      SIM_NAME="$2"; shift 2 ;;
    -h|--help)  sed -n '2,15p' "$0"; exit 0 ;;
    *)          echo "launch: unknown argument '$1' (accepted: ${ACCEPTED})" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../_lib/load_app_config.sh
source "${SCRIPT_DIR}/../../_lib/load_app_config.sh"
# shellcheck source=sim-resolve.sh
source "${SCRIPT_DIR}/sim-resolve.sh"

# Derive repo root from the app.yml location so this works wherever the skill
# is installed (the skill lives in a separate skills repo, not inside the app
# checkout). APP_YML is set by load_app_config.sh to the found .claude/app.yml;
# the repo root is two directories up from that (app-root/.claude/app.yml).
REPO_ROOT="$(dirname "$(dirname "${APP_YML}")")"
BUNDLE_ID="${APP_BUNDLE_ID}"

cd "$REPO_ROOT"

# 1. Resolve the target to one concrete UDID (refuses on an ambiguous booted set).
SIM_UDID="$(sim_resolve "${SIM_NAME}")" || exit 1

# 2. Ensure Simulator.app is visible. `simctl boot` alone leaves it headless,
#    which is fine for screenshots but unhelpful when the user later wants to
#    look at the window directly.
open -a Simulator

# 3. Boot the target if it is not already booted.
if ! sim_is_booted "${SIM_UDID}"; then
  echo "==> Booting ${SIM_NAME:-simulator} (${SIM_UDID})"
  xcrun simctl boot "${SIM_UDID}"
fi

# 4. Build for simulator (unless --no-build). APP_BUILD_SCRIPT is the single
#    source of truth for project regeneration + xcodebuild flags; don't reinvent.
#    A build script that advertises --no-launch (the ios-scaffold template does)
#    is told to only build, because this script installs and launches itself.
if $DO_BUILD; then
  BUILD_ARGS=()
  [[ -n "$SIM_NAME" ]] && BUILD_ARGS+=(-s "$SIM_NAME")
  if grep -q -e '--no-launch' "./${APP_BUILD_SCRIPT}" 2>/dev/null; then
    BUILD_ARGS+=(--no-launch)
  fi
  ./"${APP_BUILD_SCRIPT}" ${BUILD_ARGS[@]+"${BUILD_ARGS[@]}"}
fi

# 5. Find the freshest .app under DerivedData. The build script prints the path
#    in its last line, but parsing it is brittle — DerivedData lookup is more
#    robust and works for --no-build too.
#    Newest by mtime via the shell's -nt test: BSD `stat -f` does not exist on
#    GNU/Linux (there it means filesystem status), so avoid stat entirely.
APP_PATH=""
while IFS= read -r candidate; do
  if [[ -z "$APP_PATH" || "$candidate" -nt "$APP_PATH" ]]; then
    APP_PATH="$candidate"
  fi
done < <(find "${HOME}/Library/Developer/Xcode/DerivedData" \
  -path "*/Build/Products/Debug-iphonesimulator/${APP_NAME}.app" \
  -not -path '*Index.noindex*' \
  -type d 2>/dev/null || true)

if [[ -z "$APP_PATH" || ! -d "$APP_PATH" ]]; then
  echo "Could not locate ${APP_NAME}.app under DerivedData. Did the build succeed?" >&2
  exit 1
fi

echo "==> Installing $APP_PATH"
xcrun simctl install "${SIM_UDID}" "$APP_PATH"

# 6. Terminate any prior instance so launch shows a clean cold-start state.
xcrun simctl terminate "${SIM_UDID}" "$BUNDLE_ID" 2>/dev/null || true

echo "==> Launching $BUNDLE_ID"
xcrun simctl launch "${SIM_UDID}" "$BUNDLE_ID"

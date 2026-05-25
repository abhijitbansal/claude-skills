#!/usr/bin/env bash
#
# app-preview: build for the booted simulator, install, and launch.
#
# Usage:
#   launch.sh                     # build, install, launch
#   launch.sh --no-build          # skip build script, just reinstall last build
#   launch.sh --sim "iPhone 16 Pro"  # forwarded to build script -s
#
# Exits non-zero on build/install/launch failure with the underlying error
# surfaced so the caller can react.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../_lib/load_app_config.sh
source "${SCRIPT_DIR}/../../_lib/load_app_config.sh"
APP_NAME_LC="$(echo "${APP_NAME}" | tr '[:upper:]' '[:lower:]')"

# Derive repo root from the app.yml location so this works wherever the skill
# is installed (the skill lives in a separate skills repo, not inside the app
# checkout). APP_YML is set by load_app_config.sh to the found .claude/app.yml;
# the repo root is two directories up from that (app-root/.claude/app.yml).
REPO_ROOT="$(dirname "$(dirname "${APP_YML}")")"
BUNDLE_ID="${APP_BUNDLE_ID}"
DO_BUILD=true
SIM_NAME=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-build) DO_BUILD=false; shift ;;
    --sim)      SIM_NAME="$2"; shift 2 ;;
    *)          echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

cd "$REPO_ROOT"

# 1. Ensure Simulator.app is visible. `simctl boot` alone leaves it headless,
#    which is fine for screenshots but unhelpful when the user later wants to
#    look at the window directly.
open -a Simulator

# 2. Boot a simulator if none is booted. Prefer the build script default
#    (iPhone 17 Pro) so the build path matches.
if ! xcrun simctl list devices booted 2>/dev/null | grep -q "(Booted)"; then
  TARGET="${SIM_NAME:-iPhone 17 Pro}"
  # Note: BSD awk on macOS does not support the 3-arg match(...,m) form, so
  # extract the UDID with grep -oE instead — portable, no jq/awk dependency.
  UDID="$(xcrun simctl list devices "$TARGET" 2>/dev/null \
    | grep -F "$TARGET (" \
    | head -1 \
    | grep -oE '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}' \
    | head -1)"
  if [[ -z "$UDID" ]]; then
    echo "No simulator named '$TARGET' available. List with: xcrun simctl list devices" >&2
    exit 1
  fi
  echo "==> Booting $TARGET ($UDID)"
  xcrun simctl boot "$UDID"
fi

# 3. Build for simulator (unless --no-build). APP_BUILD_SCRIPT is the single
#    source of truth for project regeneration + xcodebuild flags; don't reinvent.
if $DO_BUILD; then
  if [[ -n "$SIM_NAME" ]]; then
    ./"${APP_BUILD_SCRIPT}" -s "$SIM_NAME"
  else
    ./"${APP_BUILD_SCRIPT}"
  fi
fi

# 4. Find the freshest .app under DerivedData. The build script prints the path
#    in its last line, but parsing it is brittle — DerivedData lookup is more
#    robust and works for --no-build too.
APP_PATH="$(find ~/Library/Developer/Xcode/DerivedData \
  -path "*/Build/Products/Debug-iphonesimulator/${APP_NAME}.app" \
  -not -path '*Index.noindex*' \
  -type d 2>/dev/null \
  | xargs -I {} stat -f '%m %N' {} \
  | sort -rn | head -1 | cut -d' ' -f2-)"

if [[ -z "$APP_PATH" || ! -d "$APP_PATH" ]]; then
  echo "Could not locate ${APP_NAME}.app under DerivedData. Did the build succeed?" >&2
  exit 1
fi

echo "==> Installing $APP_PATH"
xcrun simctl install booted "$APP_PATH"

# 5. Terminate any prior instance so launch shows a clean cold-start state.
xcrun simctl terminate booted "$BUNDLE_ID" 2>/dev/null || true

echo "==> Launching $BUNDLE_ID"
xcrun simctl launch booted "$BUNDLE_ID"

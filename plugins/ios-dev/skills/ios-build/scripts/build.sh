#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../_lib/load_app_config.sh
source "${SCRIPT_DIR}/../../_lib/load_app_config.sh"

# Work from the repo root (the directory holding .claude/app.yml) so the app's
# build script and the xcodebuild project/workspace resolve the same way no
# matter which subdirectory this was started from.
cd "$(dirname "$(dirname "${APP_YML}")")"

TARGET="${1:-sim}"   # sim | device

# Prefer the app's own build.sh if present (the skill's job is to make sure
# this exists and works — not to replace it).
if [[ -x "./${APP_BUILD_SCRIPT}" ]]; then
  case "${TARGET}" in
    sim)    exec "./${APP_BUILD_SCRIPT}" ;;
    device) exec "./${APP_BUILD_SCRIPT}" -d ;;
    *)      echo "usage: build.sh {sim|device}" >&2; exit 2 ;;
  esac
fi

# Fallback: bare xcodebuild. The simulator destination is generic, so no
# device name is hard-coded (a name goes stale when Xcode drops a runtime).
case "${TARGET}" in
  sim)
    xcodebuild -scheme "${APP_SCHEME}" \
      -destination 'generic/platform=iOS Simulator'
    ;;
  device)
    xcodebuild -scheme "${APP_SCHEME}" \
      -destination 'generic/platform=iOS' \
      DEVELOPMENT_TEAM="${APP_TEAM_ID}" \
      -allowProvisioningUpdates
    ;;
  *) echo "usage: build.sh {sim|device}" >&2; exit 2 ;;
esac

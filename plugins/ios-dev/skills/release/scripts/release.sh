#!/usr/bin/env bash
# Release pipeline wrapper. The real per-stage commands are in SKILL.md;
# this script handles the config preflight + the irreversible upload commands.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../_lib/load_app_config.sh
source "${SCRIPT_DIR}/../../_lib/load_app_config.sh"

MODE="${1:-testflight}"   # testflight | appstore
FORCE="${2:-}"

case "${MODE}" in
  testflight|appstore) ;;
  *) echo "usage: release.sh {testflight|appstore} [--force]" >&2; exit 2 ;;
esac

if [[ "${FORCE}" != "--force" ]] && [[ -n "$(git status --porcelain)" ]]; then
  echo "dirty tree; commit or pass --force" >&2
  exit 1
fi

archive_path="build/${APP_NAME}.xcarchive"
ipa_path="build/${APP_NAME}.ipa"
mkdir -p build

xcodebuild archive \
  -scheme "${APP_SCHEME}" \
  -configuration Release \
  -archivePath "${archive_path}" \
  DEVELOPMENT_TEAM="${APP_TEAM_ID}" \
  PRODUCT_BUNDLE_IDENTIFIER="${APP_BUNDLE_ID}" \
  -allowProvisioningUpdates

xcodebuild -exportArchive \
  -archivePath "${archive_path}" \
  -exportPath build/ \
  -exportOptionsPlist "${SCRIPT_DIR}/ExportOptions.plist" \
  -allowProvisioningUpdates

# Source App Store Connect API key (per-machine config — not in app.yml)
if [[ -f "${HOME}/.app-store-connect/config" ]]; then
  # shellcheck disable=SC1091
  source "${HOME}/.app-store-connect/config"
  KEY_FILE="$(ls "${HOME}"/.app-store-connect/AuthKey_*.p8 2>/dev/null | head -1 || true)"
fi

if [[ -z "${KEY_ID:-}" || -z "${ISSUER_ID:-}" ]]; then
  echo "Missing App Store Connect credentials. See stage 0 in SKILL.md." >&2
  exit 1
fi

xcrun altool --validate-app -f "${ipa_path}" -t ios --apiKey "${KEY_ID}" --apiIssuer "${ISSUER_ID}"
xcrun altool --upload-app   -f "${ipa_path}" -t ios --apiKey "${KEY_ID}" --apiIssuer "${ISSUER_ID}"

tag="release-${MODE}-$(date +%Y%m%d-%H%M)"
git tag "${tag}"
echo "tagged ${tag}"

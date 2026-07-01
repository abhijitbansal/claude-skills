#!/usr/bin/env bash
# Release pipeline wrapper: preflight → archive/export → validate → upload → tag.
# The staged, interactive flow lives in SKILL.md; this script is the
# non-interactive core it drives. Fastlane-first, raw xcodebuild fallback.
#
# Usage: release.sh {testflight|appstore} [--dry-run] [--force]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../_lib/load_app_config.sh
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/../../_lib/load_app_config.sh"

MODE="${1:-}"
case "${MODE}" in
  testflight|appstore) shift ;;
  *) echo "usage: release.sh {testflight|appstore} [--dry-run] [--force]" >&2; exit 2 ;;
esac
DRY=0; FORCE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --force)   FORCE=1 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
  shift
done

run_hook() {  # $1 = hook name, e.g. s5-pre
  local h="${RELEASE_HOOKS_DIR}/$1.sh"
  if [[ -x "${h}" ]]; then
    echo "hook: $1"
    "${h}" "${MODE}" || { echo "hook $1 failed — aborting" >&2; exit 1; }
  fi
}

# --- Stage 1: preflight gates
if [[ ${FORCE} -eq 1 ]]; then
  bash "${SCRIPT_DIR}/preflight.sh" --mode "${MODE}" || echo "preflight FAILs bypassed (--force)"
else
  bash "${SCRIPT_DIR}/preflight.sh" --mode "${MODE}"
fi

# --- Stage 5: archive + export
run_hook s5-pre
mkdir -p build
ipa_path="build/${APP_NAME}.ipa"
if [[ -f fastlane/Fastfile ]]; then
  bundle exec fastlane archive
else
  archive_path="build/${APP_NAME}.xcarchive"
  xcodebuild archive \
    -scheme "${APP_SCHEME}" \
    -configuration Release \
    -destination "generic/platform=iOS" \
    -archivePath "${archive_path}" \
    DEVELOPMENT_TEAM="${APP_TEAM_ID}" \
    -allowProvisioningUpdates
  cat > build/ExportOptions.plist <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>${RELEASE_EXPORT_METHOD}</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
  <key>destination</key><string>export</string>
</dict></plist>
EOF
  xcodebuild -exportArchive \
    -archivePath "${archive_path}" \
    -exportPath build/ \
    -exportOptionsPlist build/ExportOptions.plist \
    -allowProvisioningUpdates
fi
run_hook s5-post
[[ -f "${ipa_path}" ]] || { echo "no ${ipa_path} after export" >&2; exit 1; }

# --- Stage 6: credentials, validate, (confirm), upload
if [[ -f "${HOME}/.app-store-connect/config" ]]; then
  # shellcheck disable=SC1091
  source "${HOME}/.app-store-connect/config"
fi
if [[ -z "${KEY_ID:-}" || -z "${ISSUER_ID:-}" ]]; then
  echo "Missing App Store Connect credentials. See stage 0 in SKILL.md." >&2
  exit 1
fi

xcrun altool --validate-app -f "${ipa_path}" --type ios \
  --apiKey "${KEY_ID}" --apiIssuer "${ISSUER_ID}"

mv_now="$(awk '/MARKETING_VERSION:/ {gsub(/"/, "", $2); print $2; exit}' project.yml)"
bv_now="$(awk '/CURRENT_PROJECT_VERSION:/ {gsub(/"/, "", $2); print $2; exit}' project.yml)"

if [[ ${DRY} -eq 1 ]]; then
  echo "dry-run: validated. Would upload ${APP_NAME} v${mv_now} build ${bv_now} (${MODE}). Stopping."
  exit 0
fi

echo "Ready to upload ${APP_NAME} v${mv_now} build ${bv_now} (${MODE})."
echo "Build numbers cannot be reused. Type 'upload' to confirm:"
read -r answer
[[ "${answer}" == "upload" ]] || { echo "aborted."; exit 1; }

run_hook s6-pre
if [[ -f fastlane/Fastfile ]]; then
  if [[ "${MODE}" == "testflight" ]]; then
    bundle exec fastlane beta
  else
    bundle exec fastlane release
  fi
else
  xcrun altool --upload-app -f "${ipa_path}" --type ios \
    --apiKey "${KEY_ID}" --apiIssuer "${ISSUER_ID}"
fi
run_hook s6-post

# --- Stage 7: tag (local only; pushing is the SKILL's interactive step)
if [[ "${MODE}" == "testflight" ]]; then tag="v${mv_now}-b${bv_now}"; else tag="v${mv_now}"; fi
notes="build/release-notes-${mv_now}.md"
if [[ -f "${notes}" ]]; then
  git tag -a "${tag}" -F "${notes}"
else
  git tag "${tag}"
fi
echo "tagged ${tag} (not pushed — push starts the Xcode Cloud release workflow)"

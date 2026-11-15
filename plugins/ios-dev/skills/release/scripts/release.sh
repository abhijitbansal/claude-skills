#!/usr/bin/env bash
# Release pipeline wrapper: preflight → archive/export → validate → upload → tag.
# The staged flow lives in SKILL.md; this script is the non-interactive core it
# drives. Fastlane-first, raw xcodebuild fallback.
#
# Usage: release.sh {testflight|appstore} [--dry-run] [--force]
#                   [--next-version X.Y.Z] [--confirm-upload]
#
#   --next-version   the version being released; forwarded to preflight so the
#                    whatsnew gates check it (without it they SKIP)
#   --confirm-upload required to upload. The script never prompts: SKILL.md
#                    Stage 6 gets the user's literal 'upload', then re-runs with
#                    this flag. Without it the run stops before the upload.
#
# Env: XCODEBUILD_FLAGS  extra words for the fallback xcodebuild archive/export
#                        (exported for the Fastfile's gym xcargs too).
# Hooks: ${RELEASE_HOOKS_DIR}/s{1,5,6,7}-{pre,post}.sh. A hook file that exists
#        but is not executable is reported and skipped.
# The release tag is created here, once, in Stage 7 (local only, never pushed).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../_lib/load_app_config.sh
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/../../_lib/load_app_config.sh"
# shellcheck source=release_lib.sh
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/release_lib.sh"

USAGE="usage: release.sh {testflight|appstore} [--dry-run] [--force] [--next-version X.Y.Z] [--confirm-upload]"
MODE="${1:-}"
case "${MODE}" in
  testflight|appstore) shift ;;
  *) echo "${USAGE}" >&2; exit 2 ;;
esac
DRY=0; FORCE=0; CONFIRM=0; NEXT_VERSION=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --force)   FORCE=1 ;;
    --confirm-upload) CONFIRM=1 ;;
    --next-version)
      if [[ $# -lt 2 || "$2" == --* ]]; then
        echo "--next-version needs a value (X.Y.Z)" >&2; echo "${USAGE}" >&2; exit 2
      fi
      NEXT_VERSION="$2"; shift ;;
    *) echo "unknown flag: $1" >&2; echo "${USAGE}" >&2; exit 2 ;;
  esac
  shift
done
if [[ -n "${NEXT_VERSION}" && ! "${NEXT_VERSION}" =~ ^[0-9]+(\.[0-9]+){1,2}$ ]]; then
  echo "--next-version must look like X.Y.Z (got '${NEXT_VERSION}')" >&2; exit 2
fi
# Fail on a bad tag format now, not after the upload.
if [[ "${MODE}" == "testflight" ]]; then release_testflight_tag_format >/dev/null; fi

run_hook() {  # $1 = hook name, e.g. s5-pre
  local h="${RELEASE_HOOKS_DIR}/$1.sh"
  if [[ -x "${h}" ]]; then
    echo "hook: $1"
    "${h}" "${MODE}" || { echo "hook $1 failed — aborting" >&2; exit 1; }
  elif [[ -e "${h}" ]]; then
    echo "WARN: hook $1: ${h} exists but is not executable — skipped (chmod +x it)" >&2
  fi
}

# Credentials (Stage 0 files): KEY_ID / ISSUER_ID feed the Fastfile's ASC_*
# env vars (Stage 5) and altool (Stage 6). Pre-set ASC_* values win.
# Kept self-contained so tests/bats/release.bats can extract and run it.
load_asc_credentials() {
  if [[ -f "${HOME}/.app-store-connect/config" ]]; then
    # shellcheck disable=SC1091
    source "${HOME}/.app-store-connect/config"
  fi
  # altool finds AuthKey_<KEY_ID>.p8 via API_PRIVATE_KEYS_DIR; Stage 0 puts it here.
  export API_PRIVATE_KEYS_DIR="${API_PRIVATE_KEYS_DIR:-${HOME}/.app-store-connect}"
  if [[ -n "${KEY_ID:-}" && -n "${ISSUER_ID:-}" ]]; then
    export ASC_KEY_ID="${ASC_KEY_ID:-${KEY_ID}}"
    export ASC_ISSUER_ID="${ASC_ISSUER_ID:-${ISSUER_ID}}"
    # Derive the path from the (possibly pre-set) ASC_KEY_ID so the key file
    # matches the key id in use; a pre-set ASC_KEY_PATH still wins.
    export ASC_KEY_PATH="${ASC_KEY_PATH:-${API_PRIVATE_KEYS_DIR}/AuthKey_${ASC_KEY_ID}.p8}"
  fi
}

# Fail before the (long) archive when the credentials cannot work. Messages name
# the key file with a placeholder: the real key id is never printed.
check_asc_credentials() {
  if [[ -z "${KEY_ID:-}" || -z "${ISSUER_ID:-}" ]]; then
    echo "Missing App Store Connect credentials. See stage 0 in SKILL.md." >&2
    exit 1
  fi
  if [[ ! -f "${API_PRIVATE_KEYS_DIR}/AuthKey_${KEY_ID}.p8" ]]; then
    echo "AuthKey_<KEY_ID>.p8 not found in ${API_PRIVATE_KEYS_DIR} (altool looks there). See stage 0 in SKILL.md." >&2
    exit 1
  fi
  if [[ -n "${ASC_KEY_PATH:-}" && ! -f "${ASC_KEY_PATH}" ]]; then
    echo "ASC_KEY_PATH does not point at an existing .p8 file (the Fastfile reads it). See stage 0 in SKILL.md." >&2
    exit 1
  fi
}

write_paste_pack() {  # non-fatal convenience: never blocks a release
  # paste_pack.py creates .scratch/release itself; release_scratch_dir adds the
  # local git exclude first so the pack never dirties the next run's tree-clean gate.
  release_scratch_dir >/dev/null
  python3 "${SCRIPT_DIR}/paste_pack.py" "${mv_now}" --mode "${MODE}" ||
    echo "WARN: paste pack not complete (see lines above); the release is not affected" >&2
}

# --- Stage 1: preflight gates
preflight_args=(--mode "${MODE}")
if [[ -n "${NEXT_VERSION}" ]]; then preflight_args+=(--next-version "${NEXT_VERSION}"); fi
run_hook s1-pre
if [[ ${FORCE} -eq 1 ]]; then
  bash "${SCRIPT_DIR}/preflight.sh" "${preflight_args[@]}" || echo "preflight FAILs bypassed (--force)"
else
  bash "${SCRIPT_DIR}/preflight.sh" "${preflight_args[@]}"
fi
run_hook s1-post

load_asc_credentials  # sets KEY_ID / ISSUER_ID globals; exports ASC_* + API_PRIVATE_KEYS_DIR
check_asc_credentials

# --- Stage 5: archive + export
read -r -a xcodebuild_extra <<< "${XCODEBUILD_FLAGS:-}"
export XCODEBUILD_FLAGS="${XCODEBUILD_FLAGS:-}"
run_hook s5-pre
mkdir -p build
ipa_path="build/${APP_NAME}.ipa"
if [[ -f fastlane/Fastfile ]]; then
  bundle exec fastlane archive
else
  archive_path="build/${APP_NAME}.xcarchive"
  archive_args=(
    -scheme "${APP_SCHEME}"
    -configuration Release
    -destination "generic/platform=iOS"
    -archivePath "${archive_path}"
    DEVELOPMENT_TEAM="${APP_TEAM_ID}"
    -allowProvisioningUpdates
  )
  # A command-line PRODUCT_BUNDLE_IDENTIFIER overrides every target, so with
  # embedded extensions it would give them the app's id (duplicate
  # CFBundleIdentifier in the archive). Only pass it for single-target apps.
  if [[ -z "${TARGETS_EXTENSIONS:-}" ]]; then
    archive_args+=(PRODUCT_BUNDLE_IDENTIFIER="${APP_BUNDLE_ID}")
  fi
  xcodebuild archive "${archive_args[@]}" ${xcodebuild_extra[@]+"${xcodebuild_extra[@]}"}
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
    -allowProvisioningUpdates \
    ${xcodebuild_extra[@]+"${xcodebuild_extra[@]}"}
fi
run_hook s5-post
[[ -f "${ipa_path}" ]] || { echo "no ${ipa_path} after export" >&2; exit 1; }

# --- Stage 6: validate, (confirm), upload
xcrun altool --validate-app -f "${ipa_path}" --type ios \
  --apiKey "${KEY_ID}" --apiIssuer "${ISSUER_ID}"

mv_now="$(awk '/MARKETING_VERSION:/ {gsub(/"/, "", $2); print $2; exit}' project.yml)"
bv_now="$(awk '/CURRENT_PROJECT_VERSION:/ {gsub(/"/, "", $2); print $2; exit}' project.yml)"

if [[ ${DRY} -eq 1 ]]; then
  write_paste_pack
  echo "dry-run: validated. Would upload ${APP_NAME} v${mv_now} build ${bv_now} (${MODE}). Stopping."
  echo "To upload: get the user's literal 'upload' (SKILL.md Stage 6), then re-run without --dry-run and with --confirm-upload."
  exit 0
fi

if [[ ${CONFIRM} -ne 1 ]]; then
  echo "Ready to upload ${APP_NAME} v${mv_now} build ${bv_now} (${MODE}). Build numbers cannot be reused." >&2
  echo "Not uploading: pass --confirm-upload once the user has typed 'upload' (SKILL.md Stage 6). This script never prompts." >&2
  exit 1
fi

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

# --- Stage 7: tag (local only; pushing is the SKILL's interactive step). This is
# the only place the release tag is created.
run_hook s7-pre
tag="$(release_tag_name "${MODE}" "${mv_now}" "${bv_now}")"
notes="$(release_notes_path "${mv_now}")"
if git rev-parse -q --verify "refs/tags/${tag}" >/dev/null; then
  echo "tag ${tag} already exists — left as is"
elif [[ -f "${notes}" ]]; then
  git tag -a "${tag}" -F "${notes}"
  echo "tagged ${tag} with ${notes} (not pushed — push starts the Xcode Cloud release workflow)"
else
  echo "WARN: no release notes at ${notes} — creating a lightweight tag. Run release_notes.sh ${mv_now} first to annotate it." >&2
  git tag "${tag}"
  echo "tagged ${tag} (not pushed — push starts the Xcode Cloud release workflow)"
fi
write_paste_pack
run_hook s7-post

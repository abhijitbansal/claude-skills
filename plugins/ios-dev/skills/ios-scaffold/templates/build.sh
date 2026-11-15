#!/usr/bin/env bash
# {{APP_NAME}} build wrapper. Rendered by ios-dev ios-scaffold from .claude/app.yml;
# edit freely, scaffold reports DRIFT but never overwrites.
#
# Usage: ./build.sh [-s [<name|UDID>]] [-d [<device id>]] [--debug] [--no-launch] [-h|--help]
#   -s           simulator build (the default). With a name or UDID, build for and
#                install on that simulator; without one, build for any simulator
#                and install on the booted one (refuses when several are booted).
#   -d           build for a connected iPhone, then install and launch it with
#                devicectl. Optional device id; default: the first connected device.
#   --debug      Debug configuration (default: Debug for -s, Release for -d).
#   --no-launch  build only: skip install and launch.
# Any other argument exits 2.
set -euo pipefail

# Run from the repo root even when app.build_script puts this file in a subdir
# (tools/build.sh): the nearest ancestor holding .claude/app.yml, else the git
# toplevel, else this file's own directory.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT="${SCRIPT_DIR}"
while [[ ! -f "${ROOT}/.claude/app.yml" && "${ROOT}" != "/" ]]; do ROOT="$(dirname "${ROOT}")"; done
if [[ ! -f "${ROOT}/.claude/app.yml" ]]; then
  ROOT="$(git -C "${SCRIPT_DIR}" rev-parse --show-toplevel 2>/dev/null || printf '%s' "${SCRIPT_DIR}")"
fi
cd "${ROOT}"

SCHEME="{{APP_SCHEME}}"
BUNDLE_ID="{{APP_BUNDLE_ID}}"
TEAM_ID="{{APP_TEAM_ID}}"
ACCEPTED="-s [<name|UDID>], -d [<device id>], --debug, --no-launch, -h|--help"

MODE=sim
TARGET=""
DEBUG=0
LAUNCH=1
UDID_RE='^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$'

while [[ $# -gt 0 ]]; do
  case "$1" in
    -s) MODE=sim; shift; if [[ $# -gt 0 && "$1" != -* ]]; then TARGET="$1"; shift; fi ;;
    -d) MODE=device; shift; if [[ $# -gt 0 && "$1" != -* ]]; then TARGET="$1"; shift; fi ;;
    --debug) DEBUG=1; shift ;;
    --no-launch) LAUNCH=0; shift ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "build.sh: unknown argument '$1' (accepted: ${ACCEPTED})" >&2; exit 2 ;;
  esac
done

CONFIG=Debug
[[ "${MODE}" == device && "${DEBUG}" -eq 0 ]] && CONFIG=Release

# Team: app.yml value, else the team of the provisioning profile that matches
# this bundle id. Never the keychain: it can hold a stale cert from another
# Apple ID. Xcode 16+ keeps profiles in UserData; older Xcode in MobileDevice.
team_from_profile() {
  local dir profile appid
  for dir in "${HOME}/Library/Developer/Xcode/UserData/Provisioning Profiles" \
             "${HOME}/Library/MobileDevice/Provisioning Profiles"; do
    for profile in "${dir}"/*.mobileprovision; do
      [[ -f "${profile}" ]] || continue
      appid="$(security cms -D -i "${profile}" 2>/dev/null \
        | plutil -extract Entitlements.application-identifier raw -o - - 2>/dev/null || true)"
      case "${appid}" in
        *."${BUNDLE_ID}") printf '%s\n' "${appid%%.*}"; return 0 ;;
      esac
    done
  done
  return 0
}

if [[ "${MODE}" == device && ( -z "${TEAM_ID}" || "${TEAM_ID}" == TODO* ) ]]; then
  TEAM_ID="$(team_from_profile)"
  [[ -n "${TEAM_ID}" ]] || { echo "build.sh: no team id (set app.team_id in .claude/app.yml or open the project in Xcode once to fetch a profile)" >&2; exit 1; }
fi

# XcodeGen: project.yml is the source of truth, regenerate before every build.
if [[ -f project.yml ]] && command -v xcodegen >/dev/null 2>&1; then
  xcodegen generate --quiet
fi

SIGN_ARGS=()
if [[ "${MODE}" == device ]]; then
  DEST='generic/platform=iOS'
  SIGN_ARGS=(DEVELOPMENT_TEAM="${TEAM_ID}" -allowProvisioningUpdates)
elif [[ -z "${TARGET}" ]]; then
  DEST='generic/platform=iOS Simulator'
elif [[ "${TARGET}" =~ ${UDID_RE} ]]; then
  DEST="platform=iOS Simulator,id=${TARGET}"
else
  DEST="platform=iOS Simulator,name=${TARGET}"
fi

# `simctl ... booted` silently picks one device when several are booted. Refuse
# before building, unless -s <name|UDID> was given or nothing is installed.
if [[ "${MODE}" == sim && -z "${TARGET}" && "${LAUNCH}" -eq 1 ]]; then
  booted_count="$(xcrun simctl list devices booted 2>/dev/null | grep -c '(Booted)' || true)"
  if [[ "${booted_count:-0}" -gt 1 ]]; then
    echo "build.sh: ${booted_count} simulators are booted and no -s given; pass -s <name|UDID> (xcrun simctl list devices booted)" >&2
    exit 1
  fi
fi

xcodebuild -scheme "${SCHEME}" -configuration "${CONFIG}" -destination "${DEST}" \
  ${SIGN_ARGS[@]+"${SIGN_ARGS[@]}"} build

if [[ "${LAUNCH}" -eq 0 ]]; then
  exit 0
fi

# -showBuildSettings prints one block per target of the scheme (app, widget
# extension, test bundles). Take the first block whose WRAPPER_EXTENSION is "app",
# never the last block printed (which can be a .appex or a test bundle).
app_path() {
  xcodebuild -scheme "${SCHEME}" -configuration "${CONFIG}" -destination "${DEST}" \
    ${SIGN_ARGS[@]+"${SIGN_ARGS[@]}"} -showBuildSettings 2>/dev/null \
    | awk -F' = ' '
        function flush() { if (w == "app" && d != "" && n != "" && out == "") out = d "/" n; d = ""; n = ""; w = "" }
        /^Build settings for action/ { flush(); next }
        $1 ~ /^ *TARGET_BUILD_DIR$/ { d = $2 }
        $1 ~ /^ *FULL_PRODUCT_NAME$/ { n = $2 }
        $1 ~ /^ *WRAPPER_EXTENSION$/ { w = $2 }
        END { flush(); if (out != "") print out }'
}

device_id() {
  if [[ -n "${TARGET}" ]]; then printf '%s\n' "${TARGET}"; return 0; fi
  local out; out="$(mktemp)"
  xcrun devicectl list devices --json-output "${out}" >/dev/null
  python3 - "${out}" <<'PY'
import json, sys
for dev in json.load(open(sys.argv[1])).get("result", {}).get("devices", []):
    if dev.get("connectionProperties", {}).get("tunnelState") == "connected":
        print(dev["identifier"])
        break
PY
  rm -f "${out}"
}

APP="$(app_path)"
[[ -n "${APP}" && -d "${APP}" ]] || { echo "build.sh: built app not found (${APP:-no build settings})" >&2; exit 1; }

if [[ "${MODE}" == sim ]]; then
  SIM="${TARGET:-booted}"
  xcrun simctl install "${SIM}" "${APP}"
  xcrun simctl terminate "${SIM}" "${BUNDLE_ID}" 2>/dev/null || true
  xcrun simctl launch "${SIM}" "${BUNDLE_ID}"
else
  DEVICE="$(device_id)"
  [[ -n "${DEVICE}" ]] || { echo "build.sh: no connected device (plug in the iPhone, unlock it, enable Developer Mode)" >&2; exit 1; }
  xcrun devicectl device install app --device "${DEVICE}" "${APP}"
  xcrun devicectl device process launch --device "${DEVICE}" "${BUNDLE_ID}"
fi

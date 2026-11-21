#!/usr/bin/env bash
# Release pre-flight: deterministic gates before any build/upload.
# Output contract: PASS|WARN|FAIL|SKIP: <gate>[: detail]. Exit 1 iff any FAIL.
# SKIP means the gate did not run (input absent); it is never a pass. A gate
# that cannot verify its subject FAILs in appstore mode and WARNs otherwise.
#
# Usage: preflight.sh [--mode testflight|appstore] [--next-version X.Y.Z]
#
# Test seams (bats): PREFLIGHT_PLIST, PREFLIGHT_ENTITLEMENTS_DIR,
# PREFLIGHT_ENTITLEMENTS_FILE, PREFLIGHT_SCREENSHOTS_DIR,
# PREFLIGHT_SKIP_TOOLCHAIN=1.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../_lib/load_app_config.sh
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/../../_lib/load_app_config.sh"
bash "${SCRIPT_DIR}/../../_lib/validate_app_config.sh" >/dev/null || {
  echo "FAIL: app-config: validate_app_config failed"; exit 1; }

MODE="testflight"
NEXT_VERSION=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="${2:-testflight}"; shift 2 ;;
    --next-version) NEXT_VERSION="${2:-}"; shift 2 ;;
    *) echo "usage: preflight.sh [--mode testflight|appstore] [--next-version X.Y.Z]" >&2; exit 2 ;;
  esac
done

fails=0
pass() { echo "PASS: $1"; }
warn() { echo "WARN: $1: $2"; }
fail() { echo "FAIL: $1: ${2:-}"; fails=$((fails + 1)); }
skip() { echo "SKIP: $1: $2"; }
# Gate that could not verify its subject: FAIL when releasing to the App Store.
unverified() {
  if [[ "${MODE}" == "appstore" ]]; then fail "$1" "$2 (unverified)"
  else warn "$1" "$2 (unverified)"; fi
}
PROJECT_INFO="${SCRIPT_DIR}/project_info.py"
ASSET_GATES="${SCRIPT_DIR}/asset_gates.py"
SIZES_FILE="${SCRIPT_DIR}/../../_lib/asc_screenshot_sizes.txt"

# --- tree-clean
if [[ -z "$(git status --porcelain)" ]]; then pass tree-clean
else fail tree-clean "uncommitted changes"; fi

# --- branch (warn off-main; releases cut from main by convention)
branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "${branch}" == "main" ]]; then pass branch
else warn branch "releasing from '${branch}', not main"; fi

# --- toolchain gates (skippable in tests / CI without Xcode)
if [[ "${PREFLIGHT_SKIP_TOOLCHAIN:-}" != "1" ]]; then
  if command -v xcodegen >/dev/null && [[ -f project.yml ]]; then
    if xcodegen generate --quiet; then pass xcodegen-fresh
    else fail xcodegen-fresh "xcodegen generate failed"; fi
  else
    warn xcodegen-fresh "xcodegen or project.yml missing"
  fi
  if security find-identity -v -p codesigning 2>/dev/null | grep -q "Apple Distribution.*(${APP_TEAM_ID})"; then
    pass signing-identity
  else
    fail signing-identity "no 'Apple Distribution' identity for team ${APP_TEAM_ID} in keychain"
  fi
fi

# --- fonts (only when configured)
if [[ "${RELEASE_FONTS_EXPECTED}" =~ ^[0-9]+$ ]] && [[ "${RELEASE_FONTS_EXPECTED}" -gt 0 ]]; then
  count="$(find . -name '*.ttf' -not -path './build/*' -not -path './.git/*' | wc -l | tr -d ' ')"
  if [[ "${count}" -eq "${RELEASE_FONTS_EXPECTED}" ]]; then pass fonts
  else fail fonts "expected ${RELEASE_FONTS_EXPECTED} .ttf, found ${count}"; fi
else
  pass fonts
fi

# --- generated-plist compliance gates
PLIST="${PREFLIGHT_PLIST:-}"
PLIST_NOTE=""
if [[ -z "${PLIST}" ]]; then
  PLIST="$(find build -name "${APP_NAME}-Info.plist" 2>/dev/null | head -1)"
fi
if [[ -z "${PLIST}" ]]; then
  # No build product yet: fall back to the file XcodeGen writes from project.yml.
  info_path="$(python3 "${PROJECT_INFO}" info-path "${APP_NAME}" 2>/dev/null || true)"
  if [[ -n "${info_path}" && -f "${info_path}" ]]; then
    PLIST="${info_path}"
    PLIST_NOTE=" (read from project.yml info.path; keys set only through INFOPLIST_KEY_* build settings are not in that file)"
  fi
fi
if [[ -n "${PLIST}" && -f "${PLIST}" ]]; then
  # Xcode's generated Info.plist is binary by default — <key> tags never
  # appear as literal text there, so grep against an XML-converted copy
  # instead of the raw (possibly binary) PLIST. plutil first, python3
  # plistlib as the fallback (plutil-less hosts, e.g. Linux CI); if neither
  # converts, FAIL loudly — grepping binary bytes produces false results in
  # both directions.
  PLIST_XML="$(mktemp)" || PLIST_XML=""
  trap '[[ -n "${PLIST_XML:-}" ]] && rm -f "${PLIST_XML}"' EXIT
  plist_converted=0
  if [[ -n "${PLIST_XML}" ]]; then
    if plutil -convert xml1 -o "${PLIST_XML}" "${PLIST}" 2>/dev/null; then
      plist_converted=1
    elif python3 - "${PLIST}" "${PLIST_XML}" <<'PY' 2>/dev/null
import plistlib, sys
with open(sys.argv[1], 'rb') as f:
    data = plistlib.load(f)
with open(sys.argv[2], 'wb') as f:
    plistlib.dump(data, f, fmt=plistlib.FMT_XML)
PY
    then
      plist_converted=1
      warn plist-conversion "plutil unavailable or failed — converted with python3 plistlib"
    fi
  fi

  if [[ ${plist_converted} -eq 0 ]]; then
    fail plist-conversion "cannot stage an XML copy of ${PLIST} (mktemp, plutil and python3 plistlib all failed) — usage-strings/encryption-flag/capabilities not checked"
  else
  usage_ok=1
  for key in ${RELEASE_USAGE_STRINGS}; do
    if ! grep -q "<key>${key}</key>" "${PLIST_XML}"; then
      fail "usage-strings" "${key} missing from generated plist${PLIST_NOTE}"
      usage_ok=0
    fi
  done
  [[ ${usage_ok} -eq 1 ]] && pass usage-strings

  if grep -q "ITSAppUsesNonExemptEncryption" "${PLIST_XML}"; then
    pass encryption-flag
  else
    fail encryption-flag "ITSAppUsesNonExemptEncryption not declared (app.yml release.encryption_exempt=${RELEASE_ENCRYPTION_EXEMPT})"
  fi

  # Always evaluated: an empty release.required_capabilities allows nothing, so
  # any UIRequiredDeviceCapabilities entry in the plist is unexpected.
  # Path passed as argv, never interpolated into the python source — a
  # quote in the path must not become a SyntaxError that a swallowed
  # stderr turns into a vacuous pass.
  if caps_in_plist="$(python3 "${SCRIPT_DIR}/plist_array.py" "${PLIST}" UIRequiredDeviceCapabilities 2>/dev/null)"; then
    bad=""
    for c in ${caps_in_plist}; do
      case " ${RELEASE_REQUIRED_CAPABILITIES} " in
        *" ${c} "*) ;;
        *) bad="${bad} ${c}" ;;
      esac
    done
    if [[ -z "${bad}" ]]; then pass capabilities
    elif [[ -z "${RELEASE_REQUIRED_CAPABILITIES}" ]]; then
      if [[ "${MODE}" == "appstore" ]]; then
        fail capabilities "plist declares UIRequiredDeviceCapabilities:${bad} but release.required_capabilities is empty — list them in .claude/app.yml or remove them"
      else
        warn capabilities "plist declares UIRequiredDeviceCapabilities:${bad} but release.required_capabilities is empty"
      fi
    else
      fail capabilities "unexpected UIRequiredDeviceCapabilities:${bad}"
    fi
  else
    fail capabilities "could not read UIRequiredDeviceCapabilities from ${PLIST} (python3 plistlib failed)"
  fi
  fi
else
  unverified usage-strings "no generated plist found (no build/ product, no project.yml info.path) — build once, or set PREFLIGHT_PLIST"
fi

# --- nfc-entitlement (ITMS-90778: the iOS 26 SDK rejects the 'NDEF' reader-session
# format value at upload. Ship formats=[TAG] and read/write NDEF through the
# NFCNDEFTag protocol on the tag detected by an NFCTagReaderSession.)
# Every checked-in .entitlements file is inspected (app and each extension).
if [[ -n "${PREFLIGHT_ENTITLEMENTS_FILE:-}" ]]; then
  ENT_FILES="${PREFLIGHT_ENTITLEMENTS_FILE}"
else
  ENT_FILES="$(find . -name '*.entitlements' -not -path './build/*' -not -path './.git/*' 2>/dev/null | sort)"
fi
nfc_bad=0
nfc_unread=""
while IFS= read -r ent_file; do
  [[ -n "${ent_file}" && -f "${ent_file}" ]] || continue
  if nfc_fmts="$(python3 -c "
import plistlib, sys
try:
    with open(sys.argv[1], 'rb') as f:
        d = plistlib.load(f)
except Exception:
    sys.exit(0)
print(' '.join(d.get('com.apple.developer.nfc.readersession.formats', [])))" "${ent_file}" 2>/dev/null)"; then
    if [[ " ${nfc_fmts} " == *" NDEF "* ]]; then
      fail nfc-entitlement "${ent_file}: com.apple.developer.nfc.readersession.formats contains 'NDEF' — rejected by the iOS 26 SDK (ITMS-90778). Change it to 'TAG' and migrate NFCNDEFReaderSession -> NFCTagReaderSession (poll .iso14443, read/write via the NFCNDEFTag protocol on the detected tag)"
      nfc_bad=1
    fi
  else
    nfc_unread="${nfc_unread} ${ent_file}"
  fi
done <<< "${ENT_FILES}"
if [[ ${nfc_bad} -eq 0 ]]; then
  if [[ -n "${nfc_unread}" ]]; then
    warn nfc-entitlement "could not inspect${nfc_unread} (python3 failed) — gate skipped"
  else
    pass nfc-entitlement
  fi
fi

# --- ipad-orientation (ITMS-90474: a universal app must declare all four iPad
# orientations. The old UIRequiresFullScreen opt-out is deprecated on the iOS 26
# SDK — ignored in a future release — so declaring the four is the only
# future-proof fix. Only checked for universal apps; iPhone-only apps pass.
# A project.yml with no TARGETED_DEVICE_FAMILY is universal: that is XcodeGen's
# default for an iOS application target.)
universal=0
if [[ ! -f project.yml ]]; then
  universal=-1
elif ! grep -qE '^[[:space:]]*TARGETED_DEVICE_FAMILY' project.yml; then
  universal=1
elif grep -E '^[[:space:]]*TARGETED_DEVICE_FAMILY' project.yml | sed 's/^[^:]*://' | grep -q '2'; then
  universal=1
fi
if [[ ${universal} -eq -1 ]]; then
  skip ipad-orientation "no project.yml"
elif [[ ${universal} -eq 1 ]]; then
  if [[ -n "${PLIST}" && -f "${PLIST}" ]]; then
    if ipad_missing="$(python3 -c "
import plistlib, sys
with open(sys.argv[1], 'rb') as f:
    d = plistlib.load(f)
need = {'UIInterfaceOrientationPortrait', 'UIInterfaceOrientationPortraitUpsideDown',
        'UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight'}
have = set(d.get('UISupportedInterfaceOrientations~ipad', []))
print(' '.join(sorted(need - have)))" "${PLIST}" 2>/dev/null)"; then
      if [[ -n "${ipad_missing}" ]]; then
        fail ipad-orientation "universal app missing iPad orientations:${ipad_missing:+ }${ipad_missing} (ITMS-90474). Declare all four in UISupportedInterfaceOrientations~ipad in project.yml — UIRequiresFullScreen is deprecated on the iOS 26 SDK and no longer opts out"
      else
        pass ipad-orientation
      fi
    else
      warn ipad-orientation "could not read UISupportedInterfaceOrientations~ipad from ${PLIST} (python3 plistlib failed) — gate skipped"
    fi
    if python3 -c "
import plistlib, sys
with open(sys.argv[1], 'rb') as f:
    d = plistlib.load(f)
sys.exit(0 if d.get('UIRequiresFullScreen') else 1)" "${PLIST}" 2>/dev/null; then
      warn ipad-orientation "UIRequiresFullScreen is set but deprecated on the iOS 26 SDK (ignored in a future release) — rely on the four declared iPad orientations instead"
    fi
  else
    unverified ipad-orientation "universal app but no generated plist to check iPad orientations — build once, or set PREFLIGHT_PLIST"
  fi
else
  pass ipad-orientation
fi

# --- entitlement parity (App Group identical across app + extensions)
# Groups come from the target's checked-in .entitlements (project_info.py
# groups). A per-app hook may instead leave <target>.entitlements.groups in
# build/gen (or PREFLIGHT_ENTITLEMENTS_DIR); that is only the fallback, so a
# stale extraction cannot outvote the file in the repo.
ENT_DIR="${PREFLIGHT_ENTITLEMENTS_DIR:-build/gen}"
target_groups() {  # $1 = target; prints its groups; returns 1 when unverifiable
  local t="$1" out f="${ENT_DIR}/$1.entitlements.groups"
  if out="$(python3 "${PROJECT_INFO}" groups "${t}" 2>/dev/null)"; then
    printf '%s\n' "${out}"
    return 0
  fi
  if [[ -f "${f}" ]]; then cat "${f}"; return 0; fi
  return 1
}
if [[ -n "${TARGETS_APP_GROUP}" ]]; then
  parity_bad=0
  parity_unverified=""
  for target in "${APP_NAME}" ${TARGETS_EXTENSIONS}; do
    if groups="$(target_groups "${target}")"; then
      if ! grep -qx "${TARGETS_APP_GROUP}" <<< "${groups}"; then
        fail entitlement-parity "${target}: app group != ${TARGETS_APP_GROUP}"
        parity_bad=1
      fi
    else
      parity_unverified="${parity_unverified} ${target}"
    fi
  done
  if [[ -n "${parity_unverified}" ]]; then
    unverified entitlement-parity "no checked-in .entitlements (and no ${ENT_DIR}/<target>.entitlements.groups) for:${parity_unverified}"
  elif [[ ${parity_bad} -eq 0 ]]; then
    pass entitlement-parity
  fi
else
  skip entitlement-parity "targets.app_group not set"
fi

# --- runtime-trap (WARN-only heuristic; see skill mainactor-launch-watchdog-audit)
# NB: awk -v does C-escape processing, so regex metachars need double
# backslashes; BSD awk has no \b.
HEAVY_PAT='backfill\\(|pdfData\\(|Data\\(contentsOf|VNImageRequestHandler|MLModel|jpegData\\(|buildFloorPlan|[^A-Za-z]embed'
# Scan the app target's own project.yml `sources`; Sources/ when it declares none.
rt_dirs="$(python3 "${PROJECT_INFO}" sources "${APP_NAME}" 2>/dev/null || true)"
[[ -n "${rt_dirs}" ]] || rt_dirs="Sources"
rt_hits="$(mktemp)"
while IFS= read -r rt_dir; do
  [[ -n "${rt_dir}" ]] || continue
  grep -rlE '@main' --include='*.swift' "${rt_dir}" 2>/dev/null
done <<< "${rt_dirs}" | while IFS= read -r f; do
  awk -v pat="${HEAVY_PAT}" '
    /init\(|\.task|onAppear/ { inblock = NR + 20 }
    NR <= inblock && $0 ~ pat && $0 !~ /Task.detached|withTaskGroup|nonisolated/ {
      printf "%s:%d\n", FILENAME, NR
    }' "${f}"
done > "${rt_hits}" 2>/dev/null || true
if [[ -s "${rt_hits}" ]]; then
  while IFS= read -r hit; do
    warn runtime-trap "possible main-actor heavy work at ${hit} — see skill mainactor-launch-watchdog-audit"
  done < "${rt_hits}"
else
  pass runtime-trap
fi
rm -f "${rt_hits}"

# --- whatsnew-config (hint: a WhatsNew/Changelog file exists but the app.yml key
# that points the gates at it is unset, so the gates below would SKIP)
if [[ -z "${RELEASE_WHATSNEW_FILE}" ]]; then
  wn_found="$(find . -iname 'WhatsNew*.json' -not -path './build/*' -not -path './.git/*' 2>/dev/null | sort | head -1)"
  [[ -z "${wn_found}" ]] || warn whatsnew-config "${wn_found#./} exists but release.whatsnew_file is unset in .claude/app.yml — the whatsnew gate will not check it"
fi
if [[ -z "${RELEASE_INAPP_CHANGELOG_FILE}" ]]; then
  ic_found="$(find . \( -iname 'Changelog*.swift' -o -iname 'FeatureCatalog*.swift' \) -not -path './build/*' -not -path './.git/*' 2>/dev/null | sort | head -1)"
  [[ -z "${ic_found}" ]] || warn whatsnew-config "${ic_found#./} exists but release.inapp_changelog_file is unset in .claude/app.yml — the inapp-whatsnew gate will not check it"
fi

# --- whatsnew (entry must exist for the version being released)
if [[ -z "${RELEASE_WHATSNEW_FILE}" ]]; then
  skip whatsnew "release.whatsnew_file not set"
elif [[ -z "${NEXT_VERSION}" ]]; then
  skip whatsnew "no --next-version given, entry not checked"
elif [[ -f "${RELEASE_WHATSNEW_FILE}" ]] && grep -q "\"${NEXT_VERSION}\"" "${RELEASE_WHATSNEW_FILE}"; then
  pass whatsnew
elif [[ "${MODE}" == "appstore" ]]; then
  fail whatsnew "no entry for ${NEXT_VERSION} in ${RELEASE_WHATSNEW_FILE}"
else
  warn whatsnew "no entry for ${NEXT_VERSION} in ${RELEASE_WHATSNEW_FILE}"
fi

# --- inapp-whatsnew (sibling to whatsnew above, but for the IN-APP changelog/
# feature-catalog surface, not App Store Connect metadata — see skill
# release-inapp-vs-asc-whatsnew-surfaces. Optional: only checked when the app
# configures release.inapp_changelog_file; most apps have no in-app changelog.)
if [[ -z "${RELEASE_INAPP_CHANGELOG_FILE}" ]]; then
  skip inapp-whatsnew "release.inapp_changelog_file not set"
elif [[ -z "${NEXT_VERSION}" ]]; then
  skip inapp-whatsnew "no --next-version given, entry not checked"
elif [[ -f "${RELEASE_INAPP_CHANGELOG_FILE}" ]] && grep -q "\"${NEXT_VERSION}\"" "${RELEASE_INAPP_CHANGELOG_FILE}"; then
  pass inapp-whatsnew
elif [[ "${MODE}" == "appstore" ]]; then
  fail inapp-whatsnew "no ChangelogEntry for ${NEXT_VERSION} in ${RELEASE_INAPP_CHANGELOG_FILE}"
else
  warn inapp-whatsnew "no ChangelogEntry for ${NEXT_VERSION} in ${RELEASE_INAPP_CHANGELOG_FILE}"
fi

# --- icon-opaque (App Store Connect rejects a 1024 px marketing icon that has an
# alpha channel, and shows a blank tile for one that slipped through. Only the
# light icon is checked: dark and tinted variants keep their alpha.)
icon_line="$(python3 "${ASSET_GATES}" icon 2>/dev/null || true)"
icon_status="${icon_line%%$'\t'*}"
icon_detail="${icon_line#*$'\t'}"
case "${icon_status}" in
  OPAQUE) pass icon-opaque ;;
  ALPHA)  fail icon-opaque "${icon_detail} has an alpha channel. Re-encode it without alpha (CoreGraphics CGImageAlphaInfo.noneSkipLast); keep alpha on the dark and tinted variants. The fix reaches App Store Connect only with the next uploaded build" ;;
  NOTFOUND) warn icon-opaque "${icon_detail} — light 1024 icon not checked" ;;
  *) warn icon-opaque "asset_gates.py icon gave no result — light 1024 icon not checked" ;;
esac

# --- screenshot-sizes (appstore mode: every marketing screenshot must be a size
# App Store Connect accepts; the list lives in skills/_lib/asc_screenshot_sizes.txt)
SHOTS_DIR="${PREFLIGHT_SCREENSHOTS_DIR:-marketing/screenshots}"
if [[ "${MODE}" != "appstore" ]]; then
  skip screenshot-sizes "appstore mode only"
elif [[ ! -d "${SHOTS_DIR}" ]]; then
  skip screenshot-sizes "no ${SHOTS_DIR}"
elif shot_out="$(python3 "${ASSET_GATES}" screenshots "${SHOTS_DIR}" "${SIZES_FILE}" 2>/dev/null)"; then
  shot_summary="$(grep '^SUMMARY' <<< "${shot_out}" || true)"
  shot_checked="$(cut -f2 <<< "${shot_summary}")"
  shot_bad="$(cut -f3 <<< "${shot_summary}")"
  if [[ -z "${shot_summary}" ]]; then
    warn screenshot-sizes "asset_gates.py screenshots gave no summary — sizes not checked"
  elif [[ "${shot_checked}" -eq 0 ]]; then
    skip screenshot-sizes "no images under ${SHOTS_DIR}"
  elif [[ "${shot_bad}" -eq 0 ]]; then
    pass screenshot-sizes
  else
    shot_list="$(grep -v '^SUMMARY' <<< "${shot_out}" | tr '\t' ' ' | tr '\n' ';')"
    fail screenshot-sizes "${shot_bad} of ${shot_checked} not an App Store Connect size: ${shot_list} (allow-list unverified against Apple's current spec: if App Store Connect accepts the size, add it to skills/_lib/asc_screenshot_sizes.txt)"
  fi
else
  warn screenshot-sizes "asset_gates.py screenshots failed — sizes not checked"
fi

if [[ ${fails} -gt 0 ]]; then
  echo "preflight: ${fails} failure(s)"
  exit 1
fi
echo "preflight: all gates green"
exit 0

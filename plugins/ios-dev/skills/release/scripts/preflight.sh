#!/usr/bin/env bash
# Release pre-flight: deterministic gates before any build/upload.
# Output contract: PASS|WARN|FAIL: <gate>[: detail]. Exit 1 iff any FAIL.
#
# Usage: preflight.sh [--mode testflight|appstore] [--next-version X.Y.Z]
#
# Test seams (bats): PREFLIGHT_PLIST, PREFLIGHT_ENTITLEMENTS_DIR,
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
  if security find-identity -v -p codesigning 2>/dev/null | grep -q "Apple Distribution"; then
    pass signing-identity
  else
    fail signing-identity "no 'Apple Distribution' identity in keychain"
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
if [[ -z "${PLIST}" ]]; then
  PLIST="$(find build -name "${APP_NAME}-Info.plist" 2>/dev/null | head -1)"
fi
if [[ -n "${PLIST}" && -f "${PLIST}" ]]; then
  usage_ok=1
  for key in ${RELEASE_USAGE_STRINGS}; do
    if ! grep -q "<key>${key}</key>" "${PLIST}"; then
      fail "usage-strings" "${key} missing from generated plist"
      usage_ok=0
    fi
  done
  [[ ${usage_ok} -eq 1 ]] && pass usage-strings

  if grep -q "ITSAppUsesNonExemptEncryption" "${PLIST}"; then
    pass encryption-flag
  else
    fail encryption-flag "ITSAppUsesNonExemptEncryption not declared (app.yml release.encryption_exempt=${RELEASE_ENCRYPTION_EXEMPT})"
  fi

  if [[ -n "${RELEASE_REQUIRED_CAPABILITIES}" ]]; then
    caps_in_plist="$(python3 -c "
import plistlib
d = plistlib.load(open('${PLIST}', 'rb'))
print(' '.join(d.get('UIRequiredDeviceCapabilities', [])))" 2>/dev/null || true)"
    bad=""
    for c in ${caps_in_plist}; do
      case " ${RELEASE_REQUIRED_CAPABILITIES} " in
        *" ${c} "*) ;;
        *) bad="${bad} ${c}" ;;
      esac
    done
    if [[ -z "${bad}" ]]; then pass capabilities
    else fail capabilities "unexpected UIRequiredDeviceCapabilities:${bad}"; fi
  else
    pass capabilities
  fi
else
  warn usage-strings "no generated plist found — build once, or set PREFLIGHT_PLIST"
fi

# --- entitlement parity (App Group identical across app + extensions)
if [[ -n "${TARGETS_APP_GROUP}" ]]; then
  ENT_DIR="${PREFLIGHT_ENTITLEMENTS_DIR:-build/gen}"
  parity_ok=1
  for target in "${APP_NAME}" ${TARGETS_EXTENSIONS}; do
    f="${ENT_DIR}/${target}.entitlements.groups"
    if [[ -f "${f}" ]]; then
      if ! grep -qx "${TARGETS_APP_GROUP}" "${f}"; then
        fail entitlement-parity "${target}: app group != ${TARGETS_APP_GROUP}"
        parity_ok=0
      fi
    else
      warn entitlement-parity "${target}: no extracted entitlements at ${f}"
    fi
  done
  [[ ${parity_ok} -eq 1 ]] && pass entitlement-parity
else
  pass entitlement-parity
fi

# --- runtime-trap (WARN-only heuristic; see skill mainactor-launch-watchdog-audit)
# NB: awk -v does C-escape processing, so regex metachars need double
# backslashes; BSD awk has no \b.
HEAVY_PAT='backfill\\(|pdfData\\(|Data\\(contentsOf|VNImageRequestHandler|MLModel|jpegData\\(|buildFloorPlan|[^A-Za-z]embed'
rt_hits="$(mktemp)"
grep -rlE '@main' --include='*.swift' Sources 2>/dev/null | while IFS= read -r f; do
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

# --- whatsnew (entry must exist for the version being released)
if [[ -n "${RELEASE_WHATSNEW_FILE}" && -n "${NEXT_VERSION}" ]]; then
  if [[ -f "${RELEASE_WHATSNEW_FILE}" ]] && grep -q "\"${NEXT_VERSION}\"" "${RELEASE_WHATSNEW_FILE}"; then
    pass whatsnew
  elif [[ "${MODE}" == "appstore" ]]; then
    fail whatsnew "no entry for ${NEXT_VERSION} in ${RELEASE_WHATSNEW_FILE}"
  else
    warn whatsnew "no entry for ${NEXT_VERSION} in ${RELEASE_WHATSNEW_FILE}"
  fi
else
  pass whatsnew
fi

if [[ ${fails} -gt 0 ]]; then
  echo "preflight: ${fails} failure(s)"
  exit 1
fi
echo "preflight: all gates green"
exit 0

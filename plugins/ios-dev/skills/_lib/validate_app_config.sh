#!/usr/bin/env bash
# Validate .claude/app.yml against schema v2. ERROR lines → exit 1.
# WARN lines are advisory. Exit 2 = file not found / usage.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export APP_CONFIG_HELPERS_ONLY=1
# shellcheck source=load_app_config.sh
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/load_app_config.sh"

FILE="${1:-}"
if [[ -z "${FILE}" ]]; then
  FILE="$(_find_app_yml)" || { echo "ERROR: no .claude/app.yml found above $(pwd)"; exit 2; }
fi
[[ -f "${FILE}" ]] || { echo "ERROR: ${FILE} not found"; exit 2; }

errors=0
err() { echo "ERROR: $*"; errors=$((errors + 1)); }
warn() { echo "WARN: $*"; }

get() { _yaml_get "${FILE}" "$1" 2>/dev/null || true; }
get_list() { _yaml_get_list "${FILE}" "$1" 2>/dev/null || true; }

# schema version
schema="$(_yaml_get_top "${FILE}" schema_version 2>/dev/null || true)"
case "${schema:-}" in
  "") warn "no top-level 'schema_version:' key — treated as v1; run /ios-init --migrate to upgrade" ;;
  1|2) ;;
  *) err "schema_version: '${schema}' unsupported (expected 1 or 2)" ;;
esac

# required app.* keys, no TODO placeholders
for key in name bundle_id scheme team_id; do
  val="$(get "app.${key}")"
  if [[ -z "${val}" ]]; then
    err "app.${key} missing"
  elif [[ "${val}" == TODO* ]]; then
    err "app.${key} still TODO"
  fi
done

# typed fields
fonts="$(get release.fonts_expected)"
if [[ -n "${fonts}" && ! "${fonts}" =~ ^[0-9]+$ ]]; then
  err "release.fonts_expected must be an integer (got '${fonts}')"
fi
enc="$(get release.encryption_exempt)"
if [[ -n "${enc}" && "${enc}" != "true" && "${enc}" != "false" ]]; then
  err "release.encryption_exempt must be true or false (got '${enc}')"
fi
for p in $(get_list app.platforms); do
  case "${p}" in
    ios|macos) ;;
    *) err "app.platforms contains unknown platform '${p}' (expected ios|macos)" ;;
  esac
done

# advisory checks
whatsnew="$(get release.whatsnew_file)"
if [[ -n "${whatsnew}" ]]; then
  root="$(dirname "$(dirname "${FILE}")")"
  [[ -f "${root}/${whatsnew}" ]] || warn "release.whatsnew_file '${whatsnew}' not found relative to repo root"
fi

if [[ ${errors} -gt 0 ]]; then
  echo "invalid: ${errors} error(s) in ${FILE}"
  exit 1
fi
echo "ok: ${FILE}"
exit 0

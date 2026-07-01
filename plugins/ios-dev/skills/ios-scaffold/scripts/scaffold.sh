#!/usr/bin/env bash
# Idempotent iOS repo standardizer. CREATE missing, report DRIFT, never clobber.
# Output: CREATE|OK|DRIFT|SKIP: <path>[: reason]. --check exits 1 if work needed.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TPL="${SCRIPT_DIR}/../templates"
# shellcheck source=../../_lib/load_app_config.sh
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/../../_lib/load_app_config.sh"

CHECK=0
[[ "${1:-}" == "--check" ]] && CHECK=1
work=0

render() {  # $1 template file -> stdout with tokens substituted
  sed -e "s|{{APP_NAME}}|${APP_NAME}|g" \
      -e "s|{{APP_BUNDLE_ID}}|${APP_BUNDLE_ID}|g" \
      -e "s|{{APP_SCHEME}}|${APP_SCHEME}|g" \
      -e "s|{{APP_TEAM_ID}}|${APP_TEAM_ID}|g" \
      -e "s|{{RELEASE_ASC_APP_ID}}|${RELEASE_ASC_APP_ID}|g" \
      -e "s|{{SITE_DOMAIN}}|${SITE_DOMAIN}|g" \
      "$1"
}

ensure_file() {  # $1 relpath, $2 template
  local rel="$1" tpl="$2" tmp
  tmp="$(mktemp)"
  render "${tpl}" > "${tmp}"
  if [[ ! -f "${rel}" ]]; then
    work=1
    if [[ ${CHECK} -eq 0 ]]; then
      mkdir -p "$(dirname "${rel}")"
      cp "${tmp}" "${rel}"
      echo "CREATE: ${rel}"
    else
      echo "CREATE: ${rel} (needed)"
    fi
  elif cmp -s "${tmp}" "${rel}"; then
    echo "OK: ${rel}"
  else
    echo "DRIFT: ${rel}: differs from template (kept as-is)"
    work=1
  fi
  rm -f "${tmp}"
}

ensure_dir() {
  local rel="$1"
  if [[ ! -d "${rel}" ]]; then
    work=1
    if [[ ${CHECK} -eq 0 ]]; then
      mkdir -p "${rel}"
      touch "${rel}/.gitkeep"
      echo "CREATE: ${rel}"
    else
      echo "CREATE: ${rel} (needed)"
    fi
  else
    echo "OK: ${rel}"
  fi
}

ensure_file "marketing/app-store-listing.md" "${TPL}/marketing-app-store-listing.md"
ensure_file "fastlane/Fastfile" "${TPL}/Fastfile"
ensure_file "Gemfile" "${TPL}/Gemfile"
ensure_file "ci_scripts/ci_post_clone.sh" "${TPL}/ci_post_clone.sh"
[[ -f ci_scripts/ci_post_clone.sh && ${CHECK} -eq 0 ]] && chmod +x ci_scripts/ci_post_clone.sh
ensure_dir "scripts/release-hooks"
ensure_file "docs/ARCHITECTURE_CHECKLIST.md" "${TPL}/ARCHITECTURE_CHECKLIST.md"
if [[ ! -f AGENTS.md ]]; then
  ensure_file "AGENTS.md" "${TPL}/AGENTS-skeleton.md"
  ensure_file "CLAUDE.md" "${TPL}/CLAUDE-pointer.md"
else
  echo "SKIP: AGENTS.md: exists (app-specific, not managed)"
fi

if [[ ${CHECK} -eq 1 && ${work} -eq 1 ]]; then
  exit 1
fi
exit 0

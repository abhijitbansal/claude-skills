#!/usr/bin/env bash
# Idempotent iOS repo standardizer. CREATE missing, report DRIFT, never clobber.
# Output: CREATE|OK|DRIFT|SKIP: <path>[: reason].
# Usage: scaffold.sh [--check] [-h|--help]
#   --check  report only, write nothing; exit 1 only if a managed file is
#            missing (CREATE). DRIFT is reported but never fails the check.
# Any other argument exits 2. Always writes at the repo root (the directory
# holding .claude/app.yml), whatever the current directory is.
set -uo pipefail

CHECK=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) CHECK=1; shift ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "scaffold: unknown argument '$1' (accepted: --check, -h|--help)" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TPL="${SCRIPT_DIR}/../templates"
# shellcheck source=../../_lib/load_app_config.sh
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/../../_lib/load_app_config.sh" || exit 1

# Resolve every relative managed path against the repo root.
cd "$(dirname "$(dirname "${APP_YML}")")" || exit 1

work=0

# Injection guard: these values are sed-substituted into shell/Ruby/YAML
# templates — allow only the same safe-character allowlists
# validate_app_config.sh enforces, so a passing validate implies scaffolding
# will succeed too (a denylist here would drift from that allowlist).
assert_safe() {  # $1 = key, $2 = value, $3 = allowlist regex
  [[ "$2" =~ $3 ]] || {
    echo "unsafe value in $1 — fix .claude/app.yml before scaffolding" >&2
    exit 1
  }
}
assert_safe "app.name"           "${APP_NAME}"          '^[A-Za-z0-9 ._-]*$'
assert_safe "app.bundle_id"      "${APP_BUNDLE_ID}"     '^[A-Za-z0-9.-]*$'
assert_safe "app.scheme"         "${APP_SCHEME}"        '^[A-Za-z0-9._-]*$'
assert_safe "app.team_id"        "${APP_TEAM_ID}"       '^[A-Za-z0-9]*$'
assert_safe "release.asc_app_id" "${RELEASE_ASC_APP_ID}" '^[0-9]*$'
assert_safe "site.domain"        "${SITE_DOMAIN}"       '^[A-Za-z0-9.-]*$'
# The build script path is written to, so it must stay inside the repo.
assert_safe "app.build_script"   "${APP_BUILD_SCRIPT}"  '^[A-Za-z0-9._/-]+$'
case "/${APP_BUILD_SCRIPT}/" in
  //*|*/../*)
    echo "unsafe value in app.build_script — must be a relative path inside the repo" >&2
    exit 1 ;;
esac

render() {  # $1 template file -> stdout with tokens substituted
  sed -e "s|{{APP_NAME}}|${APP_NAME}|g" \
      -e "s|{{APP_BUNDLE_ID}}|${APP_BUNDLE_ID}|g" \
      -e "s|{{APP_SCHEME}}|${APP_SCHEME}|g" \
      -e "s|{{APP_TEAM_ID}}|${APP_TEAM_ID}|g" \
      -e "s|{{RELEASE_ASC_APP_ID}}|${RELEASE_ASC_APP_ID}|g" \
      -e "s|{{SITE_DOMAIN}}|${SITE_DOMAIN}|g" \
      "$1"
}

ensure_file() {  # $1 relpath, $2 template, $3 "x" to chmod +x
  local rel="$1" tpl="$2" exec_bit="${3:-}" tmp
  tmp="$(mktemp)"
  render "${tpl}" > "${tmp}"
  if [[ ! -f "${rel}" ]]; then
    work=1   # a missing managed file is the only thing --check fails on
    if [[ ${CHECK} -eq 0 ]]; then
      mkdir -p "$(dirname "${rel}")"
      cp "${tmp}" "${rel}"
      [[ -n "${exec_bit}" ]] && chmod +x "${rel}"
      echo "CREATE: ${rel}"
    else
      echo "CREATE: ${rel} (needed)"
    fi
  elif cmp -s "${tmp}" "${rel}"; then
    echo "OK: ${rel}"
  else
    echo "DRIFT: ${rel}: differs from template (kept as-is)"
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

# Hook wiring lives in .claude/settings.json. A missing file is created from
# the template; an existing one is never edited, only checked.
ensure_settings() {
  local rel=".claude/settings.json"
  if [[ ! -f "${rel}" ]]; then
    ensure_file "${rel}" "${TPL}/claude-settings.json"
  elif grep -q 'guard-generated.sh' "${rel}"; then
    echo "OK: ${rel}: guard-generated hook wired"
  else
    echo "SKIP: ${rel}: exists — add the PreToolUse hook for .claude/hooks/guard-generated.sh (see ios-scaffold SKILL.md)"
  fi
}

ensure_file "marketing/app-store-listing.md" "${TPL}/marketing-app-store-listing.md"
ensure_file "fastlane/Fastfile" "${TPL}/Fastfile"
ensure_file "Gemfile" "${TPL}/Gemfile"
ensure_file "${CI_POST_CLONE}" "${TPL}/ci_post_clone.sh" x
[[ -f "${CI_POST_CLONE}" && ${CHECK} -eq 0 ]] && chmod +x "${CI_POST_CLONE}"
ensure_file "${APP_BUILD_SCRIPT}" "${TPL}/build.sh" x
ensure_dir "scripts/release-hooks"
ensure_file "docs/ARCHITECTURE_CHECKLIST.md" "${TPL}/ARCHITECTURE_CHECKLIST.md"
ensure_file ".claude/rules/swift-lessons-by-symptom.md" "${TPL}/swift-lessons-rule.md"
ensure_file ".claude/hooks/guard-generated.sh" "${TPL}/guard-generated.sh" x
ensure_settings
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

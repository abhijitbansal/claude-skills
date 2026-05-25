#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
export CLAUDE_SKILLS_HOME="${CLAUDE_SKILLS_HOME:-${REPO_ROOT}}"

# shellcheck source=_lib.sh
source "${SCRIPT_DIR}/_lib.sh"

DRY_RUN=0
VERBOSE=0
ONLY=""
SKIP=" "  # space-delimited; sentinels ensure whole-word matching

ALL_STEPS=(preflight claude marketplaces plugins skills dotfiles symlinks summary)

usage() {
  cat <<EOF
Usage: setup.sh [--dry-run] [--verbose] [--only <step>] [--skip-<step>]
Steps: ${ALL_STEPS[*]}
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)        DRY_RUN=1 ;;
    --verbose)        VERBOSE=1 ;;
    --only)           ONLY="$2"; shift ;;
    --skip-claude|--skip-marketplaces|--skip-plugins|--skip-skills|--skip-dotfiles|--skip-symlinks)
                      SKIP+="${1#--skip-} " ;;
    -h|--help)        usage; exit 0 ;;
    *)                usage; exit 2 ;;
  esac
  shift
done

if [[ -n "${ONLY}" ]]; then
  found=0
  for s in "${ALL_STEPS[@]}"; do [[ "${s}" == "${ONLY}" ]] && found=1; done
  [[ "${found}" -eq 1 ]] || { fail "unknown step: ${ONLY}"; exit 2; }
fi

run_step() {
  local name="$1"
  [[ -n "${ONLY}" && "${ONLY}" != "${name}" ]] && return 0
  [[ "${SKIP}" == *" ${name} "* ]] && { info "skipping ${name}"; return 0; }
  bold "step: ${name}"
  "step_${name}"
}

step_preflight() {
  ensure_path
  python_check
  info "preflight ok"
}
step_claude()        { info "(claude install/update — to be implemented in T6)"; }
step_marketplaces() {
  local toml="${CLAUDE_SETUP_TOML:-${REPO_ROOT}/claude-setup.toml}"
  local entries
  entries="$(python3 "${SCRIPT_DIR}/parse_toml.py" "${toml}" marketplaces)"
  local existing
  existing="$(claude plugin marketplace list 2>/dev/null || true)"
  python3 -c "import json,sys; [print(e['name']+'\t'+e['repo']) for e in json.loads(sys.argv[1])]" "${entries}" \
    | while IFS=$'\t' read -r name repo; do
      if printf '%s\n' "${existing}" | grep -qw "${name}"; then
        info "marketplace ${name}: update"
        [[ "${DRY_RUN}" -eq 1 ]] || claude plugin marketplace update "${name}" || warn "update ${name} failed"
      else
        info "marketplace ${name}: add (${repo})"
        [[ "${DRY_RUN}" -eq 1 ]] || claude plugin marketplace add "${repo}" || warn "add ${name} failed"
      fi
    done
}
step_plugins() {
  local toml="${CLAUDE_SETUP_TOML:-${REPO_ROOT}/claude-setup.toml}"
  local entries
  entries="$(python3 "${SCRIPT_DIR}/parse_toml.py" "${toml}" plugins)"
  local installed
  installed="$(claude plugin list --scope user 2>/dev/null || true)"
  python3 -c "
import json, sys
for e in json.loads(sys.argv[1]):
    pin = e.get('pin')
    print('\t'.join([e['name'], e['marketplace'], pin or '']))
" "${entries}" \
    | while IFS=$'\t' read -r name market pin; do
      local spec="${name}@${market}"
      if printf '%s\n' "${installed}" | grep -qw "${name}"; then
        info "plugin ${name}: update"
        [[ "${DRY_RUN}" -eq 1 ]] || claude plugin update "${spec}" || warn "update ${spec} failed"
      else
        if [[ -n "${pin}" ]]; then
          info "plugin ${name}: install (pinned ${pin})"
          [[ "${DRY_RUN}" -eq 1 ]] || claude plugin install "${spec}" --version "${pin}" --scope user || warn "install ${spec}@${pin} failed"
        else
          info "plugin ${name}: install"
          [[ "${DRY_RUN}" -eq 1 ]] || claude plugin install "${spec}" --scope user || warn "install ${spec} failed"
        fi
      fi
    done
}
step_skills()        { info "(npx skills — to be implemented in T9)"; }
step_dotfiles()      { info "(dotfiles — to be implemented in T10)"; }
step_symlinks()      { info "(symlinks — to be implemented in T11)"; }
step_summary()       { info "(summary — to be implemented in T12)"; }

for s in "${ALL_STEPS[@]}"; do run_step "${s}"; done

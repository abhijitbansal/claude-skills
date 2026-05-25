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
step_marketplaces()  { info "(marketplaces — to be implemented in T7)"; }
step_plugins()       { info "(plugins — to be implemented in T8)"; }
step_skills()        { info "(npx skills — to be implemented in T9)"; }
step_dotfiles()      { info "(dotfiles — to be implemented in T10)"; }
step_symlinks()      { info "(symlinks — to be implemented in T11)"; }
step_summary()       { info "(summary — to be implemented in T12)"; }

for s in "${ALL_STEPS[@]}"; do run_step "${s}"; done

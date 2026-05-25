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

FAILS=0
WARNS=0

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
step_claude() {
  if ! command -v claude >/dev/null 2>&1; then
    info "installing claude (official native installer)"
    [[ "${DRY_RUN}" -eq 1 ]] || curl -fsSL https://claude.ai/install.sh | bash || { FAILS=$((FAILS+1)); fail "installer failed"; return; }
    ensure_path
  fi
  info "claude version: $(claude --version 2>/dev/null || echo unknown)"
  [[ "${DRY_RUN}" -eq 1 ]] || claude update 2>/dev/null || { WARNS=$((WARNS+1)); warn "claude update failed"; }
}
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
step_skills() {
  if ! command -v npx >/dev/null 2>&1; then
    warn "npx not found; skipping npx skills"
    return 0
  fi
  local toml="${CLAUDE_SETUP_TOML:-${REPO_ROOT}/claude-setup.toml}"
  local entries
  entries="$(python3 "${SCRIPT_DIR}/parse_toml.py" "${toml}" skills)"
  python3 -c "
import json, sys
for e in json.loads(sys.argv[1]):
    print(e['source'] + '@' + e['name'])
" "${entries}" \
    | while IFS= read -r spec; do
      info "npx skill: ${spec}"
      [[ "${DRY_RUN}" -eq 1 ]] || npx -y skills add "${spec}" -g -y || warn "skills add ${spec} failed"
    done
  [[ "${DRY_RUN}" -eq 1 ]] || npx -y skills update -g -y 2>/dev/null || true
}
step_dotfiles() {
  local toml="${CLAUDE_SETUP_TOML:-${REPO_ROOT}/claude-setup.toml}"
  local dotfiles_json
  dotfiles_json="$(python3 "${SCRIPT_DIR}/parse_toml.py" "${toml}" dotfiles)"
  local timestamp
  timestamp="$(date +%Y%m%d-%H%M%S)"

  install_one() {
    local src_rel="$1" dst="$2"
    local src="${REPO_ROOT}/${src_rel}"
    [[ -f "${src}" ]] || { warn "missing template ${src}; skipping"; return 0; }
    if [[ -f "${dst}" ]] && ! cmp -s "${src}" "${dst}"; then
      cp "${dst}" "${dst}.bak.${timestamp}"
      info "backed up ${dst}"
    fi
    [[ "${DRY_RUN}" -eq 1 ]] || cp "${src}" "${dst}"
    info "installed ${dst}"
  }

  local home_md user_settings
  home_md="$(python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('home_claude_md',''))" "${dotfiles_json}")"
  user_settings="$(python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('user_settings',''))" "${dotfiles_json}")"

  mkdir -p "${HOME}/.claude"
  [[ -n "${home_md}" ]]       && install_one "${home_md}"       "${HOME}/CLAUDE.md"
  [[ -n "${user_settings}" ]] && install_one "${user_settings}" "${HOME}/.claude/settings.json"
}
step_symlinks() {
  local toml="${CLAUDE_SETUP_TOML:-${REPO_ROOT}/claude-setup.toml}"
  local custom_json
  custom_json="$(python3 "${SCRIPT_DIR}/parse_toml.py" "${toml}" custom_skills)"
  local dirs
  dirs="$(python3 -c "import json,sys; print('\n'.join(json.loads(sys.argv[1]).get('symlink_targets', [])))" "${custom_json}")"

  while IFS= read -r dir; do
    [[ -z "${dir}" ]] && continue
    local src_root="${REPO_ROOT}/${dir}"
    local dst_root="${HOME}/.claude/${dir}"
    [[ -d "${src_root}" ]] || { warn "no ${src_root}; skipping"; continue; }
    mkdir -p "${dst_root}"
    for entry in "${src_root}"/*; do
      [[ -e "${entry}" ]] || continue
      local base
      base="$(basename "${entry}")"
      [[ "${base}" == "_lib" ]] && continue
      safe_symlink "${entry}" "${dst_root}/${base}" || warn "symlink ${dst_root}/${base} failed"
    done
  done <<< "${dirs}"

  mkdir -p "${HOME}/.local/bin"
  safe_symlink "${REPO_ROOT}/setup/contribute.sh" "${HOME}/.local/bin/claude-skills-contribute"
}
step_summary() {
  bold "summary"
  printf "  fails=%d warns=%d\n" "${FAILS}" "${WARNS}"
  if (( FAILS > 0 )); then exit 1
  elif (( WARNS > 0 )); then exit 2
  else exit 0
  fi
}

for s in "${ALL_STEPS[@]}"; do run_step "${s}"; done

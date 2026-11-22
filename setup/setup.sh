#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# Caller's working dir, captured before any work — used to locate the "current
# repo" the guidelines step should also merge into.
INVOKE_PWD="${PWD}"
export CLAUDE_SKILLS_HOME="${CLAUDE_SKILLS_HOME:-${REPO_ROOT}}"

# shellcheck source=_lib.sh
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/_lib.sh"

DRY_RUN=0
ONLY=""
SKIP=" "  # space-delimited; sentinels ensure whole-word matching
MERGE_TARGET=""  # extra CLAUDE.md path for the guidelines step (--merge-claude-md)

ALL_STEPS=(preflight claude marketplaces plugins skills skills_schedule dotfiles guidelines local_plugins symlinks summary)

usage() {
  cat <<EOF
Usage: setup.sh [--dry-run] [--verbose] [--only <step>] [--skip-<step>] [--merge-claude-md <path>]
Steps: ${ALL_STEPS[*]}
  --merge-claude-md <path>  also merge behavioral guidelines into <path> (guidelines step)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)        DRY_RUN=1 ;;
    --verbose)        set -x ;;
    --only)           ONLY="$2"; shift ;;
    --merge-claude-md) MERGE_TARGET="$2"; shift ;;
    --skip-claude|--skip-marketplaces|--skip-plugins|--skip-skills|--skip-skills_schedule|--skip-dotfiles|--skip-guidelines|--skip-local_plugins|--skip-symlinks)
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

# Override _lib.sh's warn/fail so step bodies' calls auto-increment the counters
# that step_summary uses to pick an exit code. step_* functions never need to
# bump these counters explicitly.
warn() { printf "  ! %s\n" "$*" >&2; WARNS=$((WARNS+1)); }
fail() { printf "  ✗ %s\n" "$*" >&2; FAILS=$((FAILS+1)); return 1; }

run_step() {
  local name="$1"
  [[ -n "${ONLY}" && "${ONLY}" != "${name}" ]] && return 0
  [[ "${SKIP}" == *" ${name} "* ]] && { info "skipping ${name}"; return 0; }
  bold "step: ${name}"
  "step_${name}"
}

_ensure_brew_pkg() {
  # _ensure_brew_pkg <command-name> <brew-formula>
  local cmd="$1" formula="$2"
  command -v "${cmd}" >/dev/null 2>&1 && return 0
  if ! command -v brew >/dev/null 2>&1; then
    warn "${cmd} missing and Homebrew not installed; install Homebrew first"
    return 1
  fi
  info "installing ${formula} via brew"
  [[ "${DRY_RUN}" -eq 1 ]] || brew install "${formula}" >/dev/null || { warn "brew install ${formula} failed"; return 1; }
}

_ensure_uv() {
  command -v uv >/dev/null 2>&1 && { info "uv: $(uv --version 2>&1)"; return 0; }
  info "installing uv (Astral package manager)"
  if [[ "${DRY_RUN}" -eq 1 ]]; then return 0; fi
  curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null 2>&1 || { warn "uv install failed"; return 1; }
  # uv installer drops the binary in ~/.local/bin (already on PATH via ensure_path)
  command -v uv >/dev/null 2>&1 || { warn "uv installed but not on PATH"; return 1; }
}

step_preflight() {
  ensure_path
  python_check
  _ensure_brew_pkg bats        bats-core
  _ensure_brew_pkg shellcheck  shellcheck
  _ensure_uv
  info "preflight ok"
}
step_claude() {
  if ! command -v claude >/dev/null 2>&1; then
    info "installing claude (official native installer)"
    [[ "${DRY_RUN}" -eq 1 ]] || curl -fsSL https://claude.ai/install.sh | bash || { fail "installer failed"; return; }
    ensure_path
  fi
  info "claude version: $(claude --version 2>/dev/null || echo unknown)"
  [[ "${DRY_RUN}" -eq 1 ]] || claude update 2>/dev/null || warn "claude update failed"
}
step_marketplaces() {
  local toml="${CLAUDE_SETUP_TOML:-${REPO_ROOT}/claude-setup.toml}"
  local entries
  entries="$(python3 "${SCRIPT_DIR}/parse_toml.py" "${toml}" marketplaces)"
  local existing
  existing="$(claude plugin marketplace list 2>/dev/null || true)"
  python3 -c "import json,sys; [print(e['name']+'\t'+e['repo']) for e in json.loads(sys.argv[1])]" "${entries}" \
    | while IFS=$'\t' read -r name repo; do
      if printf '%s\n' "${existing}" | grep -qwF "${name}"; then
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
  installed="$(claude plugin list 2>/dev/null || true)"
  python3 -c "
import json, sys
for e in json.loads(sys.argv[1]):
    pin = e.get('pin')
    print('\t'.join([e['name'], e['marketplace'], pin or '']))
" "${entries}" \
    | while IFS=$'\t' read -r name market pin; do
      local spec="${name}@${market}"
      if printf '%s\n' "${installed}" | grep -qwF "${name}"; then
        info "plugin ${name}: update"
        [[ "${DRY_RUN}" -eq 1 ]] || claude plugin update "${spec}" || warn "update ${spec} failed"
      else
        if [[ -n "${pin}" ]]; then
          # `claude plugin install` has no version flag; pinning isn't
          # supported. Surface it rather than silently install a different one.
          warn "plugin ${name}: version pin '${pin}' unsupported by claude plugin install; installing latest"
        fi
        info "plugin ${name}: install"
        [[ "${DRY_RUN}" -eq 1 ]] || claude plugin install "${spec}" --scope user || warn "install ${spec} failed"
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
# Weekly launchd job that runs setup/skills-update.sh (npx skills update -g -y).
# Gated by [schedule] skills_weekly_update in the TOML; macOS only.
SKILLS_UPDATE_LABEL="com.claude-skills.skills-update"
_launchctl() { "${LAUNCHCTL:-launchctl}" "$@"; }
_skills_agent_loaded() { _launchctl print "$1" >/dev/null 2>&1; }

# Wait (bounded) until launchd has finished tearing the agent down; an immediate
# bootstrap after bootout can fail with "Input/output error".
SKILLS_BOOTOUT_POLL_TRIES=10
_wait_skills_agent_gone() {
  local target="$1" tries=0
  while _skills_agent_loaded "${target}"; do
    tries=$((tries + 1))
    if [[ "${tries}" -ge "${SKILLS_BOOTOUT_POLL_TRIES}" ]]; then
      warn "${SKILLS_UPDATE_LABEL} still loaded after ${tries} checks; bootstrapping anyway"
      return 0
    fi
    sleep "${SKILLS_SCHEDULE_POLL_DELAY:-0.5}"
  done
}

# Flag is off (or the section is gone): take down an agent an earlier run installed.
_skills_schedule_uninstall() {
  local plist="$1" domain="$2" toml="$3"
  local target="${domain}/${SKILLS_UPDATE_LABEL}"
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    if [[ -e "${plist}" ]]; then
      info "would unload ${SKILLS_UPDATE_LABEL} from ${domain} and remove ${plist} (disabled in ${toml##*/})"
    else
      info "weekly skills update: disabled in ${toml##*/}"
    fi
    return 0
  fi
  # The agent can be loaded with no plist on disk (file deleted by hand), so ask
  # launchd whichever way the file stands.
  if _skills_agent_loaded "${target}"; then
    if ! _launchctl bootout "${target}"; then
      warn "launchctl bootout ${SKILLS_UPDATE_LABEL} failed; keeping ${plist} so the next run retries"
      return 0
    fi
  elif [[ ! -e "${plist}" ]]; then
    info "weekly skills update: disabled in ${toml##*/}"
    return 0
  fi
  if [[ -e "${plist}" ]] && ! rm -f "${plist}"; then
    warn "could not remove ${plist}; remove it by hand"
    return 0
  fi
  info "weekly skills update disabled in ${toml##*/}: unloaded and removed ${plist}"
}

step_skills_schedule() {
  local toml="${CLAUDE_SETUP_TOML:-${REPO_ROOT}/claude-setup.toml}"
  local schedule_json flag_out flag unknown=""
  schedule_json="$(python3 "${SCRIPT_DIR}/parse_toml.py" "${toml}" schedule)" || { fail "cannot read [schedule] from ${toml}"; return; }
  # Line 1: on | off | none | invalid. Line 2 (optional): other keys in [schedule].
  # off = explicit false; none = key absent (a missing or empty table lands here).
  flag_out="$(python3 -c "
import json, sys
s = json.loads(sys.argv[1])
if not isinstance(s, dict):
    print('invalid')
    sys.exit(0)
if 'skills_weekly_update' not in s:
    print('none')
else:
    v = s['skills_weekly_update']
    print('on' if v is True else 'off' if v is False else 'invalid')
print(','.join(sorted(k for k in s if k != 'skills_weekly_update')))" "${schedule_json}")" \
    || { fail "cannot parse [schedule] in ${toml##*/}"; return; }
  flag="${flag_out%%$'\n'*}"
  if [[ "${flag_out}" == *$'\n'* ]]; then unknown="${flag_out#*$'\n'}"; fi
  if [[ -n "${unknown}" ]]; then
    warn "[schedule] in ${toml##*/} has unknown key(s): ${unknown}; only skills_weekly_update is read"
  fi
  case "${flag}" in
    on|off) ;;
    none)
      if [[ -n "${unknown}" ]]; then
        # Probably a misspelling of skills_weekly_update: never take the agent down for it.
        warn "skills_weekly_update is not set in ${toml##*/}; leaving any installed agent as is"
        return 0
      fi
      flag="off" ;;
    invalid)
      warn "[schedule] skills_weekly_update must be true or false (and [schedule] a table) in ${toml##*/}; ignoring it and leaving any installed agent as is"
      return 0 ;;
    *)
      fail "cannot parse [schedule] in ${toml##*/}"
      return ;;
  esac
  if [[ "$(uname -s)" != "Darwin" ]]; then
    info "weekly skills update: launchd needs macOS; skipping"
    return 0
  fi

  local npx_path template plist log_dir domain
  plist="${HOME}/Library/LaunchAgents/${SKILLS_UPDATE_LABEL}.plist"
  domain="gui/$(id -u)"
  if [[ "${flag}" == "off" ]]; then
    _skills_schedule_uninstall "${plist}" "${domain}" "${toml}"
    return 0
  fi

  npx_path="$(command -v npx 2>/dev/null || true)"
  if [[ -z "${npx_path}" ]]; then
    npx_path="/opt/homebrew/bin/npx"
    warn "npx not found on PATH; the weekly job will point at ${npx_path}, which may not exist. Install node, then re-run: setup.sh --only skills_schedule"
  fi
  template="${SCRIPT_DIR}/launchd/${SKILLS_UPDATE_LABEL}.plist.template"
  log_dir="${HOME}/Library/Logs/claude-skills"
  [[ -f "${template}" ]] || { fail "missing ${template}"; return; }

  if [[ "${DRY_RUN}" -eq 1 ]]; then
    info "would write ${plist} (npx: ${npx_path})"
    info "would load ${SKILLS_UPDATE_LABEL} into ${domain}"
    return 0
  fi

  mkdir -p "${HOME}/Library/LaunchAgents" "${log_dir}"
  # Render outside LaunchAgents so a failed or interrupted run leaves nothing there.
  local tmp_dir tmp_plist
  tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/claude-skills-plist.XXXXXX")" || { fail "cannot create a temp dir"; return; }
  tmp_plist="${tmp_dir}/${SKILLS_UPDATE_LABEL}.plist"
  if ! python3 - "${template}" "${tmp_plist}" "${SKILLS_UPDATE_LABEL}" "${SCRIPT_DIR}/skills-update.sh" \
      "${npx_path}" "${log_dir}" <<'PY'
import sys
from xml.sax.saxutils import escape
template, out, label, script, npx, log_dir = sys.argv[1:7]
text = open(template).read()
for token, value in (("@LABEL@", label), ("@SCRIPT@", script), ("@NPX@", npx),
                     ("@LOG_DIR@", log_dir)):
    text = text.replace(token, escape(value))
open(out, "w").write(text)
PY
  then
    rm -rf "${tmp_dir}"
    fail "could not render ${plist}"
    return
  fi
  chmod 644 "${tmp_plist}"

  local target="${domain}/${SKILLS_UPDATE_LABEL}" unchanged=0 loaded=0
  if [[ -f "${plist}" ]] && cmp -s "${tmp_plist}" "${plist}"; then unchanged=1; fi
  if _skills_agent_loaded "${target}"; then loaded=1; fi
  if [[ "${unchanged}" -eq 1 && "${loaded}" -eq 1 ]]; then
    rm -rf "${tmp_dir}"
    info "weekly skills update already installed and loaded; no change"
    return 0
  fi

  if ! mv "${tmp_plist}" "${plist}"; then
    rm -rf "${tmp_dir}"
    fail "could not install ${plist}"
    return
  fi
  rm -rf "${tmp_dir}"
  info "wrote ${plist}"

  # Reload: drop the loaded copy, wait for it to go, then bootstrap (one retry).
  if [[ "${loaded}" -eq 1 ]]; then
    _launchctl bootout "${target}" || warn "launchctl bootout ${SKILLS_UPDATE_LABEL} failed"
    _wait_skills_agent_gone "${target}"
  fi
  if ! _launchctl bootstrap "${domain}" "${plist}"; then
    sleep "${SKILLS_SCHEDULE_POLL_DELAY:-0.5}"
    if ! _launchctl bootstrap "${domain}" "${plist}"; then
      warn "launchctl bootstrap ${SKILLS_UPDATE_LABEL} failed (after one retry)"
      return 0
    fi
  fi
  info "weekly skills update loaded (Sunday 10:00); log: ${log_dir}/skills-update.log"
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
      if [[ "${DRY_RUN}" -eq 1 ]]; then
        info "would back up ${dst}"
      else
        cp "${dst}" "${dst}.bak.${timestamp}"
        info "backed up ${dst}"
      fi
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
# _merge_into <source-claude-md> <target-claude-md>
# Additively merge the source's guideline sections into target, honoring DRY_RUN.
_merge_into() {
  local src="$1" dst="$2" out
  local -a cmd=(python3 "${SCRIPT_DIR}/merge_guidelines.py" "${src}" "${dst}")
  [[ "${DRY_RUN}" -eq 1 ]] && cmd+=(--dry-run)
  if out="$("${cmd[@]}" 2>&1)"; then
    info "guidelines → ${dst}"
    while IFS= read -r line; do [[ -n "${line}" ]] && info "  ${line}"; done <<<"${out}"
  else
    warn "guideline merge into ${dst} failed: ${out}"
  fi
}
step_guidelines() {
  # Canonical guidelines live in this repo's CLAUDE.md (between the markers).
  local source="${REPO_ROOT}/CLAUDE.md"
  [[ -f "${source}" ]] || { warn "no ${source}; skipping guideline merge"; return 0; }

  # Always: the machine-global file.
  _merge_into "${source}" "${HOME}/CLAUDE.md"

  # The repo the user invoked setup from, if it's a git repo other than this one.
  local cur_repo
  cur_repo="$(git -C "${INVOKE_PWD}" rev-parse --show-toplevel 2>/dev/null || true)"
  if [[ -n "${cur_repo}" && "${cur_repo}" != "${REPO_ROOT}" ]]; then
    _merge_into "${source}" "${cur_repo}/CLAUDE.md"
  fi

  # An explicit extra target (--merge-claude-md), for "any repo or path".
  [[ -n "${MERGE_TARGET}" ]] && _merge_into "${source}" "${MERGE_TARGET}"
}
step_local_plugins() {
  local manifest="${REPO_ROOT}/.claude-plugin/marketplace.json"
  [[ -f "${manifest}" ]] || { warn "no ${manifest}; skipping"; return 0; }
  local existing
  existing="$(claude plugin marketplace list 2>/dev/null || true)"
  # Match the marketplace name line exactly ("❯ claude-skills"); a word match
  # also hits another marketplace's "Source: GitHub (someone/claude-skills)".
  if printf '%s\n' "${existing}" | sed -E 's/^[[:space:]]*(❯[[:space:]]*)?//; s/[[:space:]]+$//' | grep -qxF "claude-skills"; then
    info "self marketplace: update"
    [[ "${DRY_RUN}" -eq 1 ]] || claude plugin marketplace update claude-skills || warn "marketplace update failed"
  else
    info "self marketplace: add (${REPO_ROOT})"
    [[ "${DRY_RUN}" -eq 1 ]] || claude plugin marketplace add "${REPO_ROOT}" || warn "marketplace add failed"
  fi
  local installed
  installed="$(claude plugin list 2>/dev/null || true)"
  python3 -c "import json,sys; [print(p['name']) for p in json.load(open(sys.argv[1]))['plugins']]" "${manifest}" \
    | while IFS= read -r name; do
      if printf '%s\n' "${installed}" | grep -qwF "${name}"; then
        info "local plugin ${name}: update"
        [[ "${DRY_RUN}" -eq 1 ]] || claude plugin update "${name}@claude-skills" || warn "update ${name} failed"
      else
        info "local plugin ${name}: install"
        [[ "${DRY_RUN}" -eq 1 ]] || claude plugin install "${name}@claude-skills" --scope user || warn "install ${name} failed"
      fi
    done
}
step_symlinks() {
  # Clean up symlinks left behind by the pre-plugin layout: anything in
  # ~/.claude/{skills,agents,commands} that points into this repo is stale
  # now that plugins own those assets.
  local dir base target entry
  for dir in skills agents commands; do
    local dst_root="${HOME}/.claude/${dir}"
    [[ -d "${dst_root}" ]] || continue
    for entry in "${dst_root}"/*; do
      [[ -L "${entry}" ]] || continue
      target="$(readlink "${entry}")"
      if [[ "${target}" == "${REPO_ROOT}"/* ]]; then
        base="$(basename "${entry}")"
        if [[ "${DRY_RUN}" -eq 1 ]]; then
          info "would remove stale link ${dst_root}/${base}"
        else
          rm "${entry}"
          info "removed stale link ${dst_root}/${base}"
        fi
      fi
    done
  done

  mkdir -p "${HOME}/.local/bin"
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    info "would link ${HOME}/.local/bin/claude-skills-contribute → ${REPO_ROOT}/setup/contribute.sh"
  else
    safe_symlink "${REPO_ROOT}/setup/contribute.sh" "${HOME}/.local/bin/claude-skills-contribute"
  fi

  if [[ "${DRY_RUN}" -eq 1 ]]; then
    info "would link ${HOME}/.local/bin/wind → ${REPO_ROOT}/tools/second-wind/wind.py"
  else
    safe_symlink "${REPO_ROOT}/tools/second-wind/wind.py" "${HOME}/.local/bin/wind"
  fi
}
step_summary() {
  bold "summary"
  printf "  fails=%d warns=%d\n" "${FAILS}" "${WARNS}"
  if (( FAILS > 0 )); then exit 1
  elif (( WARNS > 0 )); then exit 2
  else exit 0
  fi
}

# `|| true` so a single step returning non-zero (e.g. a warn/fail under set -e)
# can't abort the loop and skip step_summary or later steps. Per-step failures
# are tracked via the FAILS/WARNS counters, which decide the final exit code.
for s in "${ALL_STEPS[@]}"; do run_step "${s}" || true; done

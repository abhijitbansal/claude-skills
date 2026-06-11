#!/usr/bin/env bash
# Wire this repo's skills into non-Claude AI tools.
# Usage: install.sh <codex|copilot|agents-md|all> [agents-md-target-file]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=../setup/_lib.sh
# shellcheck disable=SC1091
source "${REPO_ROOT}/setup/_lib.sh"

usage() { echo "Usage: install.sh <codex|copilot|agents-md|all> [agents-md target file]"; }

# Every skill dir across all plugins, one per line. Skips _lib (shared helpers, not a skill).
skill_dirs() {
  local d
  for d in "${REPO_ROOT}"/plugins/*/skills/*/; do
    [[ -d "${d}" ]] || continue
    [[ "$(basename "${d}")" == "_lib" ]] && continue
    [[ -f "${d}/SKILL.md" ]] || continue
    printf '%s\n' "${d%/}"
  done
}

# link_skills <dest-dir>: symlink each skill dir into dest, prune stale repo links.
link_skills() {
  local dest="$1"
  mkdir -p "${dest}"
  # prune: links we own (pointing into this repo) whose target vanished
  local entry target
  for entry in "${dest}"/*; do
    [[ -L "${entry}" ]] || continue
    target="$(readlink "${entry}")"
    if [[ "${target}" == "${REPO_ROOT}"/* && ! -e "${entry}" ]]; then
      rm "${entry}"
      info "pruned stale link $(basename "${entry}")"
    fi
  done
  local d
  while IFS= read -r d; do
    safe_symlink "${d}" "${dest}/$(basename "${d}")"
  done < <(skill_dirs)
}

mode_codex() {
  local dest="${CODEX_SKILLS_DIR:-${HOME}/.codex/skills}"
  if [[ -z "${CODEX_SKILLS_DIR:-}" && ! -d "${HOME}/.codex" ]]; then
    info "no ~/.codex — Codex not installed; skipping"
    return 0
  fi
  link_skills "${dest}"
  info "codex: skills linked into ${dest}"
}

mode_copilot() {
  local dest="${COPILOT_SKILLS_DIR:-${HOME}/.copilot/skills}"
  if [[ -z "${COPILOT_SKILLS_DIR:-}" && ! -d "${HOME}/.copilot" ]]; then
    info "no ~/.copilot — Copilot CLI not installed; skipping"
    return 0
  fi
  link_skills "${dest}"
  info "copilot: skills linked into ${dest}"
}

mode_agents_md() { info "agents-md: not yet implemented"; }

MODE="${1:-}"
TARGET="${2:-AGENTS.md}"
case "${MODE}" in
  codex)     mode_codex ;;
  copilot)   mode_copilot ;;
  agents-md) mode_agents_md "${TARGET}" ;;
  all)       mode_codex; mode_copilot; mode_agents_md "${TARGET}" ;;
  *)         usage; exit 2 ;;
esac

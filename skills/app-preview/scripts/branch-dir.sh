#!/usr/bin/env bash
#
# app-preview: compute a filesystem-safe slug from the current git branch.
#
# Used by snap.sh, deliver.sh, and bundle.sh to organize preview output by
# branch — so the user can flip between branches and see exactly which
# screenshots belong to which line of work.
#
# Flattening: only forward slashes are rewritten to '--' (the example in the
# issue: 'ui/update-match-design' -> 'ui--update-match-design'). Branch names
# already exclude the unsafe characters iOS Files would object to, so no
# further substitution is applied — surprise transforms would make the folder
# hard to predict.
#
# Detached HEAD: falls back to 'detached-<shortsha>' so a run from a tagged
# commit or a worktree still produces a stable, recognizable folder.
#
# Usage:
#   source branch-dir.sh   # then call paperix_branch_slug
#   paperix_branch_slug    # prints slug on stdout, e.g. 'agent--ABH-6-...'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../_lib/load_app_config.sh
source "${SCRIPT_DIR}/../../_lib/load_app_config.sh"
APP_NAME_LC="$(echo "${APP_NAME}" | tr '[:upper:]' '[:lower:]')"

paperix_branch_slug() {
  # `git rev-parse --abbrev-ref HEAD` returns the literal string 'HEAD' in
  # detached state; treat empty and 'HEAD' both as detached so the fallback
  # is consistent across git versions.
  local ref
  ref="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  if [[ -z "$ref" || "$ref" == "HEAD" ]]; then
    local sha
    sha="$(git rev-parse --short HEAD 2>/dev/null || echo "nogit")"
    printf 'detached-%s\n' "$sha"
    return
  fi
  printf '%s\n' "${ref//\//--}"
}

# Allow invoking the file directly for quick inspection / debugging.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  paperix_branch_slug
fi

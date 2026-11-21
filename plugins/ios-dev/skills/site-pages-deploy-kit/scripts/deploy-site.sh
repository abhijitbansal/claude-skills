#!/usr/bin/env bash
# Deploy the app's marketing/legal site (a subtree of the app repo) to its
# public GitHub Pages repo. Generalized port of the originating app's deploy-site.sh —
# every guard preserved. Force-push is intentional: the public repo's history
# is a derivative, not a source of truth.
#
# Remote precedence: $SITE_REMOTE > .site-remote file > app.yml site.repo.
# Usage: deploy-site.sh [--dry-run] [-h|--help]
#   --dry-run  do everything except the push
# Any other argument exits 2 (a typo must never become a force-push).
set -euo pipefail

DRY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "deploy-site: unknown argument '$1' (accepted: --dry-run, -h|--help)" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../_lib/load_app_config.sh
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/../../_lib/load_app_config.sh"

cd "$(git rev-parse --show-toplevel)"

REMOTE_URL="${SITE_REMOTE:-}"
if [[ -z "${REMOTE_URL}" && -f .site-remote ]]; then
  REMOTE_URL="$(tr -d '[:space:]' < .site-remote)"
fi
if [[ -z "${REMOTE_URL}" && -n "${SITE_REPO}" ]]; then
  REMOTE_URL="git@github.com:${SITE_REPO}.git"
fi
if [[ -z "${REMOTE_URL}" ]]; then
  echo "No deploy target: set site.repo in .claude/app.yml, or SITE_REMOTE, or .site-remote" >&2
  exit 1
fi

# Deploys are cut from HEAD — surface anything uncommitted (incl. untracked)
# under the site dir so the deploy reflects reviewed state.
if [[ -n "$(git status --porcelain -- "${SITE_DIR}")" ]]; then
  echo "Uncommitted changes under ${SITE_DIR}/ — commit them first." >&2
  git status -- "${SITE_DIR}" >&2
  exit 1
fi
[[ -d "${SITE_DIR}" ]] || { echo "site dir '${SITE_DIR}' not found (app.yml site.dir)" >&2; exit 1; }
# The force-push replaces the public repo's tree, so a custom domain survives
# only if CNAME is part of the pushed subtree (GitHub clears it otherwise).
if [[ -n "${SITE_DOMAIN}" && ! -f "${SITE_DIR}/CNAME" ]]; then
  echo "site.domain is '${SITE_DOMAIN}' but ${SITE_DIR}/CNAME is missing — commit a CNAME file containing the domain (a force-push without it drops the custom domain)." >&2
  exit 1
fi
[[ "${SITE_DEPLOY}" == "subtree-ssh" ]] || {
  echo "site.deploy '${SITE_DEPLOY}' not supported — only 'subtree-ssh' is implemented" >&2
  exit 1
}

# Redact userinfo (e.g. https://x-access-token:TOKEN@github.com/...) so a
# tokenized remote never lands in logs. CI uses an SSH deploy key instead.
SAFE_REMOTE="$(printf '%s' "${REMOTE_URL}" | sed -E 's#//[^@/]+@#//***@#')"
echo "==> Deploying ${SITE_DIR}/ to ${SAFE_REMOTE} (main branch)"

SPLIT_SHA="$(git subtree split --prefix="${SITE_DIR}" HEAD)"
echo "==> Split SHA: ${SPLIT_SHA}"

if [[ ${DRY} -eq 1 ]]; then
  echo "dry-run: not pushing"
  exit 0
fi

git push --force "${REMOTE_URL}" "${SPLIT_SHA}:refs/heads/main"

echo ""
echo "Deployed. If Pages isn't enabled yet on the public repo:"
echo "  Settings → Pages → Source = Deploy from a branch → main / (root)."
if [[ -n "${SITE_DOMAIN}" ]]; then
  echo "Check the live site and the Apple association file (not asserted here):"
  echo "  curl -sI https://${SITE_DOMAIN}/.well-known/apple-app-site-association"
fi

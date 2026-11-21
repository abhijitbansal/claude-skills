#!/usr/bin/env bash
# Deploy {{SITE_DIR}}/ to the public Pages repo (placed by /site create; standalone so
# CI can run it — the canonical logic lives in the ios-dev site kit).
# Override target: SITE_REMOTE=git@github.com:<user>/<repo>.git ./scripts/deploy-site.sh
# Usage: deploy-site.sh [--dry-run] [-h|--help]
# Any other argument exits 2 (a typo must never become a force-push).
set -euo pipefail

DRY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n '2,6p' "$0"; exit 0 ;;
    *) echo "deploy-site: unknown argument '$1' (accepted: --dry-run, -h|--help)" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")/.."

SITE_DIR="{{SITE_DIR}}"
DEFAULT_REMOTE="git@github.com:{{SITE_REPO}}.git"
REMOTE_URL="${SITE_REMOTE:-}"
[[ -z "$REMOTE_URL" && -f .site-remote ]] && REMOTE_URL="$(tr -d '[:space:]' < .site-remote)"
REMOTE_URL="${REMOTE_URL:-$DEFAULT_REMOTE}"

if [[ -n "$(git status --porcelain -- "$SITE_DIR")" ]]; then
  echo "Uncommitted changes in $SITE_DIR/ — commit first (deploys cut from HEAD)." >&2
  git status -- "$SITE_DIR" >&2
  exit 1
fi

SAFE_REMOTE="$(printf '%s' "$REMOTE_URL" | sed -E 's#//[^@/]+@#//***@#')"
echo "==> Deploying $SITE_DIR/ to $SAFE_REMOTE (main)"
SPLIT_SHA="$(git subtree split --prefix="$SITE_DIR" HEAD)"
if [[ $DRY -eq 1 ]]; then
  echo "dry-run: not pushing"
  exit 0
fi
git push --force "$REMOTE_URL" "$SPLIT_SHA:refs/heads/main"
echo "Deployed."

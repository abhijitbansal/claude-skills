#!/usr/bin/env bash
# Deploy site/ to the public Pages repo (placed by /site create; standalone so
# CI can run it — the canonical logic lives in the ios-dev site kit).
# Override target: SITE_REMOTE=git@github.com:<user>/<repo>.git ./scripts/deploy-site.sh
set -euo pipefail
cd "$(dirname "$0")/.."

DEFAULT_REMOTE="git@github.com:{{SITE_REPO}}.git"
REMOTE_URL="${SITE_REMOTE:-}"
[[ -z "$REMOTE_URL" && -f .site-remote ]] && REMOTE_URL="$(tr -d '[:space:]' < .site-remote)"
REMOTE_URL="${REMOTE_URL:-$DEFAULT_REMOTE}"

if [[ -n "$(git status --porcelain -- site)" ]]; then
  echo "Uncommitted changes in site/ — commit first (deploys cut from HEAD)." >&2
  git status -- site >&2
  exit 1
fi

SAFE_REMOTE="$(printf '%s' "$REMOTE_URL" | sed -E 's#//[^@/]+@#//***@#')"
echo "==> Deploying site/ to $SAFE_REMOTE (main)"
SPLIT_SHA="$(git subtree split --prefix=site HEAD)"
git push --force "$REMOTE_URL" "$SPLIT_SHA:refs/heads/main"
echo "Deployed."

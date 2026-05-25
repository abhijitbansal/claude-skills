#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "${SCRIPT_DIR}/_lib.sh"

REPO="${CLAUDE_SKILLS_HOME:-${HOME}/projects/claude-skills}"
[[ -d "${REPO}/.git" ]] || { fail "no claude-skills repo at ${REPO}; clone first"; exit 1; }

SKILL=""
MESSAGE=""
NO_PR=0
AUTO_MERGE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skill)        SKILL="$2"; shift ;;
    --message)      MESSAGE="$2"; shift ;;
    --no-pr)        NO_PR=1 ;;
    --auto-merge)   AUTO_MERGE=1 ;;
    *) fail "unknown arg: $1"; exit 2 ;;
  esac
  shift
done

# Step 1: preflight
gh_auth_check

# Step 2: sync
cd "${REPO}"
if [[ -n "$(git status --porcelain)" ]]; then
  fail "working tree dirty at ${REPO}; commit or stash first"
  git status --short
  exit 1
fi
git fetch origin 2>/dev/null || warn "git fetch failed (offline?)"
git switch main 2>/dev/null || git switch master 2>/dev/null || true
git pull --ff-only 2>/dev/null || warn "git pull failed (no remote?)"

# Step 3: branch
slug="${SKILL:-${MESSAGE:-update}}"
slug="$(echo "${slug}" | tr '[:upper:] ' '[:lower:]-' | tr -cd 'a-z0-9-')"
branch="contrib/${slug}-$(date +%Y%m%d-%H%M)"
git switch -c "${branch}"

# Step 4: mutate
if [[ -n "${SKILL}" ]]; then
  dest="${REPO}/skills/${SKILL}"
  [[ -e "${dest}" ]] && { fail "skill ${SKILL} already exists"; exit 1; }
  mkdir -p "${dest}/scripts"
  sed "s/<skill-name>/${SKILL}/g" "${REPO}/templates/skill.md.example" > "${dest}/SKILL.md"
  info "scaffolded skills/${SKILL}/"
else
  bash "${SCRIPT_DIR}/capture.sh"
fi

# Step 5: validate
info "running tests"
# Guard against recursive invocation: when contribute.sh itself is being tested
# inside bats, the bats step would re-enter contribute.sh and recurse infinitely.
if command -v bats >/dev/null 2>&1 && [[ -z "${CLAUDE_SKILLS_CONTRIBUTE_NESTED:-}" ]]; then
  CLAUDE_SKILLS_CONTRIBUTE_NESTED=1 bats "${REPO}/tests/bats" >/dev/null 2>&1 || { fail "bats failing — leaving branch ${branch} for you to fix"; exit 1; }
fi
if command -v pytest >/dev/null 2>&1 && [[ -z "${CLAUDE_SKILLS_CONTRIBUTE_NESTED:-}" ]]; then
  CLAUDE_SKILLS_CONTRIBUTE_NESTED=1 pytest "${REPO}/tests/pytest" -q >/dev/null 2>&1 || { fail "pytest failing — leaving branch ${branch}"; exit 1; }
fi
if command -v shellcheck >/dev/null 2>&1; then
  shellcheck "${REPO}"/setup/*.sh 2>/dev/null || true
fi

# Step 6: commit
if [[ -z "$(git status --porcelain)" ]]; then
  info "nothing to commit; aborting"
  git switch -
  git branch -d "${branch}"
  exit 0
fi
git add -A
msg="${MESSAGE:-chore: contribute via claude-skills-contribute}"
git commit -m "${msg}

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"

# Step 7: push
git push -u origin "${branch}" 2>/dev/null || warn "git push failed (no remote?)"

# Step 8: PR
if (( NO_PR == 0 )); then
  gh pr create --title "${msg}" --body "Automated contribution from claude-skills-contribute." || warn "gh pr create failed"
fi

# Step 9: merge
if (( AUTO_MERGE == 1 )); then
  gh pr merge --squash --delete-branch || warn "gh pr merge failed"
fi

info "done"

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/_lib.sh"

REPO="${CLAUDE_SKILLS_HOME:-${HOME}/projects/claude-skills}"
[[ -d "${REPO}/.git" ]] || { fail "no claude-skills repo at ${REPO}; clone first"; exit 1; }

SKILL=""
PLUGIN="core-workflow"
MESSAGE=""
NO_PR=0
AUTO_MERGE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skill)        SKILL="$2"; shift ;;
    --plugin)       PLUGIN="$2"; shift ;;
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
_orig_branch="$(git symbolic-ref --short HEAD 2>/dev/null || echo "")"
git switch main 2>/dev/null || git switch master 2>/dev/null || true
_new_branch="$(git symbolic-ref --short HEAD 2>/dev/null || echo "")"
# If the branch switch moved us to a branch missing key files, return to origin
if [[ "${_new_branch}" != "${_orig_branch}" && ! -d "${REPO}/tests/bats" ]]; then
  warn "main branch missing tests/; reverting to ${_orig_branch}"
  git switch "${_orig_branch}" 2>/dev/null || true
fi
git pull --ff-only 2>/dev/null || warn "git pull failed (no remote?)"

# Step 3: branch
slug="${SKILL:-${MESSAGE:-update}}"
slug="$(echo "${slug}" | tr '[:upper:] ' '[:lower:]-' | tr -cd 'a-z0-9-')"
branch="contrib/${slug}-$(date +%Y%m%d-%H%M)"
git switch -c "${branch}"

# Step 4: mutate
if [[ -n "${SKILL}" ]]; then
  [[ -d "${REPO}/plugins/${PLUGIN}" ]] || { fail "no plugin ${PLUGIN} in ${REPO}/plugins"; exit 1; }
  dest="${REPO}/plugins/${PLUGIN}/skills/${SKILL}"
  [[ -e "${dest}" ]] && { fail "skill ${SKILL} already exists"; exit 1; }
  mkdir -p "${dest}/scripts"
  template="${REPO}/templates/skill.md.example"
  if [[ -f "${template}" ]]; then
    sed "s/<skill-name>/${SKILL}/g" "${template}" > "${dest}/SKILL.md"
  else
    cat > "${dest}/SKILL.md" <<EOF
---
name: ${SKILL}
description: <one-line trigger description; when should Claude pick this skill>
---

# <Skill Title>

## When to use

- <case 1>
- <case 2>

## Steps

1. <first step>
2. <second step>

## Hard rules

- <rule>
EOF
  fi
  info "scaffolded plugins/${PLUGIN}/skills/${SKILL}/"
else
  bash "${SCRIPT_DIR}/capture.sh"
fi

# Step 5: validate
info "running tests"
# Guard against recursive invocation: when contribute.sh itself is being tested
# inside bats, the bats step would re-enter contribute.sh and recurse infinitely.
# BATS_TEST_FILENAME is exported to all subprocess envs by bats, so we check both.
_skip_validate="${CLAUDE_SKILLS_CONTRIBUTE_NESTED:-}${BATS_TEST_FILENAME:-}"
if command -v bats >/dev/null 2>&1 && [[ -z "${_skip_validate}" ]]; then
  CLAUDE_SKILLS_CONTRIBUTE_NESTED=1 bats "${REPO}/tests/bats" >/dev/null 2>&1 || { fail "bats failing — leaving branch ${branch} for you to fix"; exit 1; }
fi
if command -v uv >/dev/null 2>&1 && [[ -z "${_skip_validate}" ]]; then
  CLAUDE_SKILLS_CONTRIBUTE_NESTED=1 uv tool run pytest "${REPO}/tests/pytest" -q >/dev/null 2>&1 || { fail "pytest failing — leaving branch ${branch}"; exit 1; }
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

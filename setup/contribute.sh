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
# Capture mode stops after capture unless --commit or --push; --skill mode
# commits and pushes by default.
COMMIT_FLAG=""
ACCEPTED="--skill <name>, --plugin <name>, --message <text>, --commit, --push, --no-pr, --auto-merge"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skill)        SKILL="$2"; shift ;;
    --plugin)       PLUGIN="$2"; shift ;;
    --message)      MESSAGE="$2"; shift ;;
    --commit)       COMMIT_FLAG="commit" ;;
    --push)         COMMIT_FLAG="push" ;;
    --no-pr)        NO_PR=1 ;;
    --auto-merge)   AUTO_MERGE=1 ;;
    *) fail "unknown arg: $1 (accepted: ${ACCEPTED})" || true; exit 2 ;;
  esac
  shift
done

if [[ -n "${COMMIT_FLAG}" ]]; then
  DO_COMMIT=1; [[ "${COMMIT_FLAG}" == "push" ]] && DO_PUSH=1 || DO_PUSH=0
elif [[ -n "${SKILL}" ]]; then
  DO_COMMIT=1; DO_PUSH=1
else
  DO_COMMIT=0; DO_PUSH=0
fi

# Step 1: preflight
gh_auth_check
# --skill mode must validate before it commits; a missing runner would push an
# untested scaffold.
if [[ -n "${SKILL}" ]]; then
  for tool in bats uv; do
    command -v "${tool}" >/dev/null 2>&1 || {
      fail "--skill needs bats and uv to validate before committing; '${tool}' not found (install bats-core and uv)" || true
      exit 1
    }
  done
fi

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
  STAGE_PATHS=("plugins/${PLUGIN}/skills/${SKILL}")
else
  bash "${SCRIPT_DIR}/capture.sh"
  # Only the paths capture.sh writes; never untracked debris.
  STAGE_PATHS=()
  for p in templates/home-CLAUDE.md templates/user-settings.json claude-setup.toml; do
    [[ -e "${REPO}/${p}" ]] && STAGE_PATHS+=("${p}")
  done
  if (( DO_COMMIT == 0 )); then
    git --no-pager diff --stat -- "${STAGE_PATHS[@]}"
    git --no-pager diff -- "${STAGE_PATHS[@]}"
    info "captured on branch ${branch}; nothing committed. Review the diff above for secrets and private names."
    info "to keep it: git -C \"${REPO}\" add -- ${STAGE_PATHS[*]} && git -C \"${REPO}\" commit, then push and open a PR yourself."
    info "next time pass --commit (commit only) or --push (commit, push, open a PR) to do it in one run once you trust the capture."
    exit 0
  fi
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

# Step 6: commit (only the paths this run wrote)
if [[ -z "$(git status --porcelain -- "${STAGE_PATHS[@]}")" ]]; then
  info "nothing to commit; aborting"
  git switch -
  git branch -d "${branch}"
  exit 0
fi
git add -- "${STAGE_PATHS[@]}"
msg="${MESSAGE:-chore: contribute via claude-skills-contribute}"
git commit -m "${msg}

Co-Authored-By: Claude <noreply@anthropic.com>"

if (( DO_PUSH == 0 )); then
  info "committed on ${branch}; not pushed (--commit). Push with: git -C \"${REPO}\" push -u origin ${branch}"
  exit 0
fi

# Step 7: push
git push -u origin "${branch}" 2>/dev/null || warn "git push failed (no remote?)"

# Step 8: PR
if (( NO_PR == 0 )); then
  gh pr create --title "${msg}" --body "Automated contribution from claude-skills-contribute." || warn "gh pr create failed"
fi

# Step 9: merge. --auto queues the squash-merge until required checks pass; it
# does not merge now. Branch protection (e.g. a solo CODEOWNERS review) can
# still hold it, and only an admin merge gets past that.
if (( AUTO_MERGE == 1 )); then
  if gh pr merge --auto --squash --delete-branch; then
    info "merge queued: GitHub squash-merges once checks pass and reviews allow"
  else
    warn "gh pr merge --auto failed (auto-merge disabled on the repo?)"
  fi
fi

info "done"

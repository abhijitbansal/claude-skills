#!/usr/bin/env bash
# Fail when any commit in a range carries a trailer the repo forbids
# (AGENTS.md): a Claude-Session line, or a Co-Authored-By naming Claude other
# than the exact repo trailer "Co-Authored-By: Claude <noreply@anthropic.com>"
# (for example one that names a model). Human co-authors pass.
#
# Usage: check_trailers.sh <rev-range> [repo-dir]
#   e.g. check_trailers.sh "$BASE_SHA..$HEAD_SHA"
set -euo pipefail

usage() { echo "usage: check_trailers.sh <rev-range> [repo-dir]" >&2; }

RANGE=""
REPO="."
for arg in "$@"; do
  case "${arg}" in
    -h|--help) usage; exit 0 ;;
    -*) echo "unknown flag: ${arg} (accepted: -h, --help)" >&2; usage; exit 2 ;;
    *)
      if [[ -z "${RANGE}" ]]; then RANGE="${arg}"
      elif [[ "${REPO}" == "." ]]; then REPO="${arg}"
      else echo "too many arguments: ${arg}" >&2; usage; exit 2
      fi ;;
  esac
done
[[ -n "${RANGE}" ]] || { usage; exit 2; }

ALLOWED='Co-Authored-By: Claude <noreply@anthropic.com>'
# List the range up front: a rev-list failure inside a process substitution
# would be ignored and the check would pass with nothing checked.
if ! SHAS="$(git -C "${REPO}" rev-list "${RANGE}")"; then
  echo "cannot list commits in ${RANGE} (bad range or not a git repo: ${REPO})" >&2
  exit 2
fi
bad=0
while IFS= read -r sha; do
  [[ -n "${sha}" ]] || continue
  subject="$(git -C "${REPO}" log -1 --format=%s "${sha}")"
  while IFS= read -r line; do
    line="${line%$'\r'}"
    if [[ "${line}" =~ ^[Cc]laude-[Ss]ession: ]]; then
      echo "${sha:0:7} ${subject}: forbidden trailer: ${line}"
      bad=1
    elif [[ "${line}" =~ ^[Cc]o-[Aa]uthored-[Bb]y: ]] \
      && [[ "$(printf '%s' "${line}" | tr '[:upper:]' '[:lower:]')" == *claude* || "${line}" == *anthropic* ]] \
      && [[ "${line}" != "${ALLOWED}" ]]; then
      echo "${sha:0:7} ${subject}: forbidden trailer: ${line} (only '${ALLOWED}' is allowed)"
      bad=1
    fi
  done < <(git -C "${REPO}" log -1 --format=%B "${sha}")
done <<< "${SHAS}"

if (( bad )); then
  echo "Reword the listed commits before merging. That rewrites the PR branch's history, so get the owner's go-ahead before force-pushing." >&2
  exit 1
fi
echo "OK: no forbidden trailers in ${RANGE}"

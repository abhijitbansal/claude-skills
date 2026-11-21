#!/usr/bin/env bash
# Draft release notes from Release-Note: lines in commit messages.
#
# Usage: release_notes.sh <version> [--mode testflight|appstore] [--allow-empty]
#
# - Range: the nearest v* tag to HEAD. In appstore mode TestFlight tags
#   (release.testflight_tag_format, default v{version}-b{build}) are skipped, so
#   the notes cover everything since the last App Store release.
# - Release-Note lines are read per commit from the full message with a
#   line-anchored match, merged with git's own parsed trailers. A Release-Note
#   line that sits in a different paragraph from Co-Authored-By is still found.
#   A quoted line ("> Release-Note: ...") is not.
# - stdout: the draft path (.scratch/release/release-notes-<version>.md).
#   stderr: "scanned N commits since <tag>, found M trailers".
# - Zero trailers stops with exit 4 so the notes get written by hand or on
#   purpose; --allow-empty writes the generic line instead.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USAGE="usage: release_notes.sh <version> [--mode testflight|appstore] [--allow-empty]"

VERSION="${1:-}"
[[ -n "${VERSION}" && "${VERSION}" != --* ]] || { echo "${USAGE}" >&2; exit 2; }
shift
MODE="testflight"
ALLOW_EMPTY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      [[ $# -ge 2 ]] || { echo "${USAGE}" >&2; exit 2; }
      MODE="$2"; shift ;;
    --allow-empty) ALLOW_EMPTY=1 ;;
    *) echo "unknown argument: $1" >&2; echo "${USAGE}" >&2; exit 2 ;;
  esac
  shift
done
case "${MODE}" in
  testflight|appstore) ;;
  *) echo "unknown mode: ${MODE}" >&2; echo "${USAGE}" >&2; exit 2 ;;
esac

# Config helpers only (no required app.yml keys): the tag format is optional.
export APP_CONFIG_HELPERS_ONLY=1
# shellcheck source=../../_lib/load_app_config.sh
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/../../_lib/load_app_config.sh"
# shellcheck disable=SC2034  # read by release_cfg in release_lib.sh
APP_YML="$(_find_app_yml || true)"
# shellcheck source=release_lib.sh
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/release_lib.sh"

describe_args=(--tags --match 'v*' --abbrev=0)
if [[ "${MODE}" == "appstore" ]]; then
  tf_glob="$(release_testflight_tag_glob)"
  describe_args+=(--exclude "${tf_glob}")
fi
last_tag="$(git describe "${describe_args[@]}" 2>/dev/null || true)"

if [[ -n "${last_tag}" ]]; then
  commits="$(git rev-list --no-merges "${last_tag}..HEAD")"
  since="since ${last_tag}"
else
  commits="$(git rev-list --no-merges --max-count=30 HEAD)"
  since="(no v* tag, last 30 commits)"
fi
scanned=0
raw=""
while IFS= read -r hash; do
  [[ -n "${hash}" ]] || continue
  scanned=$((scanned + 1))
  raw+="$(git log -1 --format='%(trailers:key=Release-Note,valueonly,unfold)' "${hash}")"$'\n'
  raw+="$(git log -1 --format='%B' "${hash}" | sed -n 's/^Release-Note:[[:space:]]*//p')"$'\n'
done <<< "${commits}"

lines="$(printf '%s\n' "${raw}" | sed -e 's/[[:space:]]*$//' -e '/^$/d' | awk '!seen[$0]++')"
found=0
[[ -z "${lines}" ]] || found="$(printf '%s\n' "${lines}" | wc -l | tr -d ' ')"
noun="trailers"
[[ "${found}" -ne 1 ]] || noun="trailer"
echo "scanned ${scanned} commits ${since}, found ${found} ${noun}" >&2

out="$(release_notes_path "${VERSION}")"
if [[ "${found}" -eq 0 ]]; then
  if [[ ${ALLOW_EMPTY} -ne 1 ]]; then
    echo "no Release-Note lines in the range. Ask the user for the release notes and write them to ${out}, or rerun with --allow-empty to use the generic line." >&2
    exit 4
  fi
  printf '%s\n' "- Bug fixes and improvements." > "${out}"
else
  printf '%s\n' "${lines}" | sed 's/^/- /' > "${out}"
fi
echo "${out}"

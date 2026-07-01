#!/usr/bin/env bash
# Draft release notes from Release-Note: commit trailers since the last v* tag
# (same trailer contract as floorprint/doc-scan's release-notes-collect.sh).
# Falls back to a generic line when no trailers exist in the range.
#
# Usage: release_notes.sh <version>   → prints build/release-notes-<version>.md
set -euo pipefail

VERSION="${1:?usage: release_notes.sh <version>}"
mkdir -p build
out="build/release-notes-${VERSION}.md"

last_tag="$(git describe --tags --match 'v*' --abbrev=0 2>/dev/null || true)"
if [[ -n "${last_tag}" ]]; then
  range="${last_tag}..HEAD"
  notes="$(git log "${range}" --no-merges --format='%(trailers:key=Release-Note,valueonly)')"
else
  notes="$(git log --max-count=30 --no-merges --format='%(trailers:key=Release-Note,valueonly)')"
fi
notes="$(printf '%s\n' "${notes}" | sed '/^[[:space:]]*$/d' | sed 's/^/- /')"

if [[ -z "${notes}" ]]; then
  notes="- Bug fixes and improvements."
fi
printf '%s\n' "${notes}" > "${out}"
echo "${out}"

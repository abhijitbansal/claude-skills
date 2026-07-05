#!/usr/bin/env bash
# Turn an issue title into a branch-safe slug: lowercase, hyphen-separated,
# alphanumeric only, capped at 50 chars. Falls back to "issue" if the title
# has no alphanumeric characters at all.
#
# Usage: make-slug.sh "Fix login crash on iPad"  ->  fix-login-crash-on-ipad

set -euo pipefail

title="${1:?usage: make-slug.sh <title>}"

slug="$(printf '%s' "${title}" \
  | tr '[:upper:]' '[:lower:]' \
  | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')"

slug="${slug:0:50}"
slug="${slug%-}"

printf '%s\n' "${slug:-issue}"

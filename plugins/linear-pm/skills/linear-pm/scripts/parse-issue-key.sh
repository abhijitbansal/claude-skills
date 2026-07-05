#!/usr/bin/env bash
# Extract a Linear issue key (e.g. ABH-123) from a branch name. Prints the
# first match, or nothing if the branch has no team-prefixed key. Always
# exits 0 — callers check for an empty result, not a non-zero exit.
#
# Usage: parse-issue-key.sh "agent/ABH-123-fix-login-crash"  ->  ABH-123

set -uo pipefail

branch="${1:-}"

printf '%s' "${branch}" | grep -Eo '[A-Z]+-[0-9]+' | head -1 || true

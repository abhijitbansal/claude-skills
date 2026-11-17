#!/usr/bin/env bash
# Extract a Linear issue key (e.g. ENG-123) from a branch name. Prints the
# first match, or nothing if the branch has no key. Always exits 0 — callers
# check for an empty result, not a non-zero exit.
#
# Team-aware: with a team key (2nd argument, else $LINEAR_PM_TEAM) it matches
# only that team's key, case-insensitively and on word boundaries, and prints
# it upper-cased, so `user/eng-123-title` gives ENG-123 while `fix/UTF-8-bug`
# gives nothing. Without a team it keeps the old behaviour: any UPPERCASE
# `[A-Z]+-[0-9]+` token.
#
# Usage: parse-issue-key.sh "agent/ENG-123-fix-login-crash" [ENG]  ->  ENG-123

set -uo pipefail

branch="${1:-}"
team="${2:-${LINEAR_PM_TEAM:-}}"

# A team key is letters and digits only; anything else is not used as a pattern.
if [[ ! "${team}" =~ ^[A-Za-z][A-Za-z0-9]*$ ]]; then
  team=""
fi

if [[ -n "${team}" ]]; then
  match="$(printf '%s' "${branch}" | grep -Eio "(^|[^[:alnum:]])${team}-[0-9]+" | head -1 || true)"
  [[ -n "${match}" ]] || exit 0
  printf '%s\n' "${match}" | sed -E 's/^[^[:alnum:]]//' | tr '[:lower:]' '[:upper:]'
  exit 0
fi

printf '%s' "${branch}" | grep -Eo '[A-Z]+-[0-9]+' | head -1 || true

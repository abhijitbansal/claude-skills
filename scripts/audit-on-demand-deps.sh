#!/usr/bin/env bash
# Audit the packages a skill installs on demand: every <skill>/optional/<name>/ folder with a package-lock.json
# (make-motion's voice and cutout stacks, installed with `npm ci --prefix <skill>/optional/<name>`).
#
# They are not in the skill's own package-lock.json, so `npm audit` in the skill folder cannot see them. Each folder is a
# package of its own, with its own "overrides", so `npm audit --package-lock-only` there audits exactly the tree a user
# installs, and the pins in the lockfile are the versions users get.
#
# Usage: scripts/audit-on-demand-deps.sh [skill-dir]   (default: make-motion)
# Exit 0 clean (no moderate-or-worse advisory); 1 vulnerabilities; 2 bad usage or no optional lockfile found.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
skill="${1:-$root/plugins/portable-artifacts/skills/make-motion}"

if [[ $# -gt 1 || ! -d "$skill/optional" ]]; then
  echo "usage: $0 [skill-dir]  (needs <skill-dir>/optional/<name>/package-lock.json)" >&2
  exit 2
fi

status=0
found=0
for dir in "$skill"/optional/*/; do
  [[ -f "${dir}package-lock.json" ]] || continue
  found=1
  echo "auditing ${dir}"
  npm --prefix "$dir" audit --package-lock-only --audit-level=moderate || status=1
done

if [[ "$found" -eq 0 ]]; then
  echo "no optional/<name>/package-lock.json under $skill" >&2
  exit 2
fi
exit "$status"

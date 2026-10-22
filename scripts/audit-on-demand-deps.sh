#!/usr/bin/env bash
# Audit the dependencies a skill installs on demand (`npm install <pin> --no-save`).
#
# Those packages are never in the skill's package-lock.json, so `npm audit` in the skill folder
# reports 0 vulnerabilities even with them installed, and Dependabot and the lockfile never see
# them. This resolves the on-demand install into a throwaway copy of package.json + the lockfile
# (so the skill's "overrides" apply exactly as they do for a user) and audits that tree.
#
# Usage: scripts/audit-on-demand-deps.sh [skill-dir]   (default: make-motion)
# Exit 0 clean (no moderate-or-worse advisory); 1 vulnerabilities; 2 bad usage.
# Add a skill's other on-demand installs here as they appear (today: make-motion's kokoro-js).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
skill="${1:-$root/plugins/portable-artifacts/skills/make-motion}"

if [[ $# -gt 1 || ! -f "$skill/package.json" || ! -f "$skill/package-lock.json" || ! -f "$skill/shared/doctor.mjs" ]]; then
  echo "usage: $0 [skill-dir]  (needs package.json, package-lock.json and shared/doctor.mjs)" >&2
  exit 2
fi

# The doctor owns the pin, so this audits the version users are told to install.
pin="$(cd "$skill" && node --input-type=module -e "import('./shared/doctor.mjs').then((m) => console.log(m.KOKORO_PIN))")"
if [[ -z "$pin" ]]; then
  echo "could not read KOKORO_PIN from $skill/shared/doctor.mjs" >&2
  exit 2
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cp "$skill/package.json" "$skill/package-lock.json" "$work/"

cd "$work"
echo "auditing $pin as installed into $(basename "$skill") (overrides: $(node -p "JSON.stringify(require('./package.json').overrides ?? {})"))"
npm install "$pin" --package-lock-only --ignore-scripts --no-fund --no-audit >/dev/null
npm audit --audit-level=moderate

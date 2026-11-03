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
# Add a skill's other on-demand installs here as they appear (today: make-motion's kokoro-js and onnxruntime-node).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
skill="${1:-$root/plugins/portable-artifacts/skills/make-motion}"

if [[ $# -gt 1 || ! -f "$skill/package.json" || ! -f "$skill/package-lock.json" || ! -f "$skill/shared/doctor.mjs" ]]; then
  echo "usage: $0 [skill-dir]  (needs package.json, package-lock.json and shared/doctor.mjs)" >&2
  exit 2
fi

# The doctor owns the pins, so this audits the versions users are told to install: one pass per pin (each is its own
# `npm install <pin> --no-save`, and npm drops the other when you run the second).
pins="$(cd "$skill" && node --input-type=module -e "import('./shared/doctor.mjs').then((m) => console.log([m.KOKORO_PIN, m.CUTOUT_PIN].join(' ')))")"
read -r kokoro_pin cutout_pin <<<"$pins"
if [[ -z "${kokoro_pin:-}" || -z "${cutout_pin:-}" ]]; then
  echo "could not read KOKORO_PIN and CUTOUT_PIN from $skill/shared/doctor.mjs" >&2
  exit 2
fi

work=""
trap 'rm -rf "$work"' EXIT

# Resolves `pin` into a throwaway copy of package.json + the lockfile and audits that tree. 0 clean, else the failing status.
# The steps are one && chain: inside `|| rc=$?` `set -e` is off, so a failed install must stop the chain itself.
audit_pin() {
  local pin="$1" rc=0
  work="$(mktemp -d)"
  cp "$skill/package.json" "$skill/package-lock.json" "$work/"
  echo "auditing $pin as installed into $(basename "$skill") (overrides: $(cd "$work" && node -p "JSON.stringify(require('./package.json').overrides ?? {})"))"
  (cd "$work" && npm install "$pin" --package-lock-only --ignore-scripts --no-fund --no-audit >/dev/null && npm audit --audit-level=moderate) || rc=$?
  rm -rf "$work"
  return "$rc"
}

status=0
for pin in "$kokoro_pin" "$cutout_pin"; do
  audit_pin "$pin" || status=1
done
exit "$status"

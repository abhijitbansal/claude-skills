#!/usr/bin/env bash
# Bump MARKETING_VERSION / CURRENT_PROJECT_VERSION in project.yml — the only
# place versions live (never agvtool, never the pbxproj).
set -euo pipefail

KIND="${1:-}"
case "${KIND}" in
  major|minor|patch|build) ;;
  *) echo "usage: bump_version.sh {major|minor|patch|build}" >&2; exit 2 ;;
esac
[[ -f project.yml ]] || { echo "no project.yml here — version bumps happen in project.yml only" >&2; exit 1; }

mv_line="$(grep -E '^[[:space:]]*MARKETING_VERSION:' project.yml | head -1)"
b_line="$(grep -E '^[[:space:]]*CURRENT_PROJECT_VERSION:' project.yml | head -1)"
[[ -n "${mv_line}" && -n "${b_line}" ]] || {
  echo "MARKETING_VERSION/CURRENT_PROJECT_VERSION not found in project.yml" >&2; exit 1; }

mv="$(echo "${mv_line}" | sed -E 's/.*MARKETING_VERSION:[[:space:]]*"?([0-9.]+)"?.*/\1/')"
build="$(echo "${b_line}" | sed -E 's/.*CURRENT_PROJECT_VERSION:[[:space:]]*"?([0-9]+)"?.*/\1/')"
IFS=. read -r maj min pat <<EOF
${mv}
EOF
min="${min:-0}"
pat="${pat:-0}"

case "${KIND}" in
  major) maj=$((maj + 1)); min=0; pat=0 ;;
  minor) min=$((min + 1)); pat=0 ;;
  patch) pat=$((pat + 1)) ;;
  build) ;;
esac
new_mv="${maj}.${min}.${pat}"
new_build=$((build + 1))

sed -i.bak -E "s/(MARKETING_VERSION:[[:space:]]*\"?)[0-9.]+(\"?)/\1${new_mv}\2/" project.yml
sed -i.bak -E "s/(CURRENT_PROJECT_VERSION:[[:space:]]*\"?)[0-9]+(\"?)/\1${new_build}\2/" project.yml
rm -f project.yml.bak
echo "version=${new_mv} build=${new_build}"

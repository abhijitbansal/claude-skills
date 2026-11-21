#!/usr/bin/env bash
# Bump MARKETING_VERSION / CURRENT_PROJECT_VERSION in project.yml — the only
# place versions live (never agvtool, never the pbxproj).
set -euo pipefail

# --print: show what the bump would produce without writing project.yml (Stage 1
# needs the planned version for preflight's --next-version before Stage 2 bumps).
USAGE="usage: bump_version.sh [--print] {major|minor|patch|build}"
PRINT_ONLY=0
KIND=""
# Parse every argument: --print in any position, exactly one kind, nothing else.
for arg in "$@"; do
  case "${arg}" in
    --print) PRINT_ONLY=1 ;;
    major|minor|patch|build)
      [[ -z "${KIND}" ]] || { echo "unexpected extra argument '${arg}'. ${USAGE}" >&2; exit 2; }
      KIND="${arg}" ;;
    *) echo "unknown argument '${arg}'. ${USAGE}" >&2; exit 2 ;;
  esac
done
[[ -n "${KIND}" ]] || { echo "${USAGE}" >&2; exit 2; }
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

if [[ ${PRINT_ONLY} -eq 1 ]]; then
  echo "version=${new_mv} build=${new_build}"
  exit 0
fi

sed -i.bak -E "s/(MARKETING_VERSION:[[:space:]]*\"?)[0-9.]+(\"?)/\1${new_mv}\2/" project.yml
sed -i.bak -E "s/(CURRENT_PROJECT_VERSION:[[:space:]]*\"?)[0-9]+(\"?)/\1${new_build}\2/" project.yml
rm -f project.yml.bak
echo "version=${new_mv} build=${new_build}"

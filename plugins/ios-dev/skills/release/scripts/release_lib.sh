#!/usr/bin/env bash
# Shared helpers for release.sh and release_notes.sh. Source it; do not execute.
# Needs _yaml_get (from load_app_config.sh). APP_YML may be unset: defaults apply.
#
# Tag naming: appstore tags are v<version>. TestFlight tags follow
# release.testflight_tag_format in .claude/app.yml, default v{version}-b{build}
# ({version} and {build} are the only placeholders).

RELEASE_DEFAULT_TESTFLIGHT_TAG_FORMAT='v{version}-b{build}'

release_cfg() {  # $1 = dotted app.yml key; prints nothing when unset
  [[ -n "${APP_YML:-}" ]] || return 0
  _yaml_get "${APP_YML}" "$1" 2>/dev/null || true
}

release_testflight_tag_format() {
  local fmt
  fmt="$(release_cfg release.testflight_tag_format)"
  fmt="${fmt:-${RELEASE_DEFAULT_TESTFLIGHT_TAG_FORMAT}}"
  if [[ ! "${fmt}" =~ ^[A-Za-z0-9._{}-]+$ || "${fmt}" != *"{version}"* || "${fmt}" != *"{build}"* ]]; then
    echo "release.testflight_tag_format '${fmt}' must contain {version} and {build} and use only letters, digits, . _ -" >&2
    return 2
  fi
  printf '%s\n' "${fmt}"
}

release_tag_name() {  # $1 = testflight|appstore, $2 = marketing version, $3 = build number
  local fmt
  case "$1" in
    appstore) printf 'v%s\n' "$2" ;;
    testflight)
      fmt="$(release_testflight_tag_format)" || return $?
      fmt="${fmt//\{version\}/$2}"
      fmt="${fmt//\{build\}/$3}"
      printf '%s\n' "${fmt}"
      ;;
    *) echo "release_tag_name: unknown mode '$1'" >&2; return 2 ;;
  esac
}

release_testflight_tag_glob() {  # the TestFlight format as a glob, e.g. v*-b*
  local fmt
  fmt="$(release_testflight_tag_format)" || return $?
  fmt="${fmt//\{version\}/*}"
  fmt="${fmt//\{build\}/*}"
  printf '%s\n' "${fmt}"
}

# Draft notes and the paste pack live in <repo>/.scratch/release: outside build/
# (a cold build deletes build/) and never in `git status` (the dir is added to
# the local .git/info/exclude, which is not a tracked file).
release_scratch_dir() {
  local dir=".scratch/release" excl
  mkdir -p "${dir}"
  if git rev-parse --git-dir >/dev/null 2>&1 && ! git check-ignore -q "${dir}/x" 2>/dev/null; then
    excl="$(git rev-parse --git-path info/exclude)"
    mkdir -p "$(dirname "${excl}")"
    printf '.scratch/\n' >> "${excl}"
  fi
  printf '%s\n' "${dir}"
}

release_notes_path() {  # $1 = marketing version
  printf '%s/release-notes-%s.md\n' "$(release_scratch_dir)" "$1"
}

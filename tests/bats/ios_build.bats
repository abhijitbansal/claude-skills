#!/usr/bin/env bats

load helpers

setup() {
  TMP="$(mktemp -d)"
  export HOME="${TMP}/home"
  mkdir -p "${HOME}"
  BUILD="${BATS_TEST_DIRNAME}/../../plugins/ios-dev/skills/ios-build/scripts/build.sh"
  export XLOG="${TMP}/xlog"
  : > "${XLOG}"
  mkdir -p "${TMP}/stubs"
  printf '#!/bin/sh\necho "xcodebuild $*" >> "${XLOG}"\nexit 0\n' > "${TMP}/stubs/xcodebuild"
  chmod +x "${TMP}/stubs/xcodebuild"
  export PATH="${TMP}/stubs:${PATH}"
}

teardown() { rm -rf "${TMP}"; }

@test "ios-build build.sh refuses without .claude/app.yml" {
  cd "${TMP}"
  run bash "${BUILD}" sim
  [ "$status" -ne 0 ]
  [[ "$output" == *"app.yml"* ]]
}

# --- CAT-48: no dead hard-coded simulator name --------------------------------

@test "fallback sim build uses the generic simulator destination, not a named device" {
  make_fixture_app "${TMP}/app"
  cd "${TMP}/app"
  run bash "${BUILD}" sim
  [ "$status" -eq 0 ]
  grep -q 'destination generic/platform=iOS Simulator' "${XLOG}"
  [ -z "$(grep -e 'name=iPhone' "${XLOG}" || true)" ]
}

@test "bad target exits 2 with usage and does not build" {
  make_fixture_app "${TMP}/app"
  cd "${TMP}/app"
  run bash "${BUILD}" simulator
  [ "$status" -eq 2 ]
  [[ "$output" == *"usage: build.sh {sim|device}"* ]] || false
  [ -z "$(cat "${XLOG}")" ]
}

# --- CAT-52: repo root, and no silent death on an optional key -----------------

@test "runs the app's build script from the repo root even when invoked from a subdirectory" {
  make_fixture_app "${TMP}/app"
  printf '#!/bin/sh\necho "app-build in $(pwd -P) args: $*" >> "${XLOG}"\n' > "${TMP}/app/build.sh"
  chmod +x "${TMP}/app/build.sh"
  mkdir -p "${TMP}/app/Sources/Deep"
  cd "${TMP}/app/Sources/Deep"
  run bash "${BUILD}" device
  [ "$status" -eq 0 ]
  grep -q "app-build in $(cd "${TMP}/app" && pwd -P) args: -d" "${XLOG}"
}

@test "app.yml without the optional url_scheme still builds" {
  make_fixture_app "${TMP}/app"
  grep -v 'url_scheme' "${TMP}/app/.claude/app.yml" > "${TMP}/app.yml.new"
  cp "${TMP}/app.yml.new" "${TMP}/app/.claude/app.yml"
  cd "${TMP}/app"
  run bash "${BUILD}" sim
  [ "$status" -eq 0 ]
  grep -q '^xcodebuild' "${XLOG}"
}

@test "app.yml missing a required key fails naming the key, not silently" {
  make_fixture_app "${TMP}/app"
  grep -v 'scheme: Demo' "${TMP}/app/.claude/app.yml" > "${TMP}/app.yml.new"
  cp "${TMP}/app.yml.new" "${TMP}/app/.claude/app.yml"
  cd "${TMP}/app"
  run bash "${BUILD}" sim
  [ "$status" -ne 0 ]
  [[ "$output" == *"app.scheme"* ]] || false
  [ -z "$(cat "${XLOG}")" ]
}

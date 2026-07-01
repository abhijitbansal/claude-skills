#!/usr/bin/env bats

load helpers

setup() {
  TMP="$(mktemp -d)"
  BUMP="${BATS_TEST_DIRNAME}/../../plugins/ios-dev/skills/release/scripts/bump_version.sh"
  make_fixture_app "${TMP}/app"
}
teardown() { rm -rf "${TMP}"; }

@test "patch bumps 1.2.0 -> 1.2.1, build 34 -> 35, exact output line" {
  cd "${TMP}/app"
  run bash "${BUMP}" patch
  [ "$status" -eq 0 ]
  [ "$output" = "version=1.2.1 build=35" ]
  grep -q 'MARKETING_VERSION: "1.2.1"' project.yml
  grep -q 'CURRENT_PROJECT_VERSION: "35"' project.yml
}

@test "minor bumps 1.2.0 -> 1.3.0" {
  cd "${TMP}/app"
  run bash "${BUMP}" minor
  [ "$output" = "version=1.3.0 build=35" ]
}

@test "major bumps 1.2.0 -> 2.0.0" {
  cd "${TMP}/app"
  run bash "${BUMP}" major
  [ "$output" = "version=2.0.0 build=35" ]
}

@test "build keeps version, bumps build only" {
  cd "${TMP}/app"
  run bash "${BUMP}" build
  [ "$output" = "version=1.2.0 build=35" ]
  grep -q 'MARKETING_VERSION: "1.2.0"' project.yml
}

@test "missing project.yml fails mentioning project.yml" {
  cd "${TMP}"
  run bash "${BUMP}" patch
  [ "$status" -eq 1 ]
  [[ "$output" == *"project.yml"* ]]
}

@test "unknown kind exits 2" {
  cd "${TMP}/app"
  run bash "${BUMP}" banana
  [ "$status" -eq 2 ]
}

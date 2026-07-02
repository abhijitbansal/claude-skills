#!/usr/bin/env bats

load helpers

setup() {
  TMP="$(mktemp -d)"
}

teardown() { rm -rf "${TMP}"; }

@test "release.sh refuses without .claude/app.yml" {
  cd "${TMP}"  # tmp dir with no .claude/app.yml — use whatever setup is available
  run bash "${BATS_TEST_DIRNAME}/../../plugins/ios-dev/skills/release/scripts/release.sh" testflight
  [ "$status" -ne 0 ]
  [[ "$output" == *"app.yml"* ]]
}

@test "release.sh rejects unknown mode with usage" {
  make_fixture_app "${TMP}/app"
  cd "${TMP}/app"
  run bash "${BATS_TEST_DIRNAME}/../../plugins/ios-dev/skills/release/scripts/release.sh" banana
  [ "$status" -eq 2 ]
  [[ "$output" == *"usage:"* ]]
}

@test "release.sh stops at preflight FAIL on dirty tree" {
  make_fixture_app "${TMP}/app"
  cd "${TMP}/app"
  touch dirty.txt
  export PREFLIGHT_SKIP_TOOLCHAIN=1
  export PREFLIGHT_PLIST="${TMP}/app/build/gen/Demo-Info.plist"
  export PREFLIGHT_ENTITLEMENTS_DIR="${TMP}/app/build/gen"
  run bash "${BATS_TEST_DIRNAME}/../../plugins/ios-dev/skills/release/scripts/release.sh" testflight --dry-run
  [ "$status" -ne 0 ]
  [[ "$output" == *"FAIL: tree-clean"* ]]
}

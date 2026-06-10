#!/usr/bin/env bats

load helpers

setup() {
  TMP="$(mktemp -d)"
}

teardown() { rm -rf "${TMP}"; }

@test "ios-build build.sh refuses without .claude/app.yml" {
  cd "${TMP}"
  run bash "${BATS_TEST_DIRNAME}/../../plugins/ios-dev/skills/ios-build/scripts/build.sh" sim
  [ "$status" -ne 0 ]
  [[ "$output" == *"app.yml"* ]]
}

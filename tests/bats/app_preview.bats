#!/usr/bin/env bats

load helpers

setup() {
  TMP="$(mktemp -d)"
}

teardown() { rm -rf "${TMP}"; }

@test "app-preview launch.sh refuses without .claude/app.yml" {
  cd "${TMP}"
  run bash "${BATS_TEST_DIRNAME}/../../skills/app-preview/scripts/launch.sh"
  [ "$status" -ne 0 ]
  [[ "$output" == *"app.yml"* ]]
}

@test "app-preview snap.sh refuses without .claude/app.yml" {
  cd "${TMP}"
  run bash "${BATS_TEST_DIRNAME}/../../skills/app-preview/scripts/snap.sh"
  [ "$status" -ne 0 ]
  [[ "$output" == *"app.yml"* ]]
}

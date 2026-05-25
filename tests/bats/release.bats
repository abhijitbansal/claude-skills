#!/usr/bin/env bats

load helpers

setup() {
  TMP="$(mktemp -d)"
}

teardown() { rm -rf "${TMP}"; }

@test "release.sh refuses without .claude/app.yml" {
  cd "${TMP}"  # tmp dir with no .claude/app.yml — use whatever setup is available
  run bash "${BATS_TEST_DIRNAME}/../../skills/release/scripts/release.sh" testflight
  [ "$status" -ne 0 ]
  [[ "$output" == *"app.yml"* ]]
}

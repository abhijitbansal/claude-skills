#!/usr/bin/env bats

load helpers

setup() {
  TMP="$(mktemp -d)"
  export HOME="${TMP}/home"
  mkdir -p "${HOME}/.local/bin"
  export CLAUDE_SKILLS_HOME="${BATS_TEST_DIRNAME}/../.."
}

teardown() { rm -rf "${TMP}"; }

@test "setup.sh --dry-run preflight succeeds" {
  run bash "${CLAUDE_SKILLS_HOME}/setup/setup.sh" --dry-run --only preflight
  [ "$status" -eq 0 ]
  [[ "$output" == *"preflight"* ]]
}

@test "setup.sh --only=bogus errors" {
  run bash "${CLAUDE_SKILLS_HOME}/setup/setup.sh" --only bogus
  [ "$status" -ne 0 ]
}

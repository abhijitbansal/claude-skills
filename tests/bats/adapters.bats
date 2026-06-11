#!/usr/bin/env bats

load helpers

setup() {
  TMP="$(mktemp -d)"
  export HOME="${TMP}/home"
  mkdir -p "${HOME}"
  export CLAUDE_SKILLS_HOME="${BATS_TEST_DIRNAME}/../.."
  INSTALL="${CLAUDE_SKILLS_HOME}/adapters/install.sh"
}

teardown() { rm -rf "${TMP}"; }

@test "codex mode refuses when ~/.codex does not exist" {
  run bash "${INSTALL}" codex
  [ "$status" -eq 0 ]
  [[ "$output" == *"no ~/.codex"* ]]
  [ ! -d "${HOME}/.codex/skills" ]
}

@test "codex mode symlinks every plugin skill" {
  mkdir -p "${HOME}/.codex"
  run bash "${INSTALL}" codex
  [ "$status" -eq 0 ]
  [ -L "${HOME}/.codex/skills/commit" ]
  [ -L "${HOME}/.codex/skills/linear-pm" ]
  [ -L "${HOME}/.codex/skills/second-wind" ]
  [ ! -e "${HOME}/.codex/skills/_lib" ]
}

@test "codex mode is idempotent and prunes stale links" {
  mkdir -p "${HOME}/.codex/skills"
  ln -s "$(cd "${CLAUDE_SKILLS_HOME}" && pwd)/plugins/gone/skills/gone" "${HOME}/.codex/skills/gone"
  ln -s "/elsewhere/foreign" "${HOME}/.codex/skills/foreign"
  run bash "${INSTALL}" codex
  [ "$status" -eq 0 ]
  run bash "${INSTALL}" codex
  [ "$status" -eq 0 ]
  [ ! -L "${HOME}/.codex/skills/gone" ]      # stale repo link pruned
  [ -L "${HOME}/.codex/skills/foreign" ]     # foreign link untouched
}

@test "copilot mode honors COPILOT_SKILLS_DIR override" {
  export COPILOT_SKILLS_DIR="${TMP}/custom-skills"
  mkdir -p "${COPILOT_SKILLS_DIR}"
  run bash "${INSTALL}" copilot
  [ "$status" -eq 0 ]
  [ -L "${COPILOT_SKILLS_DIR}/commit" ]
}

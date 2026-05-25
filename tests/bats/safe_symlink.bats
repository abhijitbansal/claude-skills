#!/usr/bin/env bats

load helpers

setup() {
  TMP="$(mktemp -d)"
  export CLAUDE_SKILLS_HOME="${TMP}/repo"
  mkdir -p "${CLAUDE_SKILLS_HOME}/skills/example"
  mkdir -p "${TMP}/home/.claude/skills"
  export HOME="${TMP}/home"
  # shellcheck source=/dev/null
  source "${BATS_TEST_DIRNAME}/../../setup/_lib.sh"
}

teardown() { rm -rf "${TMP}"; }

@test "safe_symlink creates symlink when target absent" {
  run safe_symlink "${CLAUDE_SKILLS_HOME}/skills/example" "${HOME}/.claude/skills/example"
  [ "$status" -eq 0 ]
  [ -L "${HOME}/.claude/skills/example" ]
  [ "$(readlink "${HOME}/.claude/skills/example")" = "${CLAUDE_SKILLS_HOME}/skills/example" ]
}

@test "safe_symlink is idempotent when correct symlink exists" {
  ln -s "${CLAUDE_SKILLS_HOME}/skills/example" "${HOME}/.claude/skills/example"
  run safe_symlink "${CLAUDE_SKILLS_HOME}/skills/example" "${HOME}/.claude/skills/example"
  [ "$status" -eq 0 ]
  [[ "$output" == *"already correct"* ]]
}

@test "safe_symlink warns and skips when target is a foreign symlink" {
  ln -s "/some/other/path" "${HOME}/.claude/skills/example"
  run safe_symlink "${CLAUDE_SKILLS_HOME}/skills/example" "${HOME}/.claude/skills/example"
  [ "$status" -eq 0 ]
  [[ "$output" == *"foreign symlink"* ]]
  [ "$(readlink "${HOME}/.claude/skills/example")" = "/some/other/path" ]
}

@test "safe_symlink errors when target is a regular file" {
  echo "real file" > "${HOME}/.claude/skills/example"
  run safe_symlink "${CLAUDE_SKILLS_HOME}/skills/example" "${HOME}/.claude/skills/example"
  [ "$status" -ne 0 ]
  [[ "$output" == *"regular file"* ]]
}

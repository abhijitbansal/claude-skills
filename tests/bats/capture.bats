#!/usr/bin/env bats

load helpers

setup() {
  TMP="$(mktemp -d)"
  export HOME="${TMP}/home"
  mkdir -p "${HOME}/.claude/plugins" "${HOME}/.agents"
  cp "${BATS_TEST_DIRNAME}/../fixtures/live-state/known_marketplaces.json" "${HOME}/.claude/plugins/"
  cp "${BATS_TEST_DIRNAME}/../fixtures/live-state/installed_plugins.json"  "${HOME}/.claude/plugins/"
  cp "${BATS_TEST_DIRNAME}/../fixtures/live-state/skill-lock.json"         "${HOME}/.agents/.skill-lock.json"
  cp "${BATS_TEST_DIRNAME}/../fixtures/live-state/CLAUDE.md"               "${HOME}/CLAUDE.md"
  cp "${BATS_TEST_DIRNAME}/../fixtures/live-state/settings.json"           "${HOME}/.claude/settings.json"
  export CLAUDE_SKILLS_HOME="${TMP}/repo"
  mkdir -p "${CLAUDE_SKILLS_HOME}/templates"
  cat >"${CLAUDE_SKILLS_HOME}/claude-setup.toml" <<EOF
[meta]
schema_version = 1
EOF
}

teardown() { rm -rf "${TMP}"; }

@test "capture.sh produces TOML matching expected fixture" {
  run bash "${BATS_TEST_DIRNAME}/../../setup/capture.sh"
  [ "$status" -eq 0 ]
  # The expected file is generated once and tracked; this test compares.
  diff -u "${BATS_TEST_DIRNAME}/../fixtures/expected/claude-setup.toml" "${CLAUDE_SKILLS_HOME}/claude-setup.toml"
}

@test "capture.sh copies dotfiles" {
  bash "${BATS_TEST_DIRNAME}/../../setup/capture.sh"
  [ -f "${CLAUDE_SKILLS_HOME}/templates/home-CLAUDE.md" ]
  [ -f "${CLAUDE_SKILLS_HOME}/templates/user-settings.json" ]
}

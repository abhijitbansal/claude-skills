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

@test "setup.sh --only marketplaces adds + updates" {
  cp "${CLAUDE_SKILLS_HOME}/claude-setup.toml" "${TMP}/copy.toml"
  CLAUDE_SETUP_TOML="${TMP}/copy.toml" run bash "${CLAUDE_SKILLS_HOME}/setup/setup.sh" --only marketplaces
  [ "$status" -eq 0 ]
  grep -q "claude plugin marketplace" "${MOCK_CALL_LOG}"
}

@test "setup.sh --only plugins installs every plugin in toml" {
  CLAUDE_SETUP_TOML="${CLAUDE_SKILLS_HOME}/claude-setup.toml" \
    run bash "${CLAUDE_SKILLS_HOME}/setup/setup.sh" --only plugins
  [ "$status" -eq 0 ]
  grep -c "claude plugin install" "${MOCK_CALL_LOG}" >/dev/null
}

@test "setup.sh plugins step honors pin if present" {
  cat >"${TMP}/pinned.toml" <<EOF
[meta]
schema_version = 1
[[plugins]]
name = "p"
marketplace = "m"
pin = "v1.2"
EOF
  CLAUDE_SETUP_TOML="${TMP}/pinned.toml" run bash "${CLAUDE_SKILLS_HOME}/setup/setup.sh" --only plugins
  [ "$status" -eq 0 ]
  grep -q "v1.2" "${MOCK_CALL_LOG}"
}

@test "setup.sh --only skills runs npx skills add per entry" {
  CLAUDE_SETUP_TOML="${CLAUDE_SKILLS_HOME}/claude-setup.toml" \
    run bash "${CLAUDE_SKILLS_HOME}/setup/setup.sh" --only skills
  [ "$status" -eq 0 ]
  grep -q "npx -y skills add" "${MOCK_CALL_LOG}"
}

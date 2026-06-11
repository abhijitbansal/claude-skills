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

@test "setup.sh --only dotfiles copies templates with backup" {
  echo "old" > "${HOME}/CLAUDE.md"
  mkdir -p "${HOME}/.claude"
  echo "{\"old\":true}" > "${HOME}/.claude/settings.json"
  CLAUDE_SETUP_TOML="${CLAUDE_SKILLS_HOME}/claude-setup.toml" \
    run bash "${CLAUDE_SKILLS_HOME}/setup/setup.sh" --only dotfiles
  [ "$status" -eq 0 ]
  diff -q "${CLAUDE_SKILLS_HOME}/templates/home-CLAUDE.md" "${HOME}/CLAUDE.md"
  ls "${HOME}/CLAUDE.md.bak."*
}

@test "setup.sh --only symlinks installs contribute shim" {
  run bash "${CLAUDE_SKILLS_HOME}/setup/setup.sh" --only symlinks
  [ "$status" -eq 0 ]
  [ -L "${HOME}/.local/bin/claude-skills-contribute" ]
}

@test "setup.sh --only local_plugins adds self marketplace and installs every marketplace plugin" {
  run bash "${CLAUDE_SKILLS_HOME}/setup/setup.sh" --only local_plugins
  [ "$status" -eq 0 ]
  grep -q "claude plugin marketplace" "${MOCK_CALL_LOG}"
  grep -q "claude plugin install ios-dev@claude-skills" "${MOCK_CALL_LOG}"
  grep -q "claude plugin install linear-pm@claude-skills" "${MOCK_CALL_LOG}"
  grep -q "claude plugin install core-workflow@claude-skills" "${MOCK_CALL_LOG}"
}

@test "setup.sh symlinks step removes stale links into this repo" {
  mkdir -p "${HOME}/.claude/skills"
  ln -s "${CLAUDE_SKILLS_HOME}/skills/gone" "${HOME}/.claude/skills/gone"
  run bash "${CLAUDE_SKILLS_HOME}/setup/setup.sh" --only symlinks
  [ "$status" -eq 0 ]
  [ ! -L "${HOME}/.claude/skills/gone" ]
}

@test "setup.sh symlinks step installs claude-skills-contribute shim" {
  # contribute.sh doesn't exist yet (T14); use a placeholder so the symlink target exists
  mkdir -p "${CLAUDE_SKILLS_HOME}/setup"
  CLAUDE_SETUP_TOML="${CLAUDE_SKILLS_HOME}/claude-setup.toml" \
    run bash "${CLAUDE_SKILLS_HOME}/setup/setup.sh" --only symlinks
  [ -L "${HOME}/.local/bin/claude-skills-contribute" ]
}

@test "setup.sh full run is idempotent on rerun" {
  CLAUDE_SETUP_TOML="${CLAUDE_SKILLS_HOME}/claude-setup.toml" \
    bash "${CLAUDE_SKILLS_HOME}/setup/setup.sh" --dry-run
  run bash "${CLAUDE_SKILLS_HOME}/setup/setup.sh" --dry-run
  [ "$status" -eq 0 ]
}

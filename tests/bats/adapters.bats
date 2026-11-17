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
  [ ! -d "${HOME}/.agents/skills" ]
}

@test "codex mode symlinks every plugin skill" {
  mkdir -p "${HOME}/.codex"
  run bash "${INSTALL}" codex
  [ "$status" -eq 0 ]
  [ -L "${HOME}/.agents/skills/commit" ]
  [ -L "${HOME}/.agents/skills/linear-pm" ]
  [ -L "${HOME}/.agents/skills/second-wind" ]
  [ ! -e "${HOME}/.agents/skills/_lib" ]
}

@test "codex mode is idempotent and prunes stale links" {
  mkdir -p "${HOME}/.codex" "${HOME}/.agents/skills"
  ln -s "$(cd "${CLAUDE_SKILLS_HOME}" && pwd)/plugins/gone/skills/gone" "${HOME}/.agents/skills/gone"
  ln -s "/elsewhere/foreign" "${HOME}/.agents/skills/foreign"
  run bash "${INSTALL}" codex
  [ "$status" -eq 0 ]
  run bash "${INSTALL}" codex
  [ "$status" -eq 0 ]
  [ ! -L "${HOME}/.agents/skills/gone" ]      # stale repo link pruned
  [ -L "${HOME}/.agents/skills/foreign" ]     # foreign link untouched
}

@test "codex mode warns and skips a real directory already in ~/.agents/skills" {
  # portable-artifacts' installer (or npx skills) can leave a real dir with a
  # repo skill's name; the rest of the skills must still link and exit 0.
  mkdir -p "${HOME}/.codex" "${HOME}/.agents/skills/make-dashboard"
  echo "other tool's copy" > "${HOME}/.agents/skills/make-dashboard/SKILL.md"
  run bash "${INSTALL}" codex
  [ "$status" -eq 0 ]
  [[ "$output" == *"make-dashboard"* ]] || false
  [ -d "${HOME}/.agents/skills/make-dashboard" ] && [ ! -L "${HOME}/.agents/skills/make-dashboard" ]
  grep -q "other tool's copy" "${HOME}/.agents/skills/make-dashboard/SKILL.md"
  [ -L "${HOME}/.agents/skills/second-wind" ]   # sorts after the collision
}

@test "codex mode exits non-zero when ln itself fails (read-only dest dir)" {
  # A failed link must not be reported as success. Only a real dir/file collision
  # is a tolerated skip; permission errors stay fatal.
  [ "$(id -u)" -ne 0 ] || skip "root ignores directory permissions"
  mkdir -p "${HOME}/.codex" "${HOME}/.agents/skills"
  chmod 555 "${HOME}/.agents/skills"
  run bash "${INSTALL}" codex
  chmod 755 "${HOME}/.agents/skills"
  [ "$status" -ne 0 ]
  [[ "$output" != *"codex: skills linked"* ]] || false
}

@test "copilot mode honors COPILOT_SKILLS_DIR override" {
  export COPILOT_SKILLS_DIR="${TMP}/custom-skills"
  mkdir -p "${COPILOT_SKILLS_DIR}"
  run bash "${INSTALL}" copilot
  [ "$status" -eq 0 ]
  [ -L "${COPILOT_SKILLS_DIR}/commit" ]
}

@test "agents-md mode writes managed block into target file" {
  target="${TMP}/AGENTS.md"
  echo "# My agents file" > "${target}"
  run bash "${INSTALL}" agents-md "${target}"
  [ "$status" -eq 0 ]
  grep -q "BEGIN claude-skills" "${target}"
  grep -q "END claude-skills" "${target}"
  grep -q "second-wind" "${target}"
  grep -q "# My agents file" "${target}"   # pre-existing content preserved
}

@test "agents-md mode is idempotent (block replaced, not duplicated)" {
  target="${TMP}/AGENTS.md"
  echo "# My agents file" > "${target}"
  bash "${INSTALL}" agents-md "${target}"
  bash "${INSTALL}" agents-md "${target}"
  [ "$(grep -c 'BEGIN claude-skills' "${target}")" -eq 1 ]
}

@test "agents-md mode creates the target file when missing" {
  target="${TMP}/sub/AGENTS.md"
  run bash "${INSTALL}" agents-md "${target}"
  [ "$status" -eq 0 ]
  grep -q "BEGIN claude-skills" "${target}"
}

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

@test "capture.sh stops on a seeded token, names the hit, and writes nothing" {
  fake="ghp_$(printf 'a%.0s' {1..36})"
  printf '{"env": {"GITHUB_TOKEN": "%s"}, "effortLevel": "max"}\n' "${fake}" > "${HOME}/.claude/settings.json"
  run bash "${BATS_TEST_DIRNAME}/../../setup/capture.sh"
  [ "$status" -ne 0 ]
  [[ "$output" == *"env.GITHUB_TOKEN"* ]] || false
  [[ "$output" == *"github-token"* ]] || false
  [[ "$output" != *"${fake}"* ]] || false
  [ ! -f "${CLAUDE_SKILLS_HOME}/templates/user-settings.json" ]
  [ ! -f "${CLAUDE_SKILLS_HOME}/templates/home-CLAUDE.md" ]
}

@test "capture.sh does not flag token-count settings such as MAX_THINKING_TOKENS" {
  printf '{"env": {"MAX_THINKING_TOKENS": "32000", "CLAUDE_CODE_MAX_OUTPUT_TOKENS": "64000"}}\n' > "${HOME}/.claude/settings.json"
  run bash "${BATS_TEST_DIRNAME}/../../setup/capture.sh"
  [ "$status" -eq 0 ]
  grep -q MAX_THINKING_TOKENS "${CLAUDE_SKILLS_HOME}/templates/user-settings.json"
}

# Seed one env key and expect the capture to stop without writing or echoing it.
expect_capture_stops_on_env() {
  local name="$1" value="$2"
  jq -n --arg n "${name}" --arg v "${value}" '{env: {($n): $v}}' > "${HOME}/.claude/settings.json"
  run bash "${BATS_TEST_DIRNAME}/../../setup/capture.sh"
  [ "$status" -ne 0 ]
  [[ "$output" == *"${name}"* ]] || false
  [[ "$output" != *"${value}"* ]] || false
  [ ! -f "${CLAUDE_SKILLS_HOME}/templates/user-settings.json" ]
}

@test "capture.sh stops on credential key names that do not end in token or secret" {
  expect_capture_stops_on_env AWS_SECRET_ACCESS_KEY "wJalrXUtnFEMIK7MDENGbPxRfiCYzzzzzz"
  expect_capture_stops_on_env GITHUB_PAT "abcdefghijklmnop1234"
  expect_capture_stops_on_env OPENAI_KEY "abcdefghijklmnop1234"
  expect_capture_stops_on_env SERVICE_AUTH "abcdefghijklmnop1234"
}

@test "capture.sh stops on a hyphenated sk- key value" {
  expect_capture_stops_on_env SOME_SETTING "sk-proj-$(printf 'a%.0s' {1..40})"
}

@test "capture.sh stops on a Bearer token inside a hook command" {
  tok="$(printf 'b%.0s' {1..24})"
  printf '{"hooks": {"PostToolUse": [{"hooks": [{"type": "command", "command": "curl -H \\"Authorization: Bearer %s\\" https://x.invalid"}]}]}}\n' "${tok}" > "${HOME}/.claude/settings.json"
  run bash "${BATS_TEST_DIRNAME}/../../setup/capture.sh"
  [ "$status" -ne 0 ]
  [[ "$output" == *"bearer-token"* ]] || false
  [[ "$output" != *"${tok}"* ]] || false
  [ ! -f "${CLAUDE_SKILLS_HOME}/templates/user-settings.json" ]
}

@test "capture.sh stops on credentials embedded in a URL value" {
  expect_capture_stops_on_env DATABASE_URL "postgres://appuser:hunter2pass@db.invalid/app"
}

@test "capture.sh keeps plain URL, key-count and path-like settings" {
  printf '{"env": {"ANTHROPIC_BASE_URL": "https://api.example.invalid/v1", "KEYBOARD_LAYOUT": "us", "SSH_AUTH_SOCK_HINT": "x"}}\n' > "${HOME}/.claude/settings.json"
  run bash "${BATS_TEST_DIRNAME}/../../setup/capture.sh"
  [ "$status" -eq 0 ]
  grep -q ANTHROPIC_BASE_URL "${CLAUDE_SKILLS_HOME}/templates/user-settings.json"
}

@test "capture.sh normalises HOME and keeps only allowlisted settings keys" {
  cat > "${HOME}/.claude/settings.json" <<EOF
{
  "statusLine": {"type": "command", "command": "bash ${HOME}/.claude/hooks/status.sh"},
  "apiKeyHelper": "${HOME}/bin/print-key",
  "effortLevel": "max"
}
EOF
  run bash "${BATS_TEST_DIRNAME}/../../setup/capture.sh"
  [ "$status" -eq 0 ]
  out="${CLAUDE_SKILLS_HOME}/templates/user-settings.json"
  grep -qF 'bash $HOME/.claude/hooks/status.sh' "${out}"
  ! grep -qF "${HOME}" "${out}" || false
  ! grep -q apiKeyHelper "${out}" || false
  grep -q '"effortLevel": "max"' "${out}"
}

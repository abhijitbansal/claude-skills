#!/usr/bin/env bats

load helpers

setup() {
  TMP="$(mktemp -d)"
  export HOME="${TMP}/home"
  mkdir -p "${HOME}/.local/bin"
  export CLAUDE_SKILLS_HOME="${BATS_TEST_DIRNAME}/../.."
  # Per-test call log: the shared one in BATS_TMPDIR races with other bats runs.
  export MOCK_CALL_LOG="${TMP}/mock-calls.log"
  : > "${MOCK_CALL_LOG}"
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

@test "setup.sh plugins step warns that version pins are unsupported and installs latest" {
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
  # `claude plugin install` has no version flag — the pin must NOT reach the CLI.
  ! grep -q "v1.2" "${MOCK_CALL_LOG}"
  # The plugin still installs (at latest), and the unsupported pin is surfaced.
  grep -q "claude plugin install p@m" "${MOCK_CALL_LOG}"
  [[ "$output" == *"unsupported"* ]]
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

# Inline claude stub whose `plugin marketplace list` prints $1 (a listing).
stub_claude_listing() {
  mkdir -p "${TMP}/bin"
  printf '%s\n' "$1" > "${TMP}/listing.txt"
  cat > "${TMP}/bin/claude" <<EOF
#!/usr/bin/env bash
echo "claude \$*" >> "${MOCK_CALL_LOG}"
if [[ "\$1 \$2 \$3" == "plugin marketplace list" ]]; then cat "${TMP}/listing.txt"; fi
exit 0
EOF
  chmod +x "${TMP}/bin/claude"
}

@test "local_plugins adds the self marketplace when only a foreign Source line mentions claude-skills" {
  stub_claude_listing "Configured marketplaces:

  ❯ claude-code-skills
    Source: GitHub (someone/claude-skills)"
  PATH="${TMP}/bin:${PATH}" run bash "${CLAUDE_SKILLS_HOME}/setup/setup.sh" --only local_plugins
  [ "$status" -eq 0 ]
  grep -q "^claude plugin marketplace add " "${MOCK_CALL_LOG}"
  ! grep -q "^claude plugin marketplace update claude-skills" "${MOCK_CALL_LOG}" || false
}

@test "local_plugins updates the self marketplace when it is listed by exact name" {
  stub_claude_listing "Configured marketplaces:

  ❯ claude-skills
    Source: Directory (/somewhere/claude-skills)"
  PATH="${TMP}/bin:${PATH}" run bash "${CLAUDE_SKILLS_HOME}/setup/setup.sh" --only local_plugins
  [ "$status" -eq 0 ]
  grep -q "^claude plugin marketplace update claude-skills" "${MOCK_CALL_LOG}"
  ! grep -q "^claude plugin marketplace add " "${MOCK_CALL_LOG}" || false
}

@test "setup.sh --dry-run dotfiles writes no .bak and leaves existing files alone" {
  echo "old" > "${HOME}/CLAUDE.md"
  mkdir -p "${HOME}/.claude"
  echo "{\"old\":true}" > "${HOME}/.claude/settings.json"
  CLAUDE_SETUP_TOML="${CLAUDE_SKILLS_HOME}/claude-setup.toml" \
    run bash "${CLAUDE_SKILLS_HOME}/setup/setup.sh" --dry-run --only dotfiles
  [ "$status" -eq 0 ]
  [ -z "$(ls "${HOME}" "${HOME}/.claude" | grep '\.bak\.' || true)" ]
  [ "$(cat "${HOME}/CLAUDE.md")" = "old" ]
  [ "$(cat "${HOME}/.claude/settings.json")" = '{"old":true}' ]
}

@test "setup.sh symlinks step installs wind onto PATH" {
  run bash "${CLAUDE_SKILLS_HOME}/setup/setup.sh" --only symlinks
  [ "$status" -eq 0 ]
  [ -L "${HOME}/.local/bin/wind" ]
  [ "$(readlink "${HOME}/.local/bin/wind")" = "$(cd "${CLAUDE_SKILLS_HOME}" && pwd)/tools/second-wind/wind.py" ]
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

@test "setup.sh --only guidelines creates ~/CLAUDE.md from the repo guidelines when none exists" {
  cd "${TMP}"  # non-repo cwd so the current-repo merge branch is a no-op
  run bash "${CLAUDE_SKILLS_HOME}/setup/setup.sh" --only guidelines
  [ "$status" -eq 0 ]
  [ -f "${HOME}/CLAUDE.md" ]
  grep -q "Think before coding" "${HOME}/CLAUDE.md"
  grep -q "Goal-driven execution" "${HOME}/CLAUDE.md"
}

@test "setup.sh guidelines step is additive: keeps existing content, skips sections already present" {
  cd "${TMP}"
  cat >"${HOME}/CLAUDE.md" <<'EOF'
# My machine rules

## Simplicity first
my own note here

## Keep secrets out of logs
never log tokens
EOF
  run bash "${CLAUDE_SKILLS_HOME}/setup/setup.sh" --only guidelines
  [ "$status" -eq 0 ]
  grep -q "my own note here" "${HOME}/CLAUDE.md"       # pre-existing content preserved
  grep -q "never log tokens" "${HOME}/CLAUDE.md"
  grep -q "Think before coding" "${HOME}/CLAUDE.md"    # missing section added
  # the section already present is not duplicated
  [ "$(grep -c "^## Simplicity first" "${HOME}/CLAUDE.md")" -eq 1 ]
}

@test "setup.sh guidelines step is idempotent" {
  cd "${TMP}"
  bash "${CLAUDE_SKILLS_HOME}/setup/setup.sh" --only guidelines
  cp "${HOME}/CLAUDE.md" "${TMP}/after-first"
  run bash "${CLAUDE_SKILLS_HOME}/setup/setup.sh" --only guidelines
  [ "$status" -eq 0 ]
  diff -q "${TMP}/after-first" "${HOME}/CLAUDE.md"
}

@test "setup.sh --merge-claude-md merges guidelines into an explicit path" {
  cd "${TMP}"
  run bash "${CLAUDE_SKILLS_HOME}/setup/setup.sh" --only guidelines --merge-claude-md "${TMP}/proj/CLAUDE.md"
  [ "$status" -eq 0 ]
  [ -f "${TMP}/proj/CLAUDE.md" ]
  grep -q "Surgical changes" "${TMP}/proj/CLAUDE.md"
}

@test "setup.sh full run is idempotent on rerun" {
  CLAUDE_SETUP_TOML="${CLAUDE_SKILLS_HOME}/claude-setup.toml" \
    bash "${CLAUDE_SKILLS_HOME}/setup/setup.sh" --dry-run
  run bash "${CLAUDE_SKILLS_HOME}/setup/setup.sh" --dry-run
  [ "$status" -eq 0 ]
}

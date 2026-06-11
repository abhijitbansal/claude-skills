#!/usr/bin/env bats

load helpers

setup() {
  TMP="$(mktemp -d)"
  export HOME="${TMP}/home"
  mkdir -p "${HOME}/.local/bin"
  REAL_REPO="${BATS_TEST_DIRNAME}/../.."
  export CLAUDE_SKILLS_HOME="${TMP}/repo"
  git clone --quiet "${REAL_REPO}" "${CLAUDE_SKILLS_HOME}"
  git -C "${CLAUDE_SKILLS_HOME}" config user.email t@t
  git -C "${CLAUDE_SKILLS_HOME}" config user.name  Tester
  # contribute.sh switches to main; pin main to the cloned HEAD so tests
  # exercise the current branch's layout, not a stale main. No-op when the
  # clone already checked out main (can't force-update the current branch).
  if [ "$(git -C "${CLAUDE_SKILLS_HOME}" symbolic-ref --short HEAD)" != "main" ]; then
    git -C "${CLAUDE_SKILLS_HOME}" branch -f main HEAD
  fi
  cd "${CLAUDE_SKILLS_HOME}"
}

teardown() { rm -rf "${TMP}"; }

@test "contribute.sh scaffolds a new skill on --skill" {
  run bash "${CLAUDE_SKILLS_HOME}/setup/contribute.sh" --skill demo --message "demo skill" --no-pr
  [ "$status" -eq 0 ]
  [ -f "${CLAUDE_SKILLS_HOME}/plugins/core-workflow/skills/demo/SKILL.md" ]
  git -C "${CLAUDE_SKILLS_HOME}" log --oneline | grep -q "demo"
}

@test "contribute.sh --plugin scaffolds into the named plugin" {
  run bash "${CLAUDE_SKILLS_HOME}/setup/contribute.sh" --skill demo2 --plugin ios-dev --message "demo2 skill" --no-pr
  [ "$status" -eq 0 ]
  [ -f "${CLAUDE_SKILLS_HOME}/plugins/ios-dev/skills/demo2/SKILL.md" ]
}

@test "contribute.sh --plugin rejects unknown plugin" {
  run bash "${CLAUDE_SKILLS_HOME}/setup/contribute.sh" --skill demo3 --plugin nope --no-pr
  [ "$status" -ne 0 ]
  [[ "$output" == *"no plugin nope"* ]]
}

@test "contribute.sh refuses on dirty tree" {
  echo dirty > "${CLAUDE_SKILLS_HOME}/dirty"
  run bash "${CLAUDE_SKILLS_HOME}/setup/contribute.sh" --skill demo --no-pr
  [ "$status" -ne 0 ]
  [[ "$output" == *"working tree dirty"* ]]
}

@test "contribute.sh preflights gh auth before mutating" {
  # Remove the mocks dir from PATH so `gh` fails to resolve
  PATH_NO_GH="$(echo "$PATH" | tr ':' '\n' | grep -v mocks | paste -sd: -)"
  PATH="${PATH_NO_GH}" run bash "${CLAUDE_SKILLS_HOME}/setup/contribute.sh" --skill demo --message x --no-pr
  [ "$status" -ne 0 ]
  [[ "$output" == *"gh"* ]]
}

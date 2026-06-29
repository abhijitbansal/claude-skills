#!/usr/bin/env bats

load helpers

PLUGIN="${BATS_TEST_DIRNAME}/../../plugins/prompt-craft"
HOOKS="${PLUGIN}/hooks"

setup() {
  TMP="$(mktemp -d)"
  export HOME="${TMP}/home"
  mkdir -p "${HOME}/.claude"
  export CLAUDE_PLUGIN_ROOT="${PLUGIN}"
}
teardown() { rm -rf "${TMP}"; }

_repo() {
  mkdir -p "$1/plugins/ecc/skills/review"
  printf -- '---\nname: review\ndescription: Review a diff for bugs.\n---\n' \
    > "$1/plugins/ecc/skills/review/SKILL.md"
}

@test "registry_freshness: builds when registry missing" {
  _repo "${TMP}/repo"
  run bash -c "printf '%s' '{\"cwd\":\"${TMP}/repo\"}' | bash '${HOOKS}/registry_freshness.sh'"
  [ "$status" -eq 0 ]
  [ -f "${HOME}/.claude/prompt-craft/registry.json" ]
}

@test "registry_freshness: no-op when fresh (registry unchanged)" {
  _repo "${TMP}/repo"
  printf '%s' "{\"cwd\":\"${TMP}/repo\"}" | bash "${HOOKS}/registry_freshness.sh"
  before="$(stat -f %m "${HOME}/.claude/prompt-craft/registry.json" 2>/dev/null || stat -c %Y "${HOME}/.claude/prompt-craft/registry.json")"
  sleep 1
  run bash -c "printf '%s' '{\"cwd\":\"${TMP}/repo\"}' | bash '${HOOKS}/registry_freshness.sh'"
  after="$(stat -f %m "${HOME}/.claude/prompt-craft/registry.json" 2>/dev/null || stat -c %Y "${HOME}/.claude/prompt-craft/registry.json")"
  [ "$status" -eq 0 ]
  [ "$before" = "$after" ]
}

@test "registry_freshness: rebuilds on repo-root change" {
  _repo "${TMP}/repo"; _repo "${TMP}/other"
  printf '%s' "{\"cwd\":\"${TMP}/repo\"}" | bash "${HOOKS}/registry_freshness.sh"
  run bash -c "printf '%s' '{\"cwd\":\"${TMP}/other\"}' | bash '${HOOKS}/registry_freshness.sh'"
  [ "$status" -eq 0 ]
  grep -q "${TMP}/other" "${HOME}/.claude/prompt-craft/registry.json"
}

@test "registry_freshness: rebuilds on signature change (new command)" {
  _repo "${TMP}/repo"
  printf '%s' "{\"cwd\":\"${TMP}/repo\"}" | bash "${HOOKS}/registry_freshness.sh"
  mkdir -p "${TMP}/repo/plugins/ecc/skills/lint"
  printf -- '---\nname: lint\ndescription: Run the linters.\n---\n' \
    > "${TMP}/repo/plugins/ecc/skills/lint/SKILL.md"
  run bash -c "printf '%s' '{\"cwd\":\"${TMP}/repo\"}' | bash '${HOOKS}/registry_freshness.sh'"
  [ "$status" -eq 0 ]
  grep -q "/ecc:lint" "${HOME}/.claude/prompt-craft/registry.json"
}

@test "registry_freshness: claude absent does not force a rebuild" {
  _repo "${TMP}/repo"
  printf '%s' "{\"cwd\":\"${TMP}/repo\"}" | bash "${HOOKS}/registry_freshness.sh"
  before="$(stat -f %m "${HOME}/.claude/prompt-craft/registry.json" 2>/dev/null || stat -c %Y "${HOME}/.claude/prompt-craft/registry.json")"
  sleep 1
  # PATH without our mock `claude` -> `claude --version` empty -> version dimension skipped
  run env PATH="/usr/bin:/bin" bash -c "printf '%s' '{\"cwd\":\"${TMP}/repo\"}' | bash '${HOOKS}/registry_freshness.sh'"
  after="$(stat -f %m "${HOME}/.claude/prompt-craft/registry.json" 2>/dev/null || stat -c %Y "${HOME}/.claude/prompt-craft/registry.json")"
  [ "$status" -eq 0 ]
  [ "$before" = "$after" ]
}

@test "registry_freshness: build_registry absent exits 0" {
  FAKE_ROOT="${TMP}/fake_root"
  mkdir -p "${FAKE_ROOT}/hooks"
  cp "${HOOKS}/registry_freshness.sh" "${FAKE_ROOT}/hooks/"
  run bash -c "printf '%s' '{\"cwd\":\"/tmp\"}' | CLAUDE_PLUGIN_ROOT='${FAKE_ROOT}' bash '${FAKE_ROOT}/hooks/registry_freshness.sh'"
  [ "$status" -eq 0 ]
}

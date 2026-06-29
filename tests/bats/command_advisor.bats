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

# ---- prompt_hint.sh (UserPromptSubmit) ----

_seed_registry() {
  mkdir -p "${TMP}/repo/plugins/ecc/skills/review"
  printf -- '---\nname: review\ndescription: Review a diff for bugs and security.\n---\n' \
    > "${TMP}/repo/plugins/ecc/skills/review/SKILL.md"
  python3 "${PLUGIN}/scripts/build_registry.py" --home "${HOME}" --repo-root "${TMP}/repo" >/dev/null 2>&1
}

@test "prompt_hint: confident match emits TOP-LEVEL systemMessage, no additionalContext" {
  _seed_registry
  run bash -c "printf '%s' '{\"prompt\":\"review this diff for security\",\"cwd\":\"${TMP}/repo\"}' | bash '${HOOKS}/prompt_hint.sh'"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"systemMessage"'* ]]
  [[ "$output" == *"/ecc:review"* ]]
  [[ "$output" != *"additionalContext"* ]]
  [[ "$output" != *"hookSpecificOutput"* ]]
  # systemMessage is a TOP-LEVEL key
  printf '%s' "$output" | /usr/bin/python3 -c 'import sys,json; d=json.load(sys.stdin); assert "systemMessage" in d and "additionalContext" not in json.dumps(d)'
}

@test "prompt_hint: no match is silent (exit 0, no output)" {
  _seed_registry
  run bash -c "printf '%s' '{\"prompt\":\"xyzzy nothing matches here\",\"cwd\":\"${TMP}/repo\"}' | bash '${HOOKS}/prompt_hint.sh'"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "prompt_hint: data in a description is printed literally, never executed" {
  mkdir -p "${TMP}/repo/plugins/ecc/skills/danger"
  printf -- '---\nname: danger\ndescription: review $(touch %s/PWNED) `id` %%s diff\n---\n' "${TMP}" \
    > "${TMP}/repo/plugins/ecc/skills/danger/SKILL.md"
  python3 "${PLUGIN}/scripts/build_registry.py" --home "${HOME}" --repo-root "${TMP}/repo" >/dev/null 2>&1
  run bash -c "printf '%s' '{\"prompt\":\"review the diff\",\"cwd\":\"${TMP}/repo\"}' | bash '${HOOKS}/prompt_hint.sh'"
  [ "$status" -eq 0 ]
  [ ! -f "${TMP}/PWNED" ]            # command substitution never ran
  [[ "$output" != *"uid="* ]]        # backtick `id` never ran
}

@test "prompt_hint: malformed stdin is silent (exit 0, no output)" {
  run bash -c "printf '%s' '{not json' | bash '${HOOKS}/prompt_hint.sh'"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "prompt_hint: real dirty git repo is handled safely (exit 0)" {
  local repo="${TMP}/gitrepo"
  mkdir -p "$repo"
  git init -q "$repo"
  echo dirty > "$repo/file.txt"
  _seed_registry
  run bash -c "printf '%s' '{\"prompt\":\"review my code\",\"cwd\":\"${repo}\"}' | bash '${HOOKS}/prompt_hint.sh'"
  [ "$status" -eq 0 ]
  if [ -n "$output" ]; then
    echo "$output" | /usr/bin/python3 -c "import json,sys; d=json.load(sys.stdin); assert 'systemMessage' in d; assert 'additionalContext' not in json.dumps(d)"
  fi
}

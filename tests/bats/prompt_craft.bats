#!/usr/bin/env bats

load helpers

HOOKS="${BATS_TEST_DIRNAME}/../../plugins/prompt-craft/hooks"

setup() {
  TMP="$(mktemp -d)"
}
teardown() { rm -rf "${TMP}"; }

# Build a git repo with one commit; leave it clean unless the caller dirties it.
_init_repo() {
  local d="$1"
  mkdir -p "$d"
  git -C "$d" init -q
  git -C "$d" config user.email t@t
  git -C "$d" config user.name Tester
  echo seed > "$d/seed.txt"
  git -C "$d" add seed.txt
  git -C "$d" commit -qm seed
}

# ---- suggest_next.sh (Stop hook) ----

@test "suggest_next: dirty working tree suggests /commit" {
  _init_repo "${TMP}/repo"
  echo change >> "${TMP}/repo/seed.txt"   # uncommitted change
  run bash -c "printf '%s' '{\"cwd\":\"${TMP}/repo\"}' | bash '${HOOKS}/suggest_next.sh'"
  [ "$status" -eq 0 ]
  [[ "$output" == *"/commit"* ]]
}

@test "suggest_next: clean repo with no unpushed commits is silent" {
  _init_repo "${TMP}/repo"
  run bash -c "printf '%s' '{\"cwd\":\"${TMP}/repo\"}' | bash '${HOOKS}/suggest_next.sh'"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "suggest_next: non-git directory is silent" {
  mkdir -p "${TMP}/plain"
  run bash -c "printf '%s' '{\"cwd\":\"${TMP}/plain\"}' | bash '${HOOKS}/suggest_next.sh'"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

# ---- block_secrets.sh (PreToolUse guardrail, opt-in) ----

@test "block_secrets: OFF by default -- a .env read is allowed" {
  run bash -c "printf '%s' '{\"tool_input\":{\"file_path\":\"/x/.env\"}}' | bash '${HOOKS}/block_secrets.sh'"
  [ "$status" -eq 0 ]
}

@test "block_secrets: enabled -- a .env read is blocked (exit 2)" {
  run env PROMPT_CRAFT_BLOCK_SECRETS=1 bash -c "printf '%s' '{\"tool_input\":{\"file_path\":\"/x/.env\"}}' | bash '${HOOKS}/block_secrets.sh'"
  [ "$status" -eq 2 ]
  [[ "$output" == *".env"* ]]
}

@test "block_secrets: enabled -- a normal source file is allowed" {
  run env PROMPT_CRAFT_BLOCK_SECRETS=1 bash -c "printf '%s' '{\"tool_input\":{\"file_path\":\"/x/src/app.ts\"}}' | bash '${HOOKS}/block_secrets.sh'"
  [ "$status" -eq 0 ]
}

# ---- format_on_edit.sh (PostToolUse, opt-in) ----

@test "format_on_edit: OFF by default -- formatter not invoked" {
  printf '%s' '{"tool_input":{"file_path":"/x/foo.py"}}' > "${TMP}/in.json"
  run bash -c "bash '${HOOKS}/format_on_edit.sh' < '${TMP}/in.json'"
  [ "$status" -eq 0 ]
}

@test "format_on_edit: enabled -- runs the matching formatter on a .py file" {
  mkdir -p "${TMP}/bin"
  cat > "${TMP}/bin/black" <<'EOF'
#!/usr/bin/env bash
echo "black $*" >> "${MOCK_CALL_LOG}"
EOF
  chmod +x "${TMP}/bin/black"
  touch "${TMP}/foo.py"
  run env PROMPT_CRAFT_FORMAT_ON_EDIT=1 PATH="${TMP}/bin:${PATH}" \
    bash -c "printf '%s' '{\"tool_input\":{\"file_path\":\"${TMP}/foo.py\"}}' | bash '${HOOKS}/format_on_edit.sh'"
  [ "$status" -eq 0 ]
  grep -q "black ${TMP}/foo.py" "${MOCK_CALL_LOG}"
}

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

@test "suggest_next: dirty working tree suggests /commit via top-level systemMessage" {
  _init_repo "${TMP}/repo"
  echo change >> "${TMP}/repo/seed.txt"   # uncommitted change
  run bash -c "printf '%s' '{\"cwd\":\"${TMP}/repo\"}' | bash '${HOOKS}/suggest_next.sh'"
  [ "$status" -eq 0 ]
  [[ "$output" == *"/commit"* ]] || false
  [[ "$output" == *'"systemMessage"'* ]] || false
  [[ "$output" != *"additionalContext"* ]] || false
  [[ "$output" != *"hookSpecificOutput"* ]] || false
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

@test "block_secrets: enabled -- .env.example and other templates stay readable" {
  for f in .env.example .env.sample .env.template config.key.example; do
    run env PROMPT_CRAFT_BLOCK_SECRETS=1 bash -c "printf '%s' '{\"tool_input\":{\"file_path\":\"/x/${f}\"}}' | bash '${HOOKS}/block_secrets.sh'"
    [ "$status" -eq 0 ]
  done
}

@test "block_secrets: enabled -- real env files are still blocked next to templates" {
  for f in .env .env.local .env.production secret.pem; do
    run env PROMPT_CRAFT_BLOCK_SECRETS=1 bash -c "printf '%s' '{\"tool_input\":{\"file_path\":\"/x/${f}\"}}' | bash '${HOOKS}/block_secrets.sh'"
    [ "$status" -eq 2 ]
  done
}

# ---- CAT-86: PROMPT_CRAFT_ADVISOR=0 kill switch ----

SCRIPTS="${BATS_TEST_DIRNAME}/../../plugins/prompt-craft/scripts"

# Fake HOME whose registry holds one command that matches "review this diff".
_seed_registry() {
  mkdir -p "${TMP}/home/.claude" "${TMP}/seedrepo/plugins/ecc/skills/review"
  printf '%s\n' '---' 'name: review' 'description: Review a diff for bugs.' '---' \
    > "${TMP}/seedrepo/plugins/ecc/skills/review/SKILL.md"
  HOME="${TMP}/home" python3 "${SCRIPTS}/build_registry.py" \
    --repo-root "${TMP}/seedrepo" --home "${TMP}/home"
}

@test "prompt_hint: banner by default, silent with PROMPT_CRAFT_ADVISOR=0" {
  _seed_registry
  mkdir -p "${TMP}/plain"
  local in="{\"cwd\":\"${TMP}/plain\",\"prompt\":\"review this diff\"}"
  run env HOME="${TMP}/home" bash -c "printf '%s' '${in}' | bash '${HOOKS}/prompt_hint.sh'"
  [ "$status" -eq 0 ]
  [[ "$output" == *"/ecc:review"* ]] || false
  run env HOME="${TMP}/home" PROMPT_CRAFT_ADVISOR=0 bash -c "printf '%s' '${in}' | bash '${HOOKS}/prompt_hint.sh'"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "suggest_next: PROMPT_CRAFT_ADVISOR=0 silences the Stop hook" {
  _init_repo "${TMP}/repo"
  echo change >> "${TMP}/repo/seed.txt"
  run env PROMPT_CRAFT_ADVISOR=0 bash -c "printf '%s' '{\"cwd\":\"${TMP}/repo\"}' | bash '${HOOKS}/suggest_next.sh'"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "registry_freshness: PROMPT_CRAFT_ADVISOR=0 builds nothing" {
  mkdir -p "${TMP}/home/.claude" "${TMP}/plain"
  run env HOME="${TMP}/home" PROMPT_CRAFT_ADVISOR=0 bash -c "printf '%s' '{\"cwd\":\"${TMP}/plain\"}' | bash '${HOOKS}/registry_freshness.sh'"
  [ "$status" -eq 0 ]
  [ ! -e "${TMP}/home/.claude/prompt-craft/registry.json" ]
}

@test "registry_freshness: builds the registry by default" {
  mkdir -p "${TMP}/home/.claude" "${TMP}/plain"
  run env HOME="${TMP}/home" bash -c "printf '%s' '{\"cwd\":\"${TMP}/plain\"}' | bash '${HOOKS}/registry_freshness.sh'"
  [ "$status" -eq 0 ]
  [ -e "${TMP}/home/.claude/prompt-craft/registry.json" ]
}

# ---- statusline_hint.sh / statusline_shim.sh (CAT-84, CAT-86) ----

_sidecar() {  # _sidecar <base command>
  mkdir -p "${TMP}/home/.claude/prompt-craft"
  printf '%s' "$1" > "${TMP}/home/.claude/prompt-craft/base-statusline"
}

@test "statusline_hint: a user base named statusline.sh elsewhere still shows" {
  mkdir -p "${TMP}/bin"
  printf '#!/usr/bin/env bash\nprintf MYBASE\n' > "${TMP}/bin/statusline.sh"
  _sidecar "bash \"${TMP}/bin/statusline.sh\""
  run env HOME="${TMP}/home" bash -c "printf '%s' '{\"cwd\":\"${TMP}\"}' | bash '${HOOKS}/statusline_hint.sh'"
  [ "$status" -eq 0 ]
  [[ "$output" == *"MYBASE"* ]] || false
}

@test "statusline_hint: a base that is our own shim is skipped (no recursion)" {
  mkdir -p "${TMP}/home/.claude/prompt-craft"
  printf '#!/usr/bin/env bash\nprintf SHIM-RAN\n' > "${TMP}/home/.claude/prompt-craft/statusline.sh"
  _sidecar "bash \"${TMP}/home/.claude/prompt-craft/statusline.sh\""
  run env HOME="${TMP}/home" bash -c "printf '%s' '{\"cwd\":\"${TMP}\"}' | bash '${HOOKS}/statusline_hint.sh'"
  [ "$status" -eq 0 ]
  [[ "$output" != *"SHIM-RAN"* ]] || false
}

@test "statusline_hint: hint is appended when it fits" {
  _init_repo "${TMP}/repo"
  echo change >> "${TMP}/repo/seed.txt"
  mkdir -p "${TMP}/bin"
  printf '#!/usr/bin/env bash\nprintf SHORTBASE\n' > "${TMP}/bin/base.sh"
  _sidecar "bash \"${TMP}/bin/base.sh\""
  run env HOME="${TMP}/home" bash -c "printf '%s' '{\"cwd\":\"${TMP}/repo\"}' | bash '${HOOKS}/statusline_hint.sh'"
  [ "$status" -eq 0 ]
  [[ "$output" == *"SHORTBASE | "*"next:"* ]] || false
}

@test "statusline_hint: a long coloured base is left whole and the hint is dropped" {
  _init_repo "${TMP}/repo"
  echo change >> "${TMP}/repo/seed.txt"
  mkdir -p "${TMP}/bin"
  cat > "${TMP}/bin/base.sh" <<'EOF'
#!/usr/bin/env bash
printf '\033[31m%s\033[0m' "$(printf 'x%.0s' $(seq 1 135))"
EOF
  _sidecar "bash \"${TMP}/bin/base.sh\""
  run env HOME="${TMP}/home" bash -c "printf '%s' '{\"cwd\":\"${TMP}/repo\"}' | bash '${HOOKS}/statusline_hint.sh'"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | tr -cd x | wc -c | tr -d ' ')" -eq 135 ]
  [[ "$output" == *$'\033[31m'* ]] || false
  [[ "$output" != *"next:"* ]] || false
}

@test "statusline_hint: PROMPT_CRAFT_ADVISOR=0 keeps the base and adds no hint" {
  _init_repo "${TMP}/repo"
  echo change >> "${TMP}/repo/seed.txt"
  mkdir -p "${TMP}/bin"
  printf '#!/usr/bin/env bash\nprintf SHORTBASE\n' > "${TMP}/bin/base.sh"
  _sidecar "bash \"${TMP}/bin/base.sh\""
  run env HOME="${TMP}/home" PROMPT_CRAFT_ADVISOR=0 bash -c "printf '%s' '{\"cwd\":\"${TMP}/repo\"}' | bash '${HOOKS}/statusline_hint.sh'"
  [ "$status" -eq 0 ]
  [[ "$output" == *"SHORTBASE"* ]] || false
  [[ "$output" != *"next:"* ]] || false
}

@test "statusline_shim: picks the numerically newest plugin version" {
  for v in 0.3.9 0.3.10 0.3.2; do
    mkdir -p "${TMP}/home/.claude/plugins/cache/m/prompt-craft/${v}/hooks"
    printf '#!/usr/bin/env bash\nprintf "V%s"\n' "${v}" > "${TMP}/home/.claude/plugins/cache/m/prompt-craft/${v}/hooks/statusline_hint.sh"
  done
  run env HOME="${TMP}/home" bash -c "printf '%s' '{}' | bash '${HOOKS}/statusline_shim.sh'"
  [ "$status" -eq 0 ]
  [ "$output" = "V0.3.10" ]
}

@test "statusline_shim: fallback runs a user base named statusline.sh elsewhere" {
  mkdir -p "${TMP}/bin"
  printf '#!/usr/bin/env bash\nprintf MYBASE\n' > "${TMP}/bin/statusline.sh"
  _sidecar "bash \"${TMP}/bin/statusline.sh\""
  run env HOME="${TMP}/home" bash -c "printf '%s' '{}' | bash '${HOOKS}/statusline_shim.sh'"
  [ "$status" -eq 0 ]
  [ "$output" = "MYBASE" ]
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

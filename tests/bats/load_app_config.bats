#!/usr/bin/env bats

load helpers

setup() {
  TMP="$(mktemp -d)"
  mkdir -p "${TMP}/proj/.claude"
  cat >"${TMP}/proj/.claude/app.yml" <<EOF
schema_version: 1
app:
  name: Paperix
  bundle_id: com.abhijit.paperix
  scheme: Paperix
  team_id: ABC123
  url_scheme: paperix
linear:
  team_key: PAP
EOF
  export REPO_ROOT
  REPO_ROOT="${BATS_TEST_DIRNAME}/../.."
}

teardown() { rm -rf "${TMP}"; }

@test "load_app_config exports keys from .claude/app.yml" {
  cd "${TMP}/proj"
  source "${REPO_ROOT}/skills/_lib/load_app_config.sh"
  [ "${APP_NAME}" = "Paperix" ]
  [ "${APP_BUNDLE_ID}" = "com.abhijit.paperix" ]
  [ "${APP_SCHEME}" = "Paperix" ]
  [ "${APP_TEAM_ID}" = "ABC123" ]
  [ "${APP_URL_SCHEME}" = "paperix" ]
  [ "${LINEAR_TEAM_KEY}" = "PAP" ]
}

@test "load_app_config walks up to find .claude/app.yml" {
  mkdir -p "${TMP}/proj/deep/nested"
  cd "${TMP}/proj/deep/nested"
  source "${REPO_ROOT}/skills/_lib/load_app_config.sh"
  [ "${APP_NAME}" = "Paperix" ]
}

@test "load_app_config errors when no app.yml is found" {
  cd "${TMP}"
  run bash -c "source '${REPO_ROOT}/skills/_lib/load_app_config.sh'"
  [ "$status" -ne 0 ]
  [[ "$output" == *"app.yml"* ]]
}

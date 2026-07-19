#!/usr/bin/env bats

load helpers

setup() {
  TMP="$(mktemp -d)"
  INIT="${BATS_TEST_DIRNAME}/../../plugins/ios-dev/skills/_lib/init_app_config.sh"
}
teardown() { rm -rf "${TMP}"; }

@test "fresh scaffold writes schema 2 with all v2 sections" {
  cd "${TMP}"
  cat > project.yml <<'YML'
name: Demo
options:
  bundleIdPrefix: com.example
options:
  deploymentTarget:
    iOS: "26.0"
targets:
  Demo:
    type: application
    platform: iOS
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: com.example.demo
        DEVELOPMENT_TEAM: ABCDE12345
  DemoWidget:
    type: app-extension
    platform: iOS
YML
  run bash "${INIT}"
  [ "$status" -eq 0 ]
  grep -q '^schema_version: 2' .claude/app.yml
  grep -q '^release:' .claude/app.yml
  grep -q '^site:' .claude/app.yml
  grep -q '^ci:' .claude/app.yml
  grep -q '^targets:' .claude/app.yml
  grep -q 'DemoWidget' .claude/app.yml
  grep -q 'testflight_bump: build' .claude/app.yml
}

@test "--migrate upgrades v1 in place preserving values" {
  mkdir -p "${TMP}/.claude"
  cat > "${TMP}/.claude/app.yml" <<'YML'
app:
  name: Old
  bundle_id: com.example.old
  scheme: Old
  team_id: ABCDE12345
  url_scheme: old
YML
  cd "${TMP}"
  run bash "${INIT}" --migrate
  [ "$status" -eq 0 ]
  [[ "$output" == *"migrated"* ]]
  grep -q '^schema_version: 2' .claude/app.yml
  grep -q 'name: Old' .claude/app.yml
  grep -q '^release:' .claude/app.yml
  grep -q '^site:' .claude/app.yml
  grep -q '^ci:' .claude/app.yml
  grep -q '^targets:' .claude/app.yml
}

@test "--migrate replaces an existing schema_version: 1 marker" {
  mkdir -p "${TMP}/.claude"
  cat > "${TMP}/.claude/app.yml" <<'YML'
schema_version: 1

app:
  name: Old
  bundle_id: com.example.old
  scheme: Old
  team_id: ABCDE12345
  url_scheme: old
YML
  cd "${TMP}"
  run bash "${INIT}" --migrate
  [ "$status" -eq 0 ]
  [ "$(grep -c '^schema_version:' .claude/app.yml)" -eq 1 ]
  grep -q '^schema_version: 2' .claude/app.yml
}

@test "--migrate on v2 file is a no-op" {
  mkdir -p "${TMP}/.claude"
  printf 'schema_version: 2\napp:\n  name: X\n' > "${TMP}/.claude/app.yml"
  cp "${TMP}/.claude/app.yml" "${TMP}/before"
  cd "${TMP}"
  run bash "${INIT}" --migrate
  [ "$status" -eq 0 ]
  [[ "$output" == *"already v2"* ]]
  cmp -s "${TMP}/before" "${TMP}/.claude/app.yml"
}

@test "--migrate without an existing file fails with guidance" {
  cd "${TMP}"
  run bash "${INIT}" --migrate
  [ "$status" -eq 1 ]
  [[ "$output" == *"--migrate"* ]]
}

@test "refuses overwrite without --force" {
  mkdir -p "${TMP}/.claude"
  echo "app:" > "${TMP}/.claude/app.yml"
  cd "${TMP}"
  run bash "${INIT}"
  [ "$status" -eq 3 ]
  [[ "$output" == *"--force"* ]]
}

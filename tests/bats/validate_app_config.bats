#!/usr/bin/env bats

load helpers

setup() {
  TMP="$(mktemp -d)"
  VALIDATE="${BATS_TEST_DIRNAME}/../../plugins/ios-dev/skills/_lib/validate_app_config.sh"
}
teardown() { rm -rf "${TMP}"; }

good_yml() {
  cat > "$1" <<'YML'
schema_version: 2
app:
  name: Demo
  bundle_id: com.example.demo
  scheme: Demo
  team_id: ABCDE12345
  url_scheme: demo
release:
  encryption_exempt: true
  fonts_expected: 7
YML
}

@test "valid v2 file exits 0 with no ERROR lines" {
  good_yml "${TMP}/app.yml"
  run bash "${VALIDATE}" "${TMP}/app.yml"
  [ "$status" -eq 0 ]
  [[ "$output" != *"ERROR"* ]]
}

@test "TODO placeholder in required field is an ERROR" {
  good_yml "${TMP}/app.yml"
  sed -i.bak 's/team_id: ABCDE12345/team_id: TODO/' "${TMP}/app.yml"
  run bash "${VALIDATE}" "${TMP}/app.yml"
  [ "$status" -eq 1 ]
  [[ "$output" == *"ERROR: app.team_id"* ]]
}

@test "missing required key is an ERROR" {
  good_yml "${TMP}/app.yml"
  grep -v "bundle_id" "${TMP}/app.yml" > "${TMP}/app2.yml"
  run bash "${VALIDATE}" "${TMP}/app2.yml"
  [ "$status" -eq 1 ]
  [[ "$output" == *"ERROR: app.bundle_id"* ]]
}

@test "non-integer fonts_expected is an ERROR" {
  good_yml "${TMP}/app.yml"
  sed -i.bak 's/fonts_expected: 7/fonts_expected: seven/' "${TMP}/app.yml"
  run bash "${VALIDATE}" "${TMP}/app.yml"
  [ "$status" -eq 1 ]
  [[ "$output" == *"ERROR: release.fonts_expected"* ]]
}

@test "bad encryption_exempt is an ERROR" {
  good_yml "${TMP}/app.yml"
  sed -i.bak 's/encryption_exempt: true/encryption_exempt: yep/' "${TMP}/app.yml"
  run bash "${VALIDATE}" "${TMP}/app.yml"
  [ "$status" -eq 1 ]
  [[ "$output" == *"ERROR: release.encryption_exempt"* ]]
}

@test "unknown platform is an ERROR" {
  good_yml "${TMP}/app.yml"
  sed -i.bak 's/  url_scheme: demo/  url_scheme: demo\
  platforms: [ios, android]/' "${TMP}/app.yml"
  run bash "${VALIDATE}" "${TMP}/app.yml"
  [ "$status" -eq 1 ]
  [[ "$output" == *"ERROR: app.platforms"* ]]
}

@test "v1 file (no schema_version key) is valid, warns about migration" {
  good_yml "${TMP}/app.yml"
  grep -v "^schema_version:" "${TMP}/app.yml" > "${TMP}/v1.yml"
  run bash "${VALIDATE}" "${TMP}/v1.yml"
  [ "$status" -eq 0 ]
  [[ "$output" == *"WARN"* ]]
  [[ "$output" == *"schema_version"* ]]
}

@test "whatsnew_file pointing nowhere is only a WARN" {
  mkdir -p "${TMP}/repo/.claude"
  good_yml "${TMP}/repo/.claude/app.yml"
  cat >> "${TMP}/repo/.claude/app.yml" <<'YML'
  whatsnew_file: Sources/WhatsNew.json
YML
  run bash "${VALIDATE}" "${TMP}/repo/.claude/app.yml"
  [ "$status" -eq 0 ]
  [[ "$output" == *"WARN"* ]]
  [[ "$output" == *"whatsnew_file"* ]]
}

@test "inapp_changelog_file pointing nowhere is only a WARN" {
  mkdir -p "${TMP}/repo2/.claude"
  good_yml "${TMP}/repo2/.claude/app.yml"
  cat >> "${TMP}/repo2/.claude/app.yml" <<'YML'
  inapp_changelog_file: Sources/Changelog.swift
YML
  run bash "${VALIDATE}" "${TMP}/repo2/.claude/app.yml"
  [ "$status" -eq 0 ]
  [[ "$output" == *"WARN"* ]]
  [[ "$output" == *"inapp_changelog_file"* ]]
}

@test "missing file exits 2" {
  run bash "${VALIDATE}" "${TMP}/nope.yml"
  [ "$status" -eq 2 ]
}

@test "shell-metacharacters in app.name are an ERROR (template injection guard)" {
  good_yml "${TMP}/app.yml"
  sed -i.bak 's/name: Demo/name: "Demo\"; rm -rf ~"/' "${TMP}/app.yml"
  run bash "${VALIDATE}" "${TMP}/app.yml"
  [ "$status" -eq 1 ]
  [[ "$output" == *"ERROR: app.name"* ]]
}

@test "malformed bundle_id is an ERROR" {
  good_yml "${TMP}/app.yml"
  sed -i.bak 's/bundle_id: com.example.demo/bundle_id: com.example.demo$(evil)/' "${TMP}/app.yml"
  run bash "${VALIDATE}" "${TMP}/app.yml"
  [ "$status" -eq 1 ]
  [[ "$output" == *"ERROR: app.bundle_id"* ]]
}

@test "release.testflight_bump patch is valid" {
  good_yml "${TMP}/app.yml"
  printf '  testflight_bump: patch\n' >> "${TMP}/app.yml"
  run bash "${VALIDATE}" "${TMP}/app.yml"
  [ "$status" -eq 0 ]
  [[ "$output" != *"ERROR"* ]]
}

@test "release.testflight_bump build is valid" {
  good_yml "${TMP}/app.yml"
  printf '  testflight_bump: build\n' >> "${TMP}/app.yml"
  run bash "${VALIDATE}" "${TMP}/app.yml"
  [ "$status" -eq 0 ]
  [[ "$output" != *"ERROR"* ]]
}

@test "release.testflight_bump rejects values other than build|patch" {
  good_yml "${TMP}/app.yml"
  printf '  testflight_bump: minor\n' >> "${TMP}/app.yml"
  run bash "${VALIDATE}" "${TMP}/app.yml"
  [ "$status" -eq 1 ]
  [[ "$output" == *"ERROR: release.testflight_bump"* ]]
}

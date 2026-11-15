#!/usr/bin/env bats

load helpers

setup() {
  TMP="$(mktemp -d)"
  mkdir -p "${TMP}/proj/.claude"
  cat >"${TMP}/proj/.claude/app.yml" <<EOF
schema_version: 1
app:
  name: MyApp
  bundle_id: com.example.myapp
  scheme: MyApp
  team_id: ABC123
  url_scheme: myapp
linear:
  team_key: PAP
EOF
  export REPO_ROOT
  REPO_ROOT="${BATS_TEST_DIRNAME}/../.."
}

teardown() { rm -rf "${TMP}"; }

@test "load_app_config exports keys from .claude/app.yml" {
  cd "${TMP}/proj"
  source "${REPO_ROOT}/plugins/ios-dev/skills/_lib/load_app_config.sh"
  [ "${APP_NAME}" = "MyApp" ]
  [ "${APP_BUNDLE_ID}" = "com.example.myapp" ]
  [ "${APP_SCHEME}" = "MyApp" ]
  [ "${APP_TEAM_ID}" = "ABC123" ]
  [ "${APP_URL_SCHEME}" = "myapp" ]
  [ "${LINEAR_TEAM_KEY}" = "PAP" ]
}

@test "load_app_config walks up to find .claude/app.yml" {
  mkdir -p "${TMP}/proj/deep/nested"
  cd "${TMP}/proj/deep/nested"
  source "${REPO_ROOT}/plugins/ios-dev/skills/_lib/load_app_config.sh"
  [ "${APP_NAME}" = "MyApp" ]
}

@test "load_app_config errors when no app.yml is found" {
  cd "${TMP}"
  run bash -c "source '${REPO_ROOT}/plugins/ios-dev/skills/_lib/load_app_config.sh'"
  [ "$status" -ne 0 ]
  [[ "$output" == *"app.yml"* ]]
}

write_v2_yml() {  # $1 = dir
  mkdir -p "$1/.claude"
  cat > "$1/.claude/app.yml" <<'YML'
schema_version: 2
app:
  name: Demo
  bundle_id: com.example.demo
  scheme: Demo
  team_id: ABCDE12345
  url_scheme: demo
  platforms: [ios, macos]
  min_os: "26.0"
targets:
  extensions: [DemoWidget, DemoShare]
  app_group: group.com.example.demo
release:
  encryption_exempt: true
  fonts_expected: 7
  usage_strings: [NSCameraUsageDescription, NFCReaderUsageDescription]
  whatsnew_file: Sources/WhatsNew.json
  inapp_changelog_file: Sources/Changelog.swift
  asc_app_id: "6740000000"
  testflight_bump: patch
site:
  repo: example/demo-site
  domain: demo.app
ci:
  provider: xcode-cloud
YML
}

@test "v2: exports schema, platforms, targets, release, site, ci values" {
  write_v2_yml "${TMP}/v2app"
  cd "${TMP}/v2app"
  source "${REPO_ROOT}/plugins/ios-dev/skills/_lib/load_app_config.sh"
  [ "${APP_CONFIG_SCHEMA}" = "2" ]
  [ "${APP_PLATFORMS}" = "ios macos" ]
  [ "${APP_MIN_OS}" = "26.0" ]
  [ "${TARGETS_EXTENSIONS}" = "DemoWidget DemoShare" ]
  [ "${TARGETS_APP_GROUP}" = "group.com.example.demo" ]
  [ "${RELEASE_ENCRYPTION_EXEMPT}" = "true" ]
  [ "${RELEASE_FONTS_EXPECTED}" = "7" ]
  [ "${RELEASE_USAGE_STRINGS}" = "NSCameraUsageDescription NFCReaderUsageDescription" ]
  [ "${RELEASE_WHATSNEW_FILE}" = "Sources/WhatsNew.json" ]
  [ "${RELEASE_INAPP_CHANGELOG_FILE}" = "Sources/Changelog.swift" ]
  [ "${RELEASE_ASC_APP_ID}" = "6740000000" ]
  [ "${RELEASE_TESTFLIGHT_BUMP}" = "patch" ]
  [ "${SITE_REPO}" = "example/demo-site" ]
  [ "${SITE_DOMAIN}" = "demo.app" ]
  [ "${CI_PROVIDER}" = "xcode-cloud" ]
}

@test "v1 file: v2 vars fall back to defaults, existing exports unchanged" {
  cd "${TMP}/proj"
  source "${REPO_ROOT}/plugins/ios-dev/skills/_lib/load_app_config.sh"
  [ "${APP_NAME}" = "MyApp" ]
  [ "${APP_CONFIG_SCHEMA}" = "1" ]
  [ "${APP_PLATFORMS}" = "ios" ]
  [ "${TARGETS_EXTENSIONS}" = "" ]
  [ "${TARGETS_APP_GROUP}" = "" ]
  [ "${RELEASE_ENCRYPTION_EXEMPT}" = "true" ]
  [ "${RELEASE_FONTS_EXPECTED}" = "0" ]
  [ "${RELEASE_INAPP_CHANGELOG_FILE}" = "" ]
  [ "${RELEASE_TESTFLIGHT_BUMP}" = "build" ]
  [ "${RELEASE_HOOKS_DIR}" = "scripts/release-hooks" ]
  [ "${SITE_DIR}" = "site" ]
  [ "${SITE_DEPLOY}" = "subtree-ssh" ]
  [ "${CI_POST_CLONE}" = "ci_scripts/ci_post_clone.sh" ]
}

@test "v2: block-style lists parse the same as inline" {
  mkdir -p "${TMP}/blockapp/.claude"
  cat > "${TMP}/blockapp/.claude/app.yml" <<'YML'
schema_version: 2
app:
  name: Demo
  bundle_id: com.example.demo
  scheme: Demo
  team_id: ABCDE12345
  url_scheme: demo
targets:
  extensions:
    - DemoWidget
    - DemoShare
YML
  cd "${TMP}/blockapp"
  source "${REPO_ROOT}/plugins/ios-dev/skills/_lib/load_app_config.sh"
  [ "${TARGETS_EXTENSIONS}" = "DemoWidget DemoShare" ]
}

@test "values with trailing comments parse clean (scaffold template style)" {
  mkdir -p "${TMP}/capp/.claude"
  cat > "${TMP}/capp/.claude/app.yml" <<'YML'
schema_version: 2
app:
  name: Demo
  bundle_id: com.example.demo
  scheme: Demo
  team_id: ABCDE12345
  url_scheme: demo
  platforms: [ios]                      # ios | macos
  min_os: "26.0"                        # single source
targets:
  extensions: [DemoWidget]              # widget/share/action targets
release:
  encryption_exempt: true               # ITSAppUsesNonExemptEncryption
  fonts_expected: 0                     # 0 = skip bundled-font check
YML
  cd "${TMP}/capp"
  source "${REPO_ROOT}/plugins/ios-dev/skills/_lib/load_app_config.sh"
  [ "${APP_PLATFORMS}" = "ios" ]
  [ "${APP_MIN_OS}" = "26.0" ]
  [ "${TARGETS_EXTENSIONS}" = "DemoWidget" ]
  [ "${RELEASE_ENCRYPTION_EXEMPT}" = "true" ]
  [ "${RELEASE_FONTS_EXPECTED}" = "0" ]
}

@test "APP_CONFIG_HELPERS_ONLY=1 sources helpers without discovery" {
  cd "${TMP}"           # no app.yml anywhere above
  APP_CONFIG_HELPERS_ONLY=1 source "${REPO_ROOT}/plugins/ios-dev/skills/_lib/load_app_config.sh"
  type _yaml_get_list >/dev/null
}

# --- CAT-52: no silent death under set -e ---------------------------------------------

drop_key() {  # $1 = dir, $2 = key line to remove
  grep -v "$2" "$1/.claude/app.yml" > "$1/app.yml.new"
  cp "$1/app.yml.new" "$1/.claude/app.yml"
  rm -f "$1/app.yml.new"
}

@test "set -e caller: missing optional url_scheme proceeds with an empty value" {
  drop_key "${TMP}/proj" url_scheme
  cd "${TMP}/proj"
  run bash -c "set -euo pipefail; source '${REPO_ROOT}/plugins/ios-dev/skills/_lib/load_app_config.sh'; echo \"scheme=[\${APP_URL_SCHEME}] name=\${APP_NAME}\""
  [ "$status" -eq 0 ]
  [[ "$output" == *"scheme=[] name=MyApp"* ]] || false
}

@test "set -e caller: missing required key names the key and exits non-zero" {
  drop_key "${TMP}/proj" "scheme: MyApp"
  cd "${TMP}/proj"
  run bash -c "set -euo pipefail; source '${REPO_ROOT}/plugins/ios-dev/skills/_lib/load_app_config.sh'; echo reached"
  [ "$status" -ne 0 ]
  [[ "$output" == *"app.scheme"* ]] || false
  [[ "$output" != *"reached"* ]] || false
}

@test "non-errexit caller: missing required key is reported but sourcing continues" {
  drop_key "${TMP}/proj" "scheme: MyApp"
  cd "${TMP}/proj"
  run bash -c "set -uo pipefail; source '${REPO_ROOT}/plugins/ios-dev/skills/_lib/load_app_config.sh'; echo \"reached name=\${APP_NAME} scheme=[\${APP_SCHEME}]\""
  [ "$status" -eq 0 ]
  [[ "$output" == *"app.scheme"* ]] || false
  [[ "$output" == *"reached name=MyApp scheme=[]"* ]] || false
}

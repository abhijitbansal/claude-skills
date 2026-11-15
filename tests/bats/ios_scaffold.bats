#!/usr/bin/env bats

load helpers

setup() {
  TMP="$(mktemp -d)"
  SCAFFOLD="${BATS_TEST_DIRNAME}/../../plugins/ios-dev/skills/ios-scaffold/scripts/scaffold.sh"
  make_fixture_app "${TMP}/app"
}
teardown() { rm -rf "${TMP}"; }

@test "fresh repo: creates all managed files, exit 0" {
  cd "${TMP}/app"
  run bash "${SCAFFOLD}"
  [ "$status" -eq 0 ]
  [[ "$output" == *"CREATE: marketing/app-store-listing.md"* ]]
  [[ "$output" == *"CREATE: fastlane/Fastfile"* ]]
  [[ "$output" == *"CREATE: Gemfile"* ]]
  [[ "$output" == *"CREATE: ci_scripts/ci_post_clone.sh"* ]]
  [[ "$output" == *"CREATE: scripts/release-hooks"* ]]
  [ -f marketing/app-store-listing.md ]
  [ -x ci_scripts/ci_post_clone.sh ]
}

@test "second run: zero changes, no CREATE/DRIFT" {
  cd "${TMP}/app"
  bash "${SCAFFOLD}" >/dev/null
  git add -A && git -c user.email=t@t -c user.name=t commit -qm scaffold
  run bash "${SCAFFOLD}"
  [ "$status" -eq 0 ]
  [[ "$output" != *"CREATE:"* ]]
  [[ "$output" != *"DRIFT:"* ]]
  [ -z "$(git status --porcelain)" ]
}

@test "user-modified managed file reports DRIFT, is not overwritten" {
  cd "${TMP}/app"
  bash "${SCAFFOLD}" >/dev/null
  echo "# user edit" >> fastlane/Fastfile
  cp fastlane/Fastfile "${TMP}/edited"
  run bash "${SCAFFOLD}"
  [[ "$output" == *"DRIFT: fastlane/Fastfile"* ]]
  cmp -s "${TMP}/edited" fastlane/Fastfile
}

@test "--check exits 1 when work is needed, writes nothing" {
  cd "${TMP}/app"
  run bash "${SCAFFOLD}" --check
  [ "$status" -eq 1 ]
  [ ! -f fastlane/Fastfile ]
}

@test "rendered Fastfile carries app values, no unrendered tokens" {
  cd "${TMP}/app"
  bash "${SCAFFOLD}" >/dev/null
  grep -q 'scheme: "Demo"' fastlane/Fastfile
  grep -q 'com.example.demo' fastlane/Fastfile
  ! grep -q '{{' fastlane/Fastfile
  ! grep -q '{{' marketing/app-store-listing.md
}

@test "rendered Fastfile archive lane maps provisioning profiles for manual export" {
  cd "${TMP}/app"
  bash "${SCAFFOLD}" >/dev/null
  grep -q 'provisioningProfiles' fastlane/Fastfile
  grep -q 'get_provisioning_profile' fastlane/Fastfile
  grep -q 'app_store_connect_api_key' fastlane/Fastfile
}

@test "ci_post_clone is executable and xcodegen-generating" {
  cd "${TMP}/app"
  bash "${SCAFFOLD}" >/dev/null
  [ -x ci_scripts/ci_post_clone.sh ]
  grep -q 'xcodegen generate' ci_scripts/ci_post_clone.sh
  grep -q 'Package.resolved' ci_scripts/ci_post_clone.sh
}

@test "repo with existing AGENTS.md is not touched" {
  cd "${TMP}/app"
  echo "# my conventions" > AGENTS.md
  bash "${SCAFFOLD}" >/dev/null
  [ "$(cat AGENTS.md)" = "# my conventions" ]
  [ ! -f CLAUDE.md ]
}

@test "repo without AGENTS.md gets skeleton + pointer CLAUDE.md" {
  cd "${TMP}/app"
  bash "${SCAFFOLD}" >/dev/null
  [ -f AGENTS.md ]
  [ -f CLAUDE.md ]
  grep -q 'AGENTS.md' CLAUDE.md
}

# --- G-01: CLAUDE.md imports AGENTS.md (a link leaves the rules unloaded) -----------

@test "pointer CLAUDE.md imports AGENTS.md with an @ line, not a markdown link" {
  cd "${TMP}/app"
  bash "${SCAFFOLD}" >/dev/null
  grep -qx '@AGENTS.md' CLAUDE.md
  [ -z "$(grep -F '](./AGENTS.md)' CLAUDE.md || true)" ]
}

@test "scaffold refuses to render values with shell metacharacters" {
  cd "${TMP}/app"
  sed -i.bak 's/name: Demo/name: Demo`evil`/' .claude/app.yml && rm -f .claude/app.yml.bak
  run bash "${SCAFFOLD}"
  [ "$status" -ne 0 ]
  [[ "$output" == *"unsafe"* ]]
  [ ! -f fastlane/Fastfile ]
}

# --- CAT-50: strict flags -------------------------------------------------------

@test "misspelled --chekc exits 2, lists accepted flags and writes nothing" {
  cd "${TMP}/app"
  run bash "${SCAFFOLD}" --chekc
  [ "$status" -eq 2 ]
  [[ "$output" == *"--check"* ]] || false
  [ ! -e fastlane ]
  [ ! -e build.sh ]
  [ -z "$(git status --porcelain)" ]
}

@test "extra argument exits 2 and writes nothing" {
  cd "${TMP}/app"
  run bash "${SCAFFOLD}" --check extra
  [ "$status" -eq 2 ]
  [ -z "$(git status --porcelain)" ]
}

@test "--help exits 0 and writes nothing" {
  cd "${TMP}/app"
  run bash "${SCAFFOLD}" --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"--check"* ]] || false
  [ -z "$(git status --porcelain)" ]
}

# --- CAT-52: always write at the repo root --------------------------------------

@test "run from a subdirectory writes at the repo root, not under the subdirectory" {
  cd "${TMP}/app/Sources"
  run bash "${SCAFFOLD}"
  [ "$status" -eq 0 ]
  [ -f "${TMP}/app/fastlane/Fastfile" ]
  [ -f "${TMP}/app/build.sh" ]
  [ ! -e "${TMP}/app/Sources/fastlane" ]
  [ ! -e "${TMP}/app/Sources/Gemfile" ]
  [ ! -e "${TMP}/app/Sources/marketing" ]
}

@test "scaffold works when app.yml has no url_scheme" {
  grep -v 'url_scheme' "${TMP}/app/.claude/app.yml" > "${TMP}/app.yml.new"
  cp "${TMP}/app.yml.new" "${TMP}/app/.claude/app.yml"
  cd "${TMP}/app"
  run bash "${SCAFFOLD}"
  [ "$status" -eq 0 ]
  [ -f fastlane/Fastfile ]
}

# --- CAT-53: --check gates on missing files only -----------------------------------

@test "--check exits 0 when a managed file merely drifted (edited listing)" {
  cd "${TMP}/app"
  bash "${SCAFFOLD}" >/dev/null
  echo "## my own section" >> marketing/app-store-listing.md
  run bash "${SCAFFOLD}" --check
  [ "$status" -eq 0 ]
  [[ "$output" == *"DRIFT: marketing/app-store-listing.md"* ]] || false
}

@test "--check exits 1 when a managed file is missing" {
  cd "${TMP}/app"
  bash "${SCAFFOLD}" >/dev/null
  rm fastlane/Fastfile
  run bash "${SCAFFOLD}" --check
  [ "$status" -eq 1 ]
  [[ "$output" == *"CREATE: fastlane/Fastfile (needed)"* ]] || false
  [ ! -f fastlane/Fastfile ]
}

@test "--check exits 1 and still reports DRIFT when both a file is missing and another drifted" {
  cd "${TMP}/app"
  bash "${SCAFFOLD}" >/dev/null
  echo "# edit" >> Gemfile
  rm fastlane/Fastfile
  run bash "${SCAFFOLD}" --check
  [ "$status" -eq 1 ]
  [[ "$output" == *"DRIFT: Gemfile"* ]] || false
}

# --- CAT-51: build.sh template --------------------------------------------------------

@test "scaffold renders an executable build.sh with app values and no unrendered tokens" {
  cd "${TMP}/app"
  run bash "${SCAFFOLD}"
  [ "$status" -eq 0 ]
  [[ "$output" == *"CREATE: build.sh"* ]] || false
  [ -x build.sh ]
  bash -n build.sh
  grep -q 'SCHEME="Demo"' build.sh
  grep -q 'BUNDLE_ID="com.example.demo"' build.sh
  grep -q 'TEAM_ID="ABCDE12345"' build.sh
  [ -z "$(grep '{{' build.sh || true)" ]
}

@test "scaffold honours app.build_script for the managed build script path" {
  python3 - "${TMP}/app/.claude/app.yml" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read().replace("  url_scheme: demo\n", "  url_scheme: demo\n  build_script: tools/build.sh\n")
open(p, "w").write(s)
PY
  cd "${TMP}/app"
  run bash "${SCAFFOLD}"
  [ "$status" -eq 0 ]
  [ -x tools/build.sh ]
  [ ! -e build.sh ]
}

@test "scaffold refuses an app.build_script that escapes the repo" {
  python3 - "${TMP}/app/.claude/app.yml" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read().replace("  url_scheme: demo\n", "  url_scheme: demo\n  build_script: ../evil.sh\n")
open(p, "w").write(s)
PY
  cd "${TMP}/app"
  run bash "${SCAFFOLD}"
  [ "$status" -ne 0 ]
  [[ "$output" == *"app.build_script"* ]] || false
  [ ! -e "${TMP}/evil.sh" ]
}

# Stubs for exercising the rendered build.sh without Xcode or a device.
build_stubs() {
  export XLOG="${TMP}/xlog"
  : > "${XLOG}"
  mkdir -p "${TMP}/stubs"
  cat > "${TMP}/stubs/xcodebuild" <<'SH'
#!/bin/sh
echo "xcodebuild $*" >> "${XLOG}"
case "$*" in
  *-showBuildSettings*)
    mkdir -p "${FAKE_PRODUCTS}/Demo.app"
    printf '    TARGET_BUILD_DIR = %s\n    FULL_PRODUCT_NAME = Demo.app\n' "${FAKE_PRODUCTS}" ;;
esac
exit 0
SH
  cat > "${TMP}/stubs/xcrun" <<'SH'
#!/bin/sh
echo "xcrun $*" >> "${XLOG}"
case "$*" in
  *"devicectl list devices"*)
    out=""; for a in "$@"; do [ "$prev" = "--json-output" ] && out="$a"; prev="$a"; done
    printf '{"result":{"devices":[{"identifier":"DEV-OFF","connectionProperties":{"tunnelState":"disconnected"}},{"identifier":"DEV-ON","connectionProperties":{"tunnelState":"connected"}}]}}' > "$out" ;;
esac
exit 0
SH
  chmod +x "${TMP}/stubs/xcodebuild" "${TMP}/stubs/xcrun"
  export FAKE_PRODUCTS="${TMP}/products"
  export PATH="${TMP}/stubs:${PATH}"
  export HOME="${TMP}/home"
  mkdir -p "${HOME}"
}

@test "rendered build.sh -s builds for a generic simulator and installs on the booted one" {
  cd "${TMP}/app"
  bash "${SCAFFOLD}" >/dev/null
  build_stubs
  run bash ./build.sh -s
  [ "$status" -eq 0 ]
  grep -q 'xcodebuild -scheme Demo -configuration Debug -destination generic/platform=iOS Simulator build' "${XLOG}"
  grep -q 'xcrun simctl install booted ' "${XLOG}"
  grep -q 'xcrun simctl launch booted com.example.demo' "${XLOG}"
}

@test "rendered build.sh -s <UDID> targets that simulator by id" {
  cd "${TMP}/app"
  bash "${SCAFFOLD}" >/dev/null
  build_stubs
  run bash ./build.sh -s 11111111-1111-1111-1111-111111111111
  [ "$status" -eq 0 ]
  grep -q 'destination platform=iOS Simulator,id=11111111-1111-1111-1111-111111111111' "${XLOG}"
  grep -q 'xcrun simctl launch 11111111-1111-1111-1111-111111111111 com.example.demo' "${XLOG}"
}

@test "rendered build.sh -s <name> targets that simulator by name" {
  cd "${TMP}/app"
  bash "${SCAFFOLD}" >/dev/null
  build_stubs
  run bash ./build.sh -s "iPhone 17"
  [ "$status" -eq 0 ]
  grep -q 'destination platform=iOS Simulator,name=iPhone 17' "${XLOG}"
}

@test "rendered build.sh --no-launch builds only" {
  cd "${TMP}/app"
  bash "${SCAFFOLD}" >/dev/null
  build_stubs
  run bash ./build.sh --no-launch
  [ "$status" -eq 0 ]
  grep -q '^xcodebuild .* build$' "${XLOG}"
  [ -z "$(grep -e 'simctl' -e 'devicectl' "${XLOG}" || true)" ]
}

@test "rendered build.sh -d --debug builds Debug for device and installs via devicectl on the connected device" {
  cd "${TMP}/app"
  bash "${SCAFFOLD}" >/dev/null
  build_stubs
  run bash ./build.sh -d --debug
  [ "$status" -eq 0 ]
  grep -q 'configuration Debug -destination generic/platform=iOS DEVELOPMENT_TEAM=ABCDE12345 -allowProvisioningUpdates build' "${XLOG}"
  grep -q 'devicectl device install app --device DEV-ON ' "${XLOG}"
  grep -q 'devicectl device process launch --device DEV-ON com.example.demo' "${XLOG}"
}

@test "rendered build.sh -d defaults to Release" {
  cd "${TMP}/app"
  bash "${SCAFFOLD}" >/dev/null
  build_stubs
  run bash ./build.sh -d
  [ "$status" -eq 0 ]
  grep -q 'configuration Release -destination generic/platform=iOS' "${XLOG}"
}

@test "rendered build.sh resolves the team from a matching provisioning profile when app.yml has none" {
  sed -i.bak 's/team_id: ABCDE12345/team_id: TODO/' "${TMP}/app/.claude/app.yml"
  rm -f "${TMP}/app/.claude/app.yml.bak"
  cd "${TMP}/app"
  bash "${SCAFFOLD}" >/dev/null
  build_stubs
  mkdir -p "${HOME}/Library/Developer/Xcode/UserData/Provisioning Profiles"
  : > "${HOME}/Library/Developer/Xcode/UserData/Provisioning Profiles/p.mobileprovision"
  cat > "${TMP}/stubs/security" <<'SH'
#!/bin/sh
cat <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>Entitlements</key><dict>
<key>application-identifier</key><string>ZZTEAM9999.com.example.demo</string>
</dict></dict></plist>
PLIST
SH
  chmod +x "${TMP}/stubs/security"
  run bash ./build.sh -d --no-launch
  [ "$status" -eq 0 ]
  grep -q 'DEVELOPMENT_TEAM=ZZTEAM9999' "${XLOG}"
}

@test "rendered build.sh rejects an unknown flag with exit 2 and builds nothing" {
  cd "${TMP}/app"
  bash "${SCAFFOLD}" >/dev/null
  build_stubs
  run bash ./build.sh --no-lanuch
  [ "$status" -eq 2 ]
  [[ "$output" == *"--no-launch"* ]] || false
  [ -z "$(cat "${XLOG}")" ]
}

@test "rendered build.sh at app.build_script tools/build.sh runs from the repo root" {
  python3 - "${TMP}/app/.claude/app.yml" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read().replace("  url_scheme: demo\n", "  url_scheme: demo\n  build_script: tools/build.sh\n")
open(p, "w").write(s)
PY
  cd "${TMP}/app"
  bash "${SCAFFOLD}" >/dev/null
  [ -x tools/build.sh ]
  build_stubs
  cat > "${TMP}/stubs/xcodegen" <<'SH'
#!/bin/sh
pwd -P > "${XLOG}.xcodegen.pwd"
exit 0
SH
  chmod +x "${TMP}/stubs/xcodegen"
  mkdir -p "${TMP}/elsewhere"
  cd "${TMP}/elsewhere"
  run bash "${TMP}/app/tools/build.sh" --no-launch
  [ "$status" -eq 0 ]
  [ -f "${XLOG}.xcodegen.pwd" ]
  [ "$(cat "${XLOG}.xcodegen.pwd")" = "$(cd "${TMP}/app" && pwd -P)" ]
}

# --- G-33: path-scoped symptom -> skill rules file -----------------------------------

@test "scaffold creates a **/*.swift path-scoped lessons rule with at least 10 symptom rows" {
  cd "${TMP}/app"
  bash "${SCAFFOLD}" >/dev/null
  RULE=.claude/rules/swift-lessons-by-symptom.md
  [ -f "${RULE}" ]
  [ "$(sed -n '1p' "${RULE}")" = "---" ]
  grep -q '^paths:' "${RULE}"
  grep -qF -- '- "**/*.swift"' "${RULE}"
  [ "$(grep -c '^| .* | `' "${RULE}")" -ge 10 ]
  [ -z "$(grep '{{' "${RULE}" || true)" ]
}

@test "every skill the lessons rule names exists in ios-dev" {
  cd "${TMP}/app"
  bash "${SCAFFOLD}" >/dev/null
  SKILLS="${BATS_TEST_DIRNAME}/../../plugins/ios-dev/skills"
  names="$(grep '^| .* | `' .claude/rules/swift-lessons-by-symptom.md | grep -o '`[a-z0-9-]*`' | tr -d '`' | sort -u)"
  [ -n "${names}" ]
  missing=""
  for n in ${names}; do [ -d "${SKILLS}/${n}" ] || missing="${missing} ${n}"; done
  [ -z "${missing}" ]
}

# --- G-49 part B: generated-file guard with settings wiring -----------------------------

guard_input() {  # $1 tool, $2 file path
  printf '{"tool_name":"%s","tool_input":{"file_path":"%s"}}' "$1" "$2"
}

@test "scaffold installs an executable guard-generated hook and wires it in settings.json" {
  cd "${TMP}/app"
  run bash "${SCAFFOLD}"
  [ "$status" -eq 0 ]
  [[ "$output" == *"CREATE: .claude/hooks/guard-generated.sh"* ]] || false
  [[ "$output" == *"CREATE: .claude/settings.json"* ]] || false
  [ -x .claude/hooks/guard-generated.sh ]
  python3 - <<'PY'
import json
d = json.load(open(".claude/settings.json"))
entry = d["hooks"]["PreToolUse"][0]
assert entry["matcher"] == "Edit|Write|MultiEdit", entry
assert "guard-generated.sh" in entry["hooks"][0]["command"], entry
PY
}

@test "an existing settings.json is never edited; scaffold says how to wire the hook" {
  cd "${TMP}/app"
  printf '{"permissions":{"allow":["Bash(ls)"]}}\n' > .claude/settings.json
  cp .claude/settings.json "${TMP}/settings.before"
  run bash "${SCAFFOLD}"
  [ "$status" -eq 0 ]
  [[ "$output" == *"SKIP: .claude/settings.json"* ]] || false
  cmp -s "${TMP}/settings.before" .claude/settings.json
}

@test "guard-generated blocks edits to a generated .xcodeproj (Edit, Write, MultiEdit, DerivedData)" {
  command -v jq >/dev/null || skip "jq not installed"
  cd "${TMP}/app"
  bash "${SCAFFOLD}" >/dev/null
  for case in "Edit|/x/Demo.xcodeproj/project.pbxproj" "Write|Demo.xcodeproj/project.pbxproj" \
              "MultiEdit|/x/Demo.xcodeproj" "Edit|/Users/me/Library/Developer/Xcode/DerivedData/Demo/x.swift"; do
    tool="${case%%|*}"; path="${case#*|}"
    run bash -c "printf '%s' '$(guard_input "${tool}" "${path}")' | bash .claude/hooks/guard-generated.sh"
    [ "$status" -eq 2 ]
    [[ "$output" == *"project.yml"* ]] || false
  done
}

@test "guard-generated allows project.yml, Swift sources and calls without a path" {
  command -v jq >/dev/null || skip "jq not installed"
  cd "${TMP}/app"
  bash "${SCAFFOLD}" >/dev/null
  for path in "/x/project.yml" "Sources/Demo/ContentView.swift" "/x/Demo.xcodeprojectNotes.md"; do
    run bash -c "printf '%s' '$(guard_input Edit "${path}")' | bash .claude/hooks/guard-generated.sh"
    [ "$status" -eq 0 ]
  done
  run bash -c "printf '%s' '{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"ls\"}}' | bash .claude/hooks/guard-generated.sh"
  [ "$status" -eq 0 ]
}

@test "guard-generated fails closed when jq is missing, even for an allowed path" {
  cd "${TMP}/app"
  bash "${SCAFFOLD}" >/dev/null
  mkdir -p "${TMP}/nobin"
  run env PATH="${TMP}/nobin" /bin/bash -c "printf '%s' '$(guard_input Edit /x/project.yml)' | /bin/bash .claude/hooks/guard-generated.sh"
  [ "$status" -eq 2 ]
  [[ "$output" == *"jq"* ]] || false
}

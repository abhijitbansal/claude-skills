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

@test "scaffold refuses to render values with shell metacharacters" {
  cd "${TMP}/app"
  sed -i.bak 's/name: Demo/name: Demo`evil`/' .claude/app.yml && rm -f .claude/app.yml.bak
  run bash "${SCAFFOLD}"
  [ "$status" -ne 0 ]
  [[ "$output" == *"unsafe"* ]]
  [ ! -f fastlane/Fastfile ]
}

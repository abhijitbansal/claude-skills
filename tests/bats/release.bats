#!/usr/bin/env bats

load helpers

setup() {
  TMP="$(mktemp -d)"
}

teardown() { rm -rf "${TMP}"; }

@test "release.sh refuses without .claude/app.yml" {
  cd "${TMP}"  # tmp dir with no .claude/app.yml — use whatever setup is available
  run bash "${BATS_TEST_DIRNAME}/../../plugins/ios-dev/skills/release/scripts/release.sh" testflight
  [ "$status" -ne 0 ]
  [[ "$output" == *"app.yml"* ]]
}

@test "release.sh rejects unknown mode with usage" {
  make_fixture_app "${TMP}/app"
  cd "${TMP}/app"
  run bash "${BATS_TEST_DIRNAME}/../../plugins/ios-dev/skills/release/scripts/release.sh" banana
  [ "$status" -eq 2 ]
  [[ "$output" == *"usage:"* ]]
}

@test "release.sh credential block exports ASC_* from config; pre-set ASC_* values win" {
  local rs="${BATS_TEST_DIRNAME}/../../plugins/ios-dev/skills/release/scripts/release.sh"
  mkdir -p "${TMP}/home/.app-store-connect"
  printf 'KEY_ID=FAKEKEY123\nISSUER_ID=fake-issuer-uuid\n' > "${TMP}/home/.app-store-connect/config"
  # Extract just the credential function; sourcing the whole script would run the pipeline.
  sed -n '/^load_asc_credentials() {/,/^}/p' "${rs}" > "${TMP}/cred.sh"
  [ -s "${TMP}/cred.sh" ]
  # Print from a CHILD process so a dropped `export` shows up as empty fields.
  cat > "${TMP}/probe.sh" <<'EOF'
source "$1"
load_asc_credentials
bash -c 'printf "%s|%s|%s\n" "${ASC_KEY_ID-}" "${ASC_ISSUER_ID-}" "${ASC_KEY_PATH-}"'
EOF

  run env -u ASC_KEY_ID -u ASC_ISSUER_ID -u ASC_KEY_PATH -u API_PRIVATE_KEYS_DIR \
    HOME="${TMP}/home" bash "${TMP}/probe.sh" "${TMP}/cred.sh"
  [ "$status" -eq 0 ]
  [ "$output" = "FAKEKEY123|fake-issuer-uuid|${TMP}/home/.app-store-connect/AuthKey_FAKEKEY123.p8" ]

  run env -u ASC_ISSUER_ID -u ASC_KEY_PATH -u API_PRIVATE_KEYS_DIR \
    ASC_KEY_ID=PRESET HOME="${TMP}/home" bash "${TMP}/probe.sh" "${TMP}/cred.sh"
  [ "$status" -eq 0 ]
  [ "$output" = "PRESET|fake-issuer-uuid|${TMP}/home/.app-store-connect/AuthKey_PRESET.p8" ]

  run env -u ASC_KEY_ID -u ASC_KEY_PATH -u API_PRIVATE_KEYS_DIR \
    ASC_ISSUER_ID=PRESET-ISSUER HOME="${TMP}/home" bash "${TMP}/probe.sh" "${TMP}/cred.sh"
  [ "$status" -eq 0 ]
  [ "$output" = "FAKEKEY123|PRESET-ISSUER|${TMP}/home/.app-store-connect/AuthKey_FAKEKEY123.p8" ]

  run env -u ASC_KEY_ID -u ASC_ISSUER_ID -u API_PRIVATE_KEYS_DIR \
    ASC_KEY_PATH=/custom/AuthKey_OTHER.p8 HOME="${TMP}/home" bash "${TMP}/probe.sh" "${TMP}/cred.sh"
  [ "$status" -eq 0 ]
  [ "$output" = "FAKEKEY123|fake-issuer-uuid|/custom/AuthKey_OTHER.p8" ]
}

@test "release.sh stops at preflight FAIL on dirty tree" {
  make_fixture_app "${TMP}/app"
  cd "${TMP}/app"
  touch dirty.txt
  export PREFLIGHT_SKIP_TOOLCHAIN=1
  export PREFLIGHT_PLIST="${TMP}/app/build/gen/Demo-Info.plist"
  export PREFLIGHT_ENTITLEMENTS_DIR="${TMP}/app/build/gen"
  run bash "${BATS_TEST_DIRNAME}/../../plugins/ios-dev/skills/release/scripts/release.sh" testflight --dry-run
  [ "$status" -ne 0 ]
  [[ "$output" == *"FAIL: tree-clean"* ]]
}

# ---------------------------------------------------------------------------
# Full-flow cases. Everything runs in a temp repo with a fake HOME (fake ASC
# credentials), stubbed xcodebuild/xcrun/bundle first on PATH and stdin from
# /dev/null: nothing builds, uploads, tags or pushes for real.
# ---------------------------------------------------------------------------

RELEASE="${BATS_TEST_DIRNAME}/../../plugins/ios-dev/skills/release/scripts/release.sh"
NOTES_SH="${BATS_TEST_DIRNAME}/../../plugins/ios-dev/skills/release/scripts/release_notes.sh"

setup_release_env() {  # $1 = "nokey" to leave the .p8 out of the fake HOME
  make_fixture_app "${TMP}/app"
  make_fake_asc_home "${TMP}/home" "${1:-}"
  make_release_stubs "${TMP}/shim"
  export HOME="${TMP}/home"
  export PATH="${TMP}/shim:${PATH}"
  export PREFLIGHT_SKIP_TOOLCHAIN=1
  export PREFLIGHT_PLIST="${TMP}/app/build/gen/Demo-Info.plist"
  export PREFLIGHT_ENTITLEMENTS_DIR="${TMP}/app/build/gen"
  export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
  unset ASC_KEY_ID ASC_ISSUER_ID ASC_KEY_PATH API_PRIVATE_KEYS_DIR KEY_ID ISSUER_ID XCODEBUILD_FLAGS
  cd "${TMP}/app"
}

commit_all() { git add -A && git commit -qm "$1"; }

add_hooks() {  # committed, executable hooks that log "<name> <mode>" to ${TMP}/hooks.log
  mkdir -p scripts/release-hooks
  for h in "$@"; do
    printf '#!/bin/sh\necho "%s $1" >> "%s/hooks.log"\n' "${h}" "${TMP}" > "scripts/release-hooks/${h}.sh"
    chmod +x "scripts/release-hooks/${h}.sh"
  done
  commit_all hooks
}

@test "--dry-run stops before upload and names --confirm-upload" {
  setup_release_env
  run bash "${RELEASE}" testflight --dry-run < /dev/null
  [ "$status" -eq 0 ]
  out_has "--confirm-upload"
  run cat "${MOCK_CALL_LOG}"
  out_lacks "--upload-app"
}

@test "an upload without --confirm-upload is refused, names the flag, and uploads nothing" {
  setup_release_env
  run bash "${RELEASE}" testflight < /dev/null
  [ "$status" -eq 1 ]
  out_has "--confirm-upload"
  run cat "${MOCK_CALL_LOG}"
  out_lacks "--upload-app"
}

@test "--confirm-upload uploads and tags exactly once, warning when release notes are missing" {
  setup_release_env
  run bash "${RELEASE}" testflight --confirm-upload < /dev/null
  [ "$status" -eq 0 ]
  out_has "WARN: no release notes"
  [ "$(git tag --list)" = "v1.2.0-b34" ]
  run cat "${MOCK_CALL_LOG}"
  out_has "--upload-app"
}

@test "the tag is annotated with the release-notes draft when it exists" {
  setup_release_env
  echo a > a.txt && commit_all $'feat: A\n\nRelease-Note: Did A.'
  run bash "${NOTES_SH}" 1.2.0
  [ "$status" -eq 0 ]
  run bash "${RELEASE}" testflight --confirm-upload < /dev/null
  [ "$status" -eq 0 ]
  out_lacks "WARN: no release notes"
  run git tag -n1 --list v1.2.0-b34
  out_has "Did A."
}

@test "release.testflight_tag_format sets the TestFlight tag name" {
  setup_release_env
  printf '  testflight_tag_format: v{version}-build{build}\n' >> .claude/app.yml
  commit_all cfg
  run bash "${RELEASE}" testflight --confirm-upload < /dev/null
  [ "$status" -eq 0 ]
  [ "$(git tag --list)" = "v1.2.0-build34" ]
}

@test "an invalid release.testflight_tag_format fails before anything is built or uploaded" {
  setup_release_env
  printf '  testflight_tag_format: nobraces\n' >> .claude/app.yml
  commit_all cfg
  run bash "${RELEASE}" testflight --confirm-upload < /dev/null
  [ "$status" -ne 0 ]
  out_has "{version}"
  run cat "${MOCK_CALL_LOG}"
  out_lacks "xcodebuild"
  out_lacks "--upload-app"
}

@test "an existing tag is left alone instead of failing the run after the upload" {
  setup_release_env
  git tag v1.2.0-b34
  run bash "${RELEASE}" testflight --confirm-upload < /dev/null
  [ "$status" -eq 0 ]
  out_has "already exists"
}

@test "appstore mode tags v<version> and forwards --next-version to the gates" {
  setup_release_env
  run bash "${RELEASE}" appstore --confirm-upload --next-version 1.2.0 < /dev/null
  [ "$status" -eq 0 ]
  out_has "PASS: whatsnew"
  [ "$(git tag --list)" = "v1.2.0" ]
}

@test "--next-version reaches preflight: a version with no whatsnew entry FAILs in appstore mode" {
  setup_release_env
  run bash "${RELEASE}" appstore --dry-run --next-version 9.9.9 < /dev/null
  [ "$status" -ne 0 ]
  out_has "FAIL: whatsnew: no entry for 9.9.9"
}

@test "--next-version without a value exits 2 with usage" {
  setup_release_env
  run bash "${RELEASE}" testflight --next-version < /dev/null
  [ "$status" -eq 2 ]
  out_has "--next-version"
}

@test "unknown flags still exit 2" {
  setup_release_env
  run bash "${RELEASE}" testflight --bogus < /dev/null
  [ "$status" -eq 2 ]
}

@test "s1 hooks run before preflight, even on a dry run" {
  setup_release_env
  add_hooks s1-pre s1-post
  run bash "${RELEASE}" testflight --dry-run < /dev/null
  [ "$status" -eq 0 ]
  run cat "${TMP}/hooks.log"
  [ "${lines[0]}" = "s1-pre testflight" ]
  [ "${lines[1]}" = "s1-post testflight" ]
}

@test "every stage hook runs in order, s7 around the tag" {
  setup_release_env
  add_hooks s1-pre s1-post s5-pre s5-post s6-pre s6-post s7-pre s7-post
  run bash "${RELEASE}" testflight --confirm-upload < /dev/null
  [ "$status" -eq 0 ]
  run cat "${TMP}/hooks.log"
  [ "${#lines[@]}" -eq 8 ]
  [ "${lines[0]}" = "s1-pre testflight" ]
  [ "${lines[1]}" = "s1-post testflight" ]
  [ "${lines[6]}" = "s7-pre testflight" ]
  [ "${lines[7]}" = "s7-post testflight" ]
}

@test "a hook file that is not executable is reported, not silently skipped" {
  setup_release_env
  mkdir -p scripts/release-hooks
  printf '#!/bin/sh\nexit 1\n' > scripts/release-hooks/s1-pre.sh
  commit_all hook
  run bash "${RELEASE}" testflight --dry-run < /dev/null
  [ "$status" -eq 0 ]
  out_has "not executable"
}

@test "a missing AuthKey .p8 stops before the build and never prints the key id" {
  setup_release_env nokey
  run bash "${RELEASE}" testflight --dry-run < /dev/null
  [ "$status" -eq 1 ]
  out_has "AuthKey_<KEY_ID>.p8"
  out_lacks "FAKEKEY123"
  run cat "${MOCK_CALL_LOG}"
  out_lacks "xcodebuild"
}

@test "XCODEBUILD_FLAGS is passed to the fallback archive and export" {
  setup_release_env
  export XCODEBUILD_FLAGS="-derivedDataPath ${TMP}/dd"
  run bash "${RELEASE}" testflight --dry-run < /dev/null
  [ "$status" -eq 0 ]
  [ "$(grep -c -e "-derivedDataPath ${TMP}/dd" "${MOCK_CALL_LOG}")" -eq 2 ]
}

@test "a dry run writes the ASC paste pack" {
  setup_release_env
  run bash "${RELEASE}" testflight --dry-run < /dev/null
  [ "$status" -eq 0 ]
  [ -f .scratch/release/asc-paste-1.2.0.md ]
  # The pack must not dirty the app repo: the real run's tree-clean gate follows.
  run git status --porcelain
  out_lacks ".scratch"
}

@test "--confirm-upload reuses the IPA a dry run built for the same HEAD (one archive, not two)" {
  setup_release_env
  printf 'build/Demo.ipa\nbuild/ExportOptions.plist\n' >> .git/info/exclude
  run bash "${RELEASE}" testflight --dry-run < /dev/null
  [ "$status" -eq 0 ]
  run bash "${RELEASE}" testflight --confirm-upload < /dev/null
  [ "$status" -eq 0 ]
  out_has "reusing build/Demo.ipa"
  [ "$(grep -c "^xcodebuild archive" "${MOCK_CALL_LOG}")" -eq 1 ]
  # The reused IPA is still validated and uploaded.
  [ "$(grep -c -e "--validate-app" "${MOCK_CALL_LOG}")" -eq 2 ]
  [ "$(grep -c -e "--upload-app" "${MOCK_CALL_LOG}")" -eq 1 ]
}

@test "--confirm-upload rebuilds when HEAD moved since the IPA was built" {
  setup_release_env
  printf 'build/Demo.ipa\nbuild/ExportOptions.plist\n' >> .git/info/exclude
  run bash "${RELEASE}" testflight --dry-run < /dev/null
  [ "$status" -eq 0 ]
  echo b > b.txt && commit_all "feat: B"
  run bash "${RELEASE}" testflight --confirm-upload < /dev/null
  [ "$status" -eq 0 ]
  out_lacks "reusing build/Demo.ipa"
  [ "$(grep -c "^xcodebuild archive" "${MOCK_CALL_LOG}")" -eq 2 ]
}

@test "--force never reuses a previously built IPA" {
  setup_release_env
  printf 'build/Demo.ipa\nbuild/ExportOptions.plist\n' >> .git/info/exclude
  run bash "${RELEASE}" testflight --dry-run < /dev/null
  [ "$status" -eq 0 ]
  run bash "${RELEASE}" testflight --confirm-upload --force < /dev/null
  [ "$status" -eq 0 ]
  out_lacks "reusing build/Demo.ipa"
  [ "$(grep -c "^xcodebuild archive" "${MOCK_CALL_LOG}")" -eq 2 ]
}

@test "an IPA built under --force is never reused by a later non-forced --confirm-upload" {
  # W2M-M04: a forced build may come from a dirty tree (preflight FAILs bypassed);
  # it must not leave a stamp that a clean --confirm-upload run then trusts.
  setup_release_env
  printf 'build/Demo.ipa\nbuild/ExportOptions.plist\n' >> .git/info/exclude
  run bash "${RELEASE}" testflight --dry-run --force < /dev/null
  [ "$status" -eq 0 ]
  run bash "${RELEASE}" testflight --confirm-upload < /dev/null
  [ "$status" -eq 0 ]
  out_lacks "reusing build/Demo.ipa"
  [ "$(grep -c "^xcodebuild archive" "${MOCK_CALL_LOG}")" -eq 2 ]
}

@test "a dry run followed by --confirm-upload still passes the tree-clean gate" {
  setup_release_env
  # Real apps gitignore their build outputs; the fixture commits build/gen, so
  # exclude only the stub archive outputs. .scratch/ is deliberately NOT excluded.
  printf 'build/Demo.ipa\nbuild/ExportOptions.plist\n' >> .git/info/exclude
  run bash "${RELEASE}" testflight --dry-run < /dev/null
  [ "$status" -eq 0 ]
  run bash "${RELEASE}" testflight --confirm-upload < /dev/null
  [ "$status" -eq 0 ]
  out_lacks "tree-clean: uncommitted changes"
}

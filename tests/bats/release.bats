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

@test "release.sh credential block exports ASC_* from config; pre-set ASC_KEY_ID wins" {
  local rs="${BATS_TEST_DIRNAME}/../../plugins/ios-dev/skills/release/scripts/release.sh"
  mkdir -p "${TMP}/home/.app-store-connect"
  printf 'KEY_ID=FAKEKEY123\nISSUER_ID=fake-issuer-uuid\n' > "${TMP}/home/.app-store-connect/config"
  # Extract just the credential function; sourcing the whole script would run the pipeline.
  sed -n '/^load_asc_credentials() {/,/^}/p' "${rs}" > "${TMP}/cred.sh"
  [ -s "${TMP}/cred.sh" ]
  cat > "${TMP}/probe.sh" <<'EOF'
source "$1"
load_asc_credentials
printf '%s|%s|%s\n' "${ASC_KEY_ID}" "${ASC_ISSUER_ID}" "${ASC_KEY_PATH}"
EOF

  run env -u ASC_KEY_ID -u ASC_ISSUER_ID -u ASC_KEY_PATH -u API_PRIVATE_KEYS_DIR \
    HOME="${TMP}/home" bash "${TMP}/probe.sh" "${TMP}/cred.sh"
  [ "$status" -eq 0 ]
  [ "$output" = "FAKEKEY123|fake-issuer-uuid|${TMP}/home/.app-store-connect/AuthKey_FAKEKEY123.p8" ]

  run env -u ASC_ISSUER_ID -u ASC_KEY_PATH -u API_PRIVATE_KEYS_DIR \
    ASC_KEY_ID=PRESET HOME="${TMP}/home" bash "${TMP}/probe.sh" "${TMP}/cred.sh"
  [ "$status" -eq 0 ]
  [ "$output" = "PRESET|fake-issuer-uuid|${TMP}/home/.app-store-connect/AuthKey_FAKEKEY123.p8" ]
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

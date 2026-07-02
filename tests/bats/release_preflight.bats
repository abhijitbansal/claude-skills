#!/usr/bin/env bats

load helpers

setup() {
  TMP="$(mktemp -d)"
  PREFLIGHT="${BATS_TEST_DIRNAME}/../../plugins/ios-dev/skills/release/scripts/preflight.sh"
  make_fixture_app "${TMP}/app"
  export PREFLIGHT_PLIST="${TMP}/app/build/gen/Demo-Info.plist"
  export PREFLIGHT_ENTITLEMENTS_DIR="${TMP}/app/build/gen"
  export PREFLIGHT_SKIP_TOOLCHAIN=1   # skips xcodegen/signing checks needing Xcode
}
teardown() { rm -rf "${TMP}"; }

@test "clean fixture passes preflight" {
  cd "${TMP}/app"
  run bash "${PREFLIGHT}" --mode testflight
  [ "$status" -eq 0 ]
  [[ "$output" == *"PASS: tree-clean"* ]]
  [[ "$output" == *"PASS: usage-strings"* ]]
  [[ "$output" == *"PASS: encryption-flag"* ]]
  [[ "$output" == *"PASS: entitlement-parity"* ]]
}

@test "dirty tree FAILs tree-clean" {
  cd "${TMP}/app"; touch dirty.txt
  run bash "${PREFLIGHT}" --mode testflight
  [ "$status" -eq 1 ]
  [[ "$output" == *"FAIL: tree-clean"* ]]
}

@test "missing usage string FAILs usage-strings" {
  cd "${TMP}/app"
  sed -i.bak '/NSCameraUsageDescription/,+1d' "${PREFLIGHT_PLIST}"
  rm -f "${PREFLIGHT_PLIST}.bak"
  git add -A && git -c user.email=t@t -c user.name=t commit -qm plist
  run bash "${PREFLIGHT}" --mode testflight
  [ "$status" -eq 1 ]
  [[ "$output" == *"FAIL: usage-strings: NSCameraUsageDescription"* ]]
}

@test "missing ITSAppUsesNonExemptEncryption FAILs encryption-flag" {
  cd "${TMP}/app"
  sed -i.bak '/ITSAppUsesNonExemptEncryption/,+1d' "${PREFLIGHT_PLIST}"
  rm -f "${PREFLIGHT_PLIST}.bak"
  git add -A && git -c user.email=t@t -c user.name=t commit -qm plist
  run bash "${PREFLIGHT}" --mode testflight
  [ "$status" -eq 1 ]
  [[ "$output" == *"FAIL: encryption-flag"* ]]
}

@test "app-group mismatch across targets FAILs entitlement-parity" {
  cd "${TMP}/app"
  printf 'group.com.example.OTHER\n' > "${PREFLIGHT_ENTITLEMENTS_DIR}/DemoWidget.entitlements.groups"
  git add -A && git -c user.email=t@t -c user.name=t commit -qm ent
  run bash "${PREFLIGHT}" --mode testflight
  [ "$status" -eq 1 ]
  [[ "$output" == *"FAIL: entitlement-parity: DemoWidget"* ]]
}

@test "wrong font count FAILs fonts when fonts_expected > 0" {
  cd "${TMP}/app"
  sed -i.bak 's/fonts_expected: 0/fonts_expected: 2/' .claude/app.yml
  rm -f .claude/app.yml.bak
  touch Sources/One.ttf
  git add -A && git -c user.email=t@t -c user.name=t commit -qm fonts
  run bash "${PREFLIGHT}" --mode testflight
  [ "$status" -eq 1 ]
  [[ "$output" == *"FAIL: fonts: expected 2"* ]]
}

@test "heavy work in App entry point WARNs runtime-trap, does not FAIL" {
  cd "${TMP}/app"
  cat > Sources/DemoApp.swift <<'SWIFT'
@main struct DemoApp: App {
    init() {
        EmbeddingIndex.shared.backfill()
    }
}
SWIFT
  git add -A && git -c user.email=t@t -c user.name=t commit -qm swift
  run bash "${PREFLIGHT}" --mode testflight
  [ "$status" -eq 0 ]
  [[ "$output" == *"WARN: runtime-trap"* ]]
  [[ "$output" == *"DemoApp.swift"* ]]
  [[ "$output" == *"mainactor-launch-watchdog-audit"* ]]
}

@test "Task.detached-wrapped heavy work does not WARN runtime-trap" {
  cd "${TMP}/app"
  cat > Sources/DemoApp.swift <<'SWIFT'
@main struct DemoApp: App {
    init() {
        Task.detached(priority: .utility) { EmbeddingIndex.shared.backfill() }
    }
}
SWIFT
  git add -A && git -c user.email=t@t -c user.name=t commit -qm swift
  run bash "${PREFLIGHT}" --mode testflight
  [ "$status" -eq 0 ]
  [[ "$output" != *"WARN: runtime-trap"* ]]
}

@test "appstore mode FAILs when whatsnew has no entry for next version" {
  cd "${TMP}/app"
  run bash "${PREFLIGHT}" --mode appstore --next-version 1.3.0
  [ "$status" -eq 1 ]
  [[ "$output" == *"FAIL: whatsnew: no entry for 1.3.0"* ]]
}

@test "testflight mode only WARNs on missing whatsnew entry" {
  cd "${TMP}/app"
  run bash "${PREFLIGHT}" --mode testflight --next-version 1.3.0
  [ "$status" -eq 0 ]
  [[ "$output" == *"WARN: whatsnew"* ]]
}

@test "whatsnew entry present PASSes in appstore mode" {
  cd "${TMP}/app"
  run bash "${PREFLIGHT}" --mode appstore --next-version 1.2.0
  [ "$status" -eq 0 ]
  [[ "$output" == *"PASS: whatsnew"* ]]
}

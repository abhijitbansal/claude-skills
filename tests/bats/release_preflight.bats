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
  [[ "$output" == *"PASS: nfc-entitlement"* ]]
  [[ "$output" == *"PASS: ipad-orientation"* ]]
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

@test "inapp-whatsnew PASSes when release.inapp_changelog_file is unset" {
  cd "${TMP}/app"
  run bash "${PREFLIGHT}" --mode testflight --next-version 1.3.0
  [ "$status" -eq 0 ]
  [[ "$output" == *"PASS: inapp-whatsnew"* ]]
}

@test "appstore mode FAILs when inapp_changelog_file configured but missing entry" {
  cd "${TMP}/app"
  printf '  inapp_changelog_file: Sources/Changelog.swift\n' >> .claude/app.yml
  printf 'let x = 1\n' > Sources/Changelog.swift
  git add -A && git -c user.email=t@t -c user.name=t commit -qm inapp
  run bash "${PREFLIGHT}" --mode appstore --next-version 1.3.0
  [ "$status" -eq 1 ]
  [[ "$output" == *"FAIL: inapp-whatsnew: no ChangelogEntry for 1.3.0"* ]]
}

@test "testflight mode only WARNs on missing inapp_changelog_file entry" {
  cd "${TMP}/app"
  printf '  inapp_changelog_file: Sources/Changelog.swift\n' >> .claude/app.yml
  printf 'let x = 1\n' > Sources/Changelog.swift
  git add -A && git -c user.email=t@t -c user.name=t commit -qm inapp
  run bash "${PREFLIGHT}" --mode testflight --next-version 1.3.0
  [ "$status" -eq 0 ]
  [[ "$output" == *"WARN: inapp-whatsnew"* ]]
}

@test "inapp_changelog_file entry present PASSes in appstore mode" {
  cd "${TMP}/app"
  printf '  inapp_changelog_file: Sources/Changelog.swift\n' >> .claude/app.yml
  printf 'let entry = ChangelogEntry(version: "1.2.0")\n' > Sources/Changelog.swift
  git add -A && git -c user.email=t@t -c user.name=t commit -qm inapp
  run bash "${PREFLIGHT}" --mode appstore --next-version 1.2.0
  [ "$status" -eq 0 ]
  [[ "$output" == *"PASS: inapp-whatsnew"* ]]
}

@test "NDEF NFC entitlement FAILs nfc-entitlement (ITMS-90778)" {
  cd "${TMP}/app"
  cat > App.entitlements <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>com.apple.developer.nfc.readersession.formats</key>
  <array><string>NDEF</string></array>
</dict></plist>
PLIST
  export PREFLIGHT_ENTITLEMENTS_FILE="${TMP}/app/App.entitlements"
  git add -A && git -c user.email=t@t -c user.name=t commit -qm ent
  run bash "${PREFLIGHT}" --mode testflight
  [ "$status" -eq 1 ]
  [[ "$output" == *"FAIL: nfc-entitlement"* ]]
  [[ "$output" == *"ITMS-90778"* ]]
}

@test "TAG NFC entitlement PASSes nfc-entitlement" {
  cd "${TMP}/app"
  cat > App.entitlements <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>com.apple.developer.nfc.readersession.formats</key>
  <array><string>TAG</string></array>
</dict></plist>
PLIST
  export PREFLIGHT_ENTITLEMENTS_FILE="${TMP}/app/App.entitlements"
  git add -A && git -c user.email=t@t -c user.name=t commit -qm ent
  run bash "${PREFLIGHT}" --mode testflight
  [ "$status" -eq 0 ]
  [[ "$output" == *"PASS: nfc-entitlement"* ]]
}

@test "universal app without iPad orientations FAILs ipad-orientation (ITMS-90474)" {
  cd "${TMP}/app"
  printf '  TARGETED_DEVICE_FAMILY: "1,2"\n' >> project.yml
  git add -A && git -c user.email=t@t -c user.name=t commit -qm universal
  run bash "${PREFLIGHT}" --mode testflight
  [ "$status" -eq 1 ]
  [[ "$output" == *"FAIL: ipad-orientation"* ]]
  [[ "$output" == *"ITMS-90474"* ]]
}

@test "universal app with all 4 iPad orientations PASSes ipad-orientation" {
  cd "${TMP}/app"
  printf '  TARGETED_DEVICE_FAMILY: "1,2"\n' >> project.yml
  cat > "${PREFLIGHT_PLIST}" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>NSCameraUsageDescription</key><string>Scan documents.</string>
  <key>ITSAppUsesNonExemptEncryption</key><false/>
  <key>UISupportedInterfaceOrientations~ipad</key>
  <array>
    <string>UIInterfaceOrientationPortrait</string>
    <string>UIInterfaceOrientationPortraitUpsideDown</string>
    <string>UIInterfaceOrientationLandscapeLeft</string>
    <string>UIInterfaceOrientationLandscapeRight</string>
  </array>
</dict></plist>
PLIST
  git add -A && git -c user.email=t@t -c user.name=t commit -qm universal
  run bash "${PREFLIGHT}" --mode testflight
  [ "$status" -eq 0 ]
  [[ "$output" == *"PASS: ipad-orientation"* ]]
}

@test "iPhone-only app PASSes ipad-orientation without declaring iPad orientations" {
  cd "${TMP}/app"
  printf '  TARGETED_DEVICE_FAMILY: "1"\n' >> project.yml
  git add -A && git -c user.email=t@t -c user.name=t commit -qm iphone
  run bash "${PREFLIGHT}" --mode testflight
  [ "$status" -eq 0 ]
  [[ "$output" == *"PASS: ipad-orientation"* ]]
}

@test "binary Info.plist still PASSes usage-strings and encryption-flag" {
  command -v plutil >/dev/null 2>&1 || skip "plutil not available (Linux CI)"
  cd "${TMP}/app"
  plutil -convert binary1 "${PREFLIGHT_PLIST}"
  git add -A && git -c user.email=t@t -c user.name=t commit -qm binplist
  run bash "${PREFLIGHT}" --mode testflight
  [ "$status" -eq 0 ]
  [[ "$output" == *"PASS: usage-strings"* ]]
  [[ "$output" == *"PASS: encryption-flag"* ]]
}

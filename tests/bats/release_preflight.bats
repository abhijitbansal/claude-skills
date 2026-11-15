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
  sed -i.bak '/ITSAppUsesNonExemptEncryption/d' "${PREFLIGHT_PLIST}"
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

@test "inapp-whatsnew SKIPs (not PASS) when release.inapp_changelog_file is unset" {
  cd "${TMP}/app"
  run bash "${PREFLIGHT}" --mode testflight --next-version 1.3.0
  [ "$status" -eq 0 ]
  out_has "SKIP: inapp-whatsnew"
  out_lacks "PASS: inapp-whatsnew"
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

@test "binary plist without plutil falls back to python3 and still gates correctly" {
  cd "${TMP}/app"
  python3 - "${PREFLIGHT_PLIST}" <<'PY'
import plistlib, sys
with open(sys.argv[1], 'rb') as f:
    d = plistlib.load(f)
with open(sys.argv[1], 'wb') as f:
    plistlib.dump(d, f, fmt=plistlib.FMT_BINARY)
PY
  git add -A && git -c user.email=t@t -c user.name=t commit -qm binplist
  mkdir -p "${TMP}/shim"
  printf '#!/bin/sh\nexit 127\n' > "${TMP}/shim/plutil"
  chmod +x "${TMP}/shim/plutil"
  run env PATH="${TMP}/shim:${PATH}" bash "${PREFLIGHT}" --mode testflight
  [ "$status" -eq 0 ]
  [[ "$output" == *"WARN: plist-conversion"* ]]
  [[ "$output" == *"PASS: usage-strings"* ]]
  [[ "$output" == *"PASS: encryption-flag"* ]]
}

@test "unconvertible plist FAILs plist-conversion instead of false usage-strings results" {
  cd "${TMP}/app"
  printf 'not a plist at all\n' > "${PREFLIGHT_PLIST}"
  git add -A && git -c user.email=t@t -c user.name=t commit -qm badplist
  mkdir -p "${TMP}/shim"
  printf '#!/bin/sh\nexit 1\n' > "${TMP}/shim/plutil"
  chmod +x "${TMP}/shim/plutil"
  run env PATH="${TMP}/shim:${PATH}" bash "${PREFLIGHT}" --mode testflight
  [ "$status" -eq 1 ]
  [[ "$output" == *"FAIL: plist-conversion"* ]]
  [[ "$output" != *"FAIL: usage-strings"* ]]
}

@test "capabilities gate FAILs on unexpected capability even with a quote in the plist path" {
  cd "${TMP}/app"
  printf '  required_capabilities: [arm64]\n' >> .claude/app.yml
  mkdir -p "${TMP}/app/O'Brien"
  python3 - "${PREFLIGHT_PLIST}" "${TMP}/app/O'Brien/Demo-Info.plist" <<'PY'
import plistlib, sys
with open(sys.argv[1], 'rb') as f:
    d = plistlib.load(f)
d['UIRequiredDeviceCapabilities'] = ['arm64', 'lidar-depth-camera']
with open(sys.argv[2], 'wb') as f:
    plistlib.dump(d, f)
PY
  git add -A && git -c user.email=t@t -c user.name=t commit -qm caps
  export PREFLIGHT_PLIST="${TMP}/app/O'Brien/Demo-Info.plist"
  run bash "${PREFLIGHT}" --mode testflight
  [ "$status" -eq 1 ]
  [[ "$output" == *"FAIL: capabilities"* ]]
  [[ "$output" == *"lidar-depth-camera"* ]]
}

@test "python3 failure on nfc gate WARNs only, never PASSes" {
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
  PYREAL="$(command -v python3)"
  mkdir -p "${TMP}/shim"
  printf '#!/bin/sh\nif [ "$1" = "-c" ]; then exit 1; fi\nexec "%s" "$@"\n' "${PYREAL}" > "${TMP}/shim/python3"
  chmod +x "${TMP}/shim/python3"
  run env PATH="${TMP}/shim:${PATH}" bash "${PREFLIGHT}" --mode testflight
  [ "$status" -eq 0 ]
  [[ "$output" == *"WARN: nfc-entitlement"* ]]
  [[ "$output" != *"PASS: nfc-entitlement"* ]]
}

@test "mktemp failure FAILs plist-conversion, not usage-strings" {
  cd "${TMP}/app"
  mkdir -p "${TMP}/shim"
  printf '#!/bin/sh\necho "mktemp: failed" >&2\nexit 1\n' > "${TMP}/shim/mktemp"
  chmod +x "${TMP}/shim/mktemp"
  run env PATH="${TMP}/shim:${PATH}" bash "${PREFLIGHT}" --mode testflight
  [ "$status" -eq 1 ]
  [[ "$output" == *"FAIL: plist-conversion"* ]]
  [[ "$output" != *"FAIL: usage-strings"* ]]
}

# ---------------------------------------------------------------------------
# CAT-44 / G-14 / NEW-54: gates must not pass vacuously.
# ---------------------------------------------------------------------------

commit_all() { git add -A && git -c user.email=t@t -c user.name=t commit -qm "$1"; }

write_ent() {  # $1 path, then app-group ids
  local f="$1"; shift
  python3 - "${f}" "$@" <<'PY'
import plistlib, sys
with open(sys.argv[1], "wb") as out:
    plistlib.dump({"com.apple.security.application-groups": sys.argv[2:]}, out, fmt=plistlib.FMT_XML)
PY
}

# Drop the seeded .groups files and the env seam so only the producer can verify parity.
use_producer_only() {
  rm -f build/gen/*.entitlements.groups
  unset PREFLIGHT_ENTITLEMENTS_DIR
}

@test "entitlement-parity producer reads checked-in .entitlements (declared path and by name)" {
  cd "${TMP}/app"
  use_producer_only
  mkdir -p Demo Widget
  write_ent Demo/Demo.entitlements group.com.example.demo
  write_ent Widget/Widget.entitlements group.com.example.demo
  printf '    entitlements:\n      path: Widget/Widget.entitlements\n' >> project.yml
  commit_all producer
  run bash "${PREFLIGHT}" --mode appstore --next-version 1.2.0
  [ "$status" -eq 0 ]
  out_has "PASS: entitlement-parity"
}

@test "entitlement-parity producer FAILs an extension whose checked-in group differs" {
  cd "${TMP}/app"
  use_producer_only
  mkdir -p Demo Widget
  write_ent Demo/Demo.entitlements group.com.example.demo
  write_ent Widget/Widget.entitlements group.com.example.OTHER
  printf '    entitlements:\n      path: Widget/Widget.entitlements\n' >> project.yml
  commit_all producer
  run bash "${PREFLIGHT}" --mode testflight
  [ "$status" -eq 1 ]
  out_has "FAIL: entitlement-parity: DemoWidget"
}

@test "unverified entitlement-parity FAILs in appstore mode, WARNs in testflight" {
  cd "${TMP}/app"
  use_producer_only
  commit_all noparity
  run bash "${PREFLIGHT}" --mode appstore --next-version 1.2.0
  [ "$status" -eq 1 ]
  out_has "FAIL: entitlement-parity"
  out_has "unverified"
  run bash "${PREFLIGHT}" --mode testflight
  [ "$status" -eq 0 ]
  out_has "WARN: entitlement-parity"
  out_lacks "PASS: entitlement-parity"
}

@test "whatsnew gates print SKIP, never PASS, when --next-version is absent" {
  cd "${TMP}/app"
  printf '  inapp_changelog_file: Sources/Changelog.swift\n' >> .claude/app.yml
  printf 'let x = 1\n' > Sources/Changelog.swift
  commit_all inapp
  run bash "${PREFLIGHT}" --mode testflight
  [ "$status" -eq 0 ]
  out_has "SKIP: whatsnew"
  out_has "SKIP: inapp-whatsnew"
  out_lacks "PASS: whatsnew"
  out_lacks "PASS: inapp-whatsnew"
}

@test "generated plist is read from project.yml info.path when build/ has none" {
  cd "${TMP}/app"
  unset PREFLIGHT_PLIST
  rm -f build/gen/Demo-Info.plist
  mkdir -p Demo
  cat > Demo/Info.plist <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>NSCameraUsageDescription</key><string>Scan documents.</string>
  <key>ITSAppUsesNonExemptEncryption</key><false/>
</dict></plist>
PLIST
  python3 - <<'PY'
p = "project.yml"
s = open(p).read()
s = s.replace("  Demo:\n    type: application\n    platform: iOS\n",
              "  Demo:\n    type: application\n    platform: iOS\n    info:\n      path: Demo/Info.plist\n", 1)
open(p, "w").write(s)
PY
  commit_all infopath
  run bash "${PREFLIGHT}" --mode appstore --next-version 1.2.0
  [ "$status" -eq 0 ]
  out_has "PASS: usage-strings"
  out_has "PASS: encryption-flag"
}

@test "no plist anywhere FAILs usage-strings in appstore mode, WARNs in testflight" {
  cd "${TMP}/app"
  unset PREFLIGHT_PLIST
  rm -f build/gen/Demo-Info.plist
  commit_all noplist
  run bash "${PREFLIGHT}" --mode appstore --next-version 1.2.0
  [ "$status" -eq 1 ]
  out_has "FAIL: usage-strings"
  run bash "${PREFLIGHT}" --mode testflight
  [ "$status" -eq 0 ]
  out_has "WARN: usage-strings"
}

@test "empty required_capabilities with a capability in the plist FAILs appstore, WARNs testflight" {
  cd "${TMP}/app"
  python3 - "${PREFLIGHT_PLIST}" <<'PY'
import plistlib, sys
with open(sys.argv[1], 'rb') as f:
    d = plistlib.load(f)
d['UIRequiredDeviceCapabilities'] = ['arm64']
with open(sys.argv[1], 'wb') as f:
    plistlib.dump(d, f)
PY
  commit_all caps
  run bash "${PREFLIGHT}" --mode appstore --next-version 1.2.0
  [ "$status" -eq 1 ]
  out_has "FAIL: capabilities"
  out_has "arm64"
  run bash "${PREFLIGHT}" --mode testflight
  [ "$status" -eq 0 ]
  out_has "WARN: capabilities"
}

@test "empty required_capabilities and no capability in the plist PASSes capabilities" {
  cd "${TMP}/app"
  run bash "${PREFLIGHT}" --mode appstore --next-version 1.2.0
  [ "$status" -eq 0 ]
  out_has "PASS: capabilities"
}

@test "nfc-entitlement inspects every .entitlements file, not just the first" {
  cd "${TMP}/app"
  unset PREFLIGHT_ENTITLEMENTS_FILE
  mkdir -p A B C D
  for d in A B C; do
    cat > "${d}/${d}.entitlements" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>com.apple.developer.nfc.readersession.formats</key>
  <array><string>TAG</string></array>
</dict></plist>
PLIST
  done
  cat > D/D.entitlements <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>com.apple.developer.nfc.readersession.formats</key>
  <array><string>NDEF</string></array>
</dict></plist>
PLIST
  commit_all nfc
  run bash "${PREFLIGHT}" --mode testflight
  [ "$status" -eq 1 ]
  out_has "FAIL: nfc-entitlement"
  out_has "D/D.entitlements"
}

@test "missing TARGETED_DEVICE_FAMILY is treated as universal and checks iPad orientations" {
  cd "${TMP}/app"
  sed -i.bak '/TARGETED_DEVICE_FAMILY/d' project.yml
  rm -f project.yml.bak
  commit_all family
  run bash "${PREFLIGHT}" --mode testflight
  [ "$status" -eq 1 ]
  out_has "FAIL: ipad-orientation"
}

@test "runtime-trap scans the target's project.yml sources, not a hard-coded Sources dir" {
  cd "${TMP}/app"
  mkdir -p App Other
  cat > App/DemoApp.swift <<'SWIFT'
@main struct DemoApp: App {
    init() {
        EmbeddingIndex.shared.backfill()
    }
}
SWIFT
  cat > Other/Elsewhere.swift <<'SWIFT'
@main struct Elsewhere: App {
    init() {
        EmbeddingIndex.shared.backfill()
    }
}
SWIFT
  python3 - <<'PY'
p = "project.yml"
s = open(p).read()
s = s.replace("  Demo:\n    type: application\n    platform: iOS\n",
              "  Demo:\n    type: application\n    platform: iOS\n    sources:\n      - App\n", 1)
open(p, "w").write(s)
PY
  commit_all sources
  run bash "${PREFLIGHT}" --mode testflight
  [ "$status" -eq 0 ]
  out_has "WARN: runtime-trap"
  out_has "App/DemoApp.swift"
  out_lacks "Other/Elsewhere.swift"
}

@test "project_info.py reads sources as list, path map and inline list, ignoring nested excludes" {
  cd "${TMP}/app"
  INFO="${BATS_TEST_DIRNAME}/../../plugins/ios-dev/skills/release/scripts/project_info.py"
  cat > project.yml <<'YML'
name: Demo
targets:
  Demo:
    type: application
    sources:
      - path: App
        excludes:
          - "**/Skip"
      - Shared
  Other:
    sources: [A, "B C"]
YML
  run python3 "${INFO}" sources Demo
  [ "$status" -eq 0 ]
  [ "$output" = $'App\nShared' ]
  run python3 "${INFO}" sources Other
  [ "$status" -eq 0 ]
  [ "$output" = $'A\nB C' ]
  run python3 "${INFO}" sources Missing
  [ "$status" -eq 1 ]
}

@test "project_info.py rejects unknown flags and a valueless --file with exit 2 and the accepted flags" {
  cd "${TMP}/app"
  INFO="${BATS_TEST_DIRNAME}/../../plugins/ios-dev/skills/release/scripts/project_info.py"
  printf 'name: Demo\ntargets:\n  Demo:\n    type: application\n' > project.yml
  run python3 "${INFO}" groups Demo --bogus
  [ "$status" -eq 2 ]
  out_has "unknown argument: --bogus"
  out_has "--file"
  run python3 "${INFO}" groups Demo --file
  [ "$status" -eq 2 ]
  out_has "--file needs a value"
  out_lacks "Traceback"
  run python3 "${INFO}" sources Demo --file project.yml
  [ "$status" -eq 1 ]
}

make_appiconset() {  # $1 dir; light file $2 (rgb|rgba); dark/tinted are always rgba
  local d="$1"
  mkdir -p "${d}"
  if [[ "$2" == "rgba" ]]; then make_png_rgba "${d}/light-1024.png" 1024 1024; else make_png "${d}/light-1024.png" 1024 1024; fi
  make_png_rgba "${d}/dark-1024.png" 1024 1024
  make_png_rgba "${d}/tinted-1024.png" 1024 1024
  cat > "${d}/Contents.json" <<'JSON'
{
  "images" : [
    { "filename" : "light-1024.png", "idiom" : "universal", "platform" : "ios", "size" : "1024x1024" },
    { "appearances" : [ { "appearance" : "luminosity", "value" : "dark" } ],
      "filename" : "dark-1024.png", "idiom" : "universal", "platform" : "ios", "size" : "1024x1024" },
    { "appearances" : [ { "appearance" : "luminosity", "value" : "tinted" } ],
      "filename" : "tinted-1024.png", "idiom" : "universal", "platform" : "ios", "size" : "1024x1024" }
  ],
  "info" : { "author" : "xcode", "version" : 1 }
}
JSON
}

@test "icon-opaque FAILs when the light 1024 icon has an alpha channel" {
  cd "${TMP}/app"
  make_appiconset Demo/Assets.xcassets/AppIcon.appiconset rgba
  commit_all icon
  run bash "${PREFLIGHT}" --mode testflight
  [ "$status" -eq 1 ]
  out_has "FAIL: icon-opaque"
  out_has "light-1024.png"
  out_has "noneSkipLast"
}

@test "icon-opaque PASSes an opaque light icon and never checks dark or tinted variants" {
  cd "${TMP}/app"
  make_appiconset Demo/Assets.xcassets/AppIcon.appiconset rgb
  commit_all icon
  run bash "${PREFLIGHT}" --mode testflight
  [ "$status" -eq 0 ]
  out_has "PASS: icon-opaque"
}

@test "icon-opaque WARNs, never passes, when no appiconset is found" {
  cd "${TMP}/app"
  run bash "${PREFLIGHT}" --mode testflight
  [ "$status" -eq 0 ]
  out_has "WARN: icon-opaque"
  out_lacks "PASS: icon-opaque"
}

@test "screenshot-sizes FAILs an off-spec PNG in appstore mode and names the file" {
  cd "${TMP}/app"
  mkdir -p marketing/screenshots/6.9
  make_png marketing/screenshots/6.9/good.png 1290 2796
  make_png marketing/screenshots/6.9/stretched.png 1290 2700
  commit_all shots
  run bash "${PREFLIGHT}" --mode appstore --next-version 1.2.0
  [ "$status" -eq 1 ]
  out_has "FAIL: screenshot-sizes"
  out_has "stretched.png"
  out_has "1290x2700"
  out_has "unverified"
  out_lacks "good.png"
}

@test "screenshot-sizes PASSes known-good sizes in both orientations" {
  cd "${TMP}/app"
  mkdir -p marketing/screenshots
  make_png marketing/screenshots/a.png 1290 2796
  make_png marketing/screenshots/b.png 2796 1290
  make_png marketing/screenshots/c.png 1320 2868
  commit_all shots
  run bash "${PREFLIGHT}" --mode appstore --next-version 1.2.0
  [ "$status" -eq 0 ]
  out_has "PASS: screenshot-sizes"
}

@test "screenshot-sizes reads JPEG sizes and FAILs an unreadable image instead of skipping it" {
  cd "${TMP}/app"
  mkdir -p marketing/screenshots
  python3 - marketing/screenshots/ok.jpg 1290 2796 <<'PY'
import struct, sys
path, w, h = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
sof = struct.pack(">BHHB", 8, h, w, 3) + b"\x01\x11\x00\x02\x11\x00\x03\x11\x00"
with open(path, "wb") as f:
    f.write(b"\xff\xd8" + b"\xff\xc0" + struct.pack(">H", len(sof) + 2) + sof + b"\xff\xd9")
PY
  commit_all jpeg
  run bash "${PREFLIGHT}" --mode appstore --next-version 1.2.0
  [ "$status" -eq 0 ]
  out_has "PASS: screenshot-sizes"
  printf 'not an image\n' > marketing/screenshots/broken.png
  commit_all broken
  run bash "${PREFLIGHT}" --mode appstore --next-version 1.2.0
  [ "$status" -eq 1 ]
  out_has "FAIL: screenshot-sizes"
  out_has "broken.png"
}

@test "screenshot-sizes SKIPs when there is no screenshots dir, and in testflight mode" {
  cd "${TMP}/app"
  run bash "${PREFLIGHT}" --mode appstore --next-version 1.2.0
  [ "$status" -eq 0 ]
  out_has "SKIP: screenshot-sizes"
  mkdir -p marketing/screenshots
  make_png marketing/screenshots/bad.png 100 100
  commit_all shots
  run bash "${PREFLIGHT}" --mode testflight
  [ "$status" -eq 0 ]
  out_has "SKIP: screenshot-sizes"
}

@test "whatsnew-config WARNs when a WhatsNew json exists but release.whatsnew_file is unset" {
  cd "${TMP}/app"
  sed -i.bak '/whatsnew_file/d' .claude/app.yml
  rm -f .claude/app.yml.bak
  commit_all cfg
  run bash "${PREFLIGHT}" --mode testflight
  [ "$status" -eq 0 ]
  out_has "WARN: whatsnew-config"
  out_has "Sources/WhatsNew.json"
}

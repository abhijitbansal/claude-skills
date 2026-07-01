# Common bats helpers. Each test file `load helpers` to get them.

# Prepend the mocks dir to PATH so calls to `claude`, `npx`, `gh`, `curl` hit our stubs.
export PATH="${BATS_TEST_DIRNAME}/mocks:${PATH}"

# Preserve user site-packages across HOME overrides in tests.
# Tests that change HOME (e.g. capture.bats) need Python to still find user-installed
# packages such as tomlkit that live in ~/Library/Python/... on macOS.
export PYTHONUSERBASE="${PYTHONUSERBASE:-$(python3 -c 'import site; print(site.getuserbase())')}"

# Recorded-call log: mocks append their argv here so tests can inspect it.
export MOCK_CALL_LOG="${BATS_TMPDIR}/mock-calls.log"
: > "${MOCK_CALL_LOG}"

make_fixture_app() {
  # $1 = dir. Creates a git-initialized fake iOS app repo with v2 app.yml,
  # project.yml, a "generated" Info.plist and extracted-entitlements stubs.
  # Real repos derive plist/entitlements from build products; tests point the
  # consumers at these stubs via PREFLIGHT_PLIST / PREFLIGHT_ENTITLEMENTS_DIR.
  local d="$1"
  mkdir -p "${d}/.claude" "${d}/Sources" "${d}/build/gen"
  cat > "${d}/.claude/app.yml" <<'YML'
schema_version: 2
app:
  name: Demo
  bundle_id: com.example.demo
  scheme: Demo
  team_id: ABCDE12345
  url_scheme: demo
targets:
  extensions: [DemoWidget]
  app_group: group.com.example.demo
release:
  encryption_exempt: true
  fonts_expected: 0
  usage_strings: [NSCameraUsageDescription]
  whatsnew_file: Sources/WhatsNew.json
YML
  cat > "${d}/project.yml" <<'YML'
name: Demo
settings:
  MARKETING_VERSION: "1.2.0"
  CURRENT_PROJECT_VERSION: "34"
targets:
  Demo:
    type: application
    platform: iOS
  DemoWidget:
    type: app-extension
    platform: iOS
YML
  cat > "${d}/build/gen/Demo-Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>NSCameraUsageDescription</key><string>Scan documents.</string>
  <key>ITSAppUsesNonExemptEncryption</key><false/>
</dict></plist>
PLIST
  printf 'group.com.example.demo\n' > "${d}/build/gen/Demo.entitlements.groups"
  printf 'group.com.example.demo\n' > "${d}/build/gen/DemoWidget.entitlements.groups"
  printf '[{"version":"1.2.0","notes":"Things."}]\n' > "${d}/Sources/WhatsNew.json"
  git -C "${d}" init -q
  git -C "${d}" add -A
  git -C "${d}" -c user.email=t@t -c user.name=t commit -qm init
}

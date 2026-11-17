# Common bats helpers. Each test file `load helpers` to get them.

# Prepend the mocks dir to PATH so calls to `claude`, `npx`, `gh`, `curl` hit our stubs.
export PATH="${BATS_TEST_DIRNAME}/mocks:${PATH}"

# Preserve user site-packages across HOME overrides in tests.
# Tests that change HOME (e.g. capture.bats) need Python to still find user-installed
# packages such as tomlkit that live in ~/Library/Python/... on macOS.
export PYTHONUSERBASE="${PYTHONUSERBASE:-$(python3 -c 'import site; print(site.getuserbase())')}"

# Recorded-call log: mocks append their argv here so tests can inspect it.
# Never a path shared across bats processes: a concurrent bats run sourcing this
# file would truncate it mid-test (empty call log, flaky --upload-app asserts).
export MOCK_CALL_LOG="${BATS_TEST_TMPDIR:-${BATS_TMPDIR}}/mock-calls.$$.log"
: > "${MOCK_CALL_LOG}"

make_png() {  # $1 path, $2 width, $3 height — minimal valid PNG
  python3 - "$1" "$2" "$3" <<'PY'
import struct, zlib, sys
p, w, h = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
def chunk(t, d):
    c = t + d
    return struct.pack(">I", len(d)) + c + struct.pack(">I", zlib.crc32(c))
ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
raw = b"".join(b"\x00" + b"\x00\x00\x00" * w for _ in range(h))
png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
open(p, "wb").write(png)
PY
}

# Strict output assertions. A bare `[[ ... ]]` that is not the last command of a bats test
# does not fail the test on some bash versions, so new tests use these instead.
out_has() {
  [[ "${output}" == *"$1"* ]] && return 0
  echo "expected output to contain: $1" >&2
  echo "--- output was:" >&2
  echo "${output}" >&2
  return 1
}
out_lacks() {
  [[ "${output}" != *"$1"* ]] && return 0
  echo "expected output NOT to contain: $1" >&2
  echo "--- output was:" >&2
  echo "${output}" >&2
  return 1
}

make_png_rgba() {  # $1 path, $2 width, $3 height — minimal valid PNG WITH an alpha channel
  python3 - "$1" "$2" "$3" <<'PY'
import struct, zlib, sys
p, w, h = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
def chunk(t, d):
    c = t + d
    return struct.pack(">I", len(d)) + c + struct.pack(">I", zlib.crc32(c))
ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
raw = b"".join(b"\x00" + b"\x00\x00\x00\xff" * w for _ in range(h))
png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
open(p, "wb").write(png)
PY
}

make_release_stubs() {  # $1 = shim dir. xcodebuild/xcrun/bundle stubs that log argv to MOCK_CALL_LOG.
  # Prepend the dir to PATH inside the test only: the top-level mocks/ dir is on PATH for
  # every bats file and must not shadow the real xcodebuild/xcrun for other suites.
  local d="$1"
  mkdir -p "${d}"
  cat > "${d}/xcodebuild" <<'SH'
#!/bin/sh
echo "xcodebuild $*" >> "${MOCK_CALL_LOG}"
case "$*" in
  *-exportArchive*) mkdir -p build; : > build/Demo.ipa ;;
esac
exit 0
SH
  cat > "${d}/xcrun" <<'SH'
#!/bin/sh
echo "xcrun $*" >> "${MOCK_CALL_LOG}"
case "$*" in
  *--upload-app*) echo "UPLOAD SUCCEEDED" ;;
esac
exit 0
SH
  cat > "${d}/bundle" <<'SH'
#!/bin/sh
echo "bundle $*" >> "${MOCK_CALL_LOG}"
exit 0
SH
  chmod +x "${d}/xcodebuild" "${d}/xcrun" "${d}/bundle"
}

make_fake_asc_home() {  # $1 = fake HOME dir, $2 = "nokey" to omit the .p8 file
  mkdir -p "$1/.app-store-connect"
  printf 'KEY_ID=FAKEKEY123\nISSUER_ID=fake-issuer-uuid\n' > "$1/.app-store-connect/config"
  if [[ "${2:-}" != "nokey" ]]; then
    : > "$1/.app-store-connect/AuthKey_FAKEKEY123.p8"
  fi
}

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
  TARGETED_DEVICE_FAMILY: "1"
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

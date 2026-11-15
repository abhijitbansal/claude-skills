#!/usr/bin/env bats

load helpers

setup() {
  TMP="$(mktemp -d)"
  export HOME="${TMP}/home"
  mkdir -p "${HOME}"
  SCRIPTS="${BATS_TEST_DIRNAME}/../../plugins/ios-dev/skills/app-preview/scripts"
  export XLOG="${TMP}/xlog"
  : > "${XLOG}"
  # Stubs shadow every command that could touch the real Simulator, Messages
  # or the clock; each one logs its argv to XLOG.
  STUBS="${TMP}/stubs"
  mkdir -p "${STUBS}"
  cat > "${STUBS}/xcrun" <<'SH'
#!/bin/sh
echo "xcrun $*" >> "${XLOG}"
if [ "$1" = simctl ] && [ "$2" = list ]; then cat "${SIMLIST}"; fi
exit 0
SH
  for cmd in open sleep; do
    printf '#!/bin/sh\necho "%s $*" >> "${XLOG}"\nexit 0\n' "${cmd}" > "${STUBS}/${cmd}"
  done
  # osascript is only ever fed a heredoc, so draining stdin cannot hang.
  printf '#!/bin/sh\necho "osascript $*" >> "${XLOG}"\ncat >> "${XLOG}"\nexit 0\n' > "${STUBS}/osascript"
  chmod +x "${STUBS}"/*
  export PATH="${STUBS}:${PATH}"
  export SIMLIST="${TMP}/simlist"
}

teardown() { rm -rf "${TMP}"; }

# --- fixtures ---------------------------------------------------------------

UDID_A=11111111-1111-1111-1111-111111111111
UDID_B=22222222-2222-2222-2222-222222222222
UDID_C=33333333-3333-3333-3333-333333333333
UDID_D=44444444-4444-4444-4444-444444444444

sims_two_booted() {
  cat > "${SIMLIST}" <<EOF
== Devices ==
-- iOS 26.0 --
    iPhone 17 Pro (${UDID_A}) (Booted)
    iPhone 17 (${UDID_B}) (Booted)
    iPhone Air (${UDID_C}) (Shutdown)
EOF
}

sims_one_booted() {
  cat > "${SIMLIST}" <<EOF
== Devices ==
-- iOS 26.0 --
    iPhone 17 Pro (${UDID_A}) (Booted)
    iPhone 17 (${UDID_B}) (Shutdown)
EOF
}

sims_none_booted() {
  cat > "${SIMLIST}" <<EOF
== Devices ==
-- iOS 18.0 --
    iPhone 16 (${UDID_D}) (Shutdown)
-- iOS 26.0 --
    iPad Pro (${UDID_C}) (Shutdown)
    iPhone 17 (${UDID_B}) (Shutdown)
    iPhone 17 Pro (${UDID_A}) (Shutdown)
-- watchOS 26.0 --
    Apple Watch Series 11 (55555555-5555-5555-5555-555555555555) (Shutdown)
EOF
}

make_preview_app() {
  make_fixture_app "${TMP}/app"
  cat > "${TMP}/app/build.sh" <<'SH'
#!/bin/sh
echo "build $*" >> "${XLOG}"
SH
  chmod +x "${TMP}/app/build.sh"
  mkdir -p "${HOME}/Library/Developer/Xcode/DerivedData/Demo-abc/Build/Products/Debug-iphonesimulator/Demo.app"
  cd "${TMP}/app"
}

simctl_calls() { grep '^xcrun simctl' "${XLOG}" | grep -v 'simctl list' || true; }

# --- existing guards ---------------------------------------------------------

@test "app-preview launch.sh refuses without .claude/app.yml" {
  cd "${TMP}"
  run bash "${SCRIPTS}/launch.sh"
  [ "$status" -ne 0 ]
  [[ "$output" == *"app.yml"* ]] || false
}

@test "app-preview snap.sh refuses without .claude/app.yml" {
  cd "${TMP}"
  run bash "${SCRIPTS}/snap.sh"
  [ "$status" -ne 0 ]
  [[ "$output" == *"app.yml"* ]] || false
}

# --- CAT-48: simulator targeting --------------------------------------------

@test "launch.sh with two booted sims and no --sim refuses and installs nothing" {
  make_preview_app
  sims_two_booted
  run bash "${SCRIPTS}/launch.sh" --no-build
  [ "$status" -eq 1 ]
  [[ "$output" == *"more than one"* ]] || false
  [[ "$output" == *"${UDID_A}"* ]] || false
  [[ "$output" == *"${UDID_B}"* ]] || false
  [ -z "$(simctl_calls | grep -e ' install ' -e ' launch ' || true)" ]
}

@test "launch.sh --sim <name> targets that UDID for install, terminate and launch" {
  make_preview_app
  sims_two_booted
  run bash "${SCRIPTS}/launch.sh" --no-build --sim "iPhone 17"
  [ "$status" -eq 0 ]
  grep -q "simctl install ${UDID_B} " "${XLOG}"
  grep -q "simctl terminate ${UDID_B} com.example.demo" "${XLOG}"
  grep -q "simctl launch ${UDID_B} com.example.demo" "${XLOG}"
  [ -z "$(grep -e 'simctl install booted' -e 'simctl launch booted' -e "${UDID_A}" "${XLOG}" || true)" ]
}

@test "launch.sh --sim <UDID> is accepted as-is" {
  make_preview_app
  sims_two_booted
  run bash "${SCRIPTS}/launch.sh" --no-build --sim "${UDID_A}"
  [ "$status" -eq 0 ]
  grep -q "simctl launch ${UDID_A} com.example.demo" "${XLOG}"
}

@test "launch.sh --sim naming a missing simulator fails with a hint" {
  make_preview_app
  sims_one_booted
  run bash "${SCRIPTS}/launch.sh" --no-build --sim "iPhone 99"
  [ "$status" -eq 1 ]
  [[ "$output" == *"iPhone 99"* ]] || false
  [ -z "$(simctl_calls | grep -e ' install ' || true)" ]
}

@test "launch.sh with exactly one booted sim uses it by UDID" {
  make_preview_app
  sims_one_booted
  run bash "${SCRIPTS}/launch.sh" --no-build
  [ "$status" -eq 0 ]
  grep -q "simctl install ${UDID_A} " "${XLOG}"
  [ -z "$(grep 'simctl boot' "${XLOG}" || true)" ]
}

@test "launch.sh with none booted boots the first iPhone of the newest iOS runtime" {
  make_preview_app
  sims_none_booted
  run bash "${SCRIPTS}/launch.sh" --no-build
  [ "$status" -eq 0 ]
  grep -q "simctl boot ${UDID_B}" "${XLOG}"
  grep -q "simctl install ${UDID_B} " "${XLOG}"
}

@test "launch.sh --sim booting a named shutdown sim boots that one only" {
  make_preview_app
  sims_none_booted
  run bash "${SCRIPTS}/launch.sh" --no-build --sim "iPhone 16"
  [ "$status" -eq 0 ]
  grep -q "simctl boot ${UDID_D}" "${XLOG}"
  [ -z "$(grep "simctl boot ${UDID_B}" "${XLOG}" || true)" ]
}

@test "launch.sh forwards the --sim name to the build script's -s" {
  make_preview_app
  sims_one_booted
  run bash "${SCRIPTS}/launch.sh" --sim "iPhone 17 Pro"
  [ "$status" -eq 0 ]
  grep -q 'build -s iPhone 17 Pro' "${XLOG}"
}

@test "launch.sh passes --no-launch only to a build script that advertises it" {
  make_preview_app
  sims_one_booted
  run bash "${SCRIPTS}/launch.sh"
  [ "$status" -eq 0 ]
  [ -z "$(grep -e '--no-launch' "${XLOG}" || true)" ]
  printf '#!/bin/sh\n# supports --no-launch\necho "build $*" >> "${XLOG}"\n' > build.sh
  : > "${XLOG}"
  run bash "${SCRIPTS}/launch.sh"
  [ "$status" -eq 0 ]
  grep -q 'build --no-launch' "${XLOG}"
}

@test "snap.sh --sim <name> screenshots that UDID, not 'booted'" {
  make_preview_app
  sims_two_booted
  run bash "${SCRIPTS}/snap.sh" --sim "iPhone 17" --dir "${TMP}/snaps" label
  [ "$status" -eq 0 ]
  grep -q "simctl io ${UDID_B} screenshot" "${XLOG}"
  [ -z "$(grep 'simctl io booted' "${XLOG}" || true)" ]
}

@test "snap.sh with two booted sims and no --sim refuses" {
  make_preview_app
  sims_two_booted
  run bash "${SCRIPTS}/snap.sh" --dir "${TMP}/snaps"
  [ "$status" -eq 1 ]
  [[ "$output" == *"more than one"* ]] || false
  [ -z "$(grep 'screenshot' "${XLOG}" || true)" ]
}

@test "snap.sh with nothing booted tells the caller to run launch.sh" {
  make_preview_app
  sims_none_booted
  run bash "${SCRIPTS}/snap.sh" --dir "${TMP}/snaps"
  [ "$status" -eq 1 ]
  [[ "$output" == *"launch.sh"* ]] || false
}

@test "bundle.sh --sim captures and opens deep links on the named UDID" {
  make_preview_app
  sims_two_booted
  run bash "${SCRIPTS}/bundle.sh" --no-build --no-deliver --sim "iPhone 17" \
    --description "spacing" --screen home --screen scan
  [ "$status" -eq 0 ]
  grep -q "simctl openurl ${UDID_B} demo://scan" "${XLOG}"
  grep -q "simctl io ${UDID_B} screenshot" "${XLOG}"
  [ -z "$(grep -e 'simctl openurl booted' -e 'simctl io booted' -e 'simctl launch booted' "${XLOG}" || true)" ]
}

@test "bundle.sh percent-encodes the doc deep-link path" {
  make_preview_app
  sims_one_booted
  run bash "${SCRIPTS}/bundle.sh" --no-build --no-deliver \
    --description "doc" --screen "doc:Receipts/a b&c#1.pdf"
  [ "$status" -eq 0 ]
  grep -q 'openurl .* demo://doc?path=Receipts/a%20b%26c%231.pdf' "${XLOG}"
}

# --- CAT-50: strict flags -----------------------------------------------------

@test "launch.sh rejects an unknown flag with exit 2 and lists accepted flags" {
  make_preview_app
  sims_one_booted
  run bash "${SCRIPTS}/launch.sh" --no-biuld
  [ "$status" -eq 2 ]
  [[ "$output" == *"--no-build"* ]] || false
  [ -z "$(simctl_calls)" ]
}

@test "launch.sh --sim without a value exits 2" {
  make_preview_app
  sims_one_booted
  run bash "${SCRIPTS}/launch.sh" --sim
  [ "$status" -eq 2 ]
  [[ "$output" == *"--sim"* ]] || false
}

@test "snap.sh treats an unknown --flag as an error, not a label" {
  make_preview_app
  sims_one_booted
  run bash "${SCRIPTS}/snap.sh" --dirr "${TMP}/x"
  [ "$status" -eq 2 ]
  [[ "$output" == *"--dir"* ]] || false
  [ -z "$(grep 'screenshot' "${XLOG}" || true)" ]
  [ ! -e "${TMP}/x" ]
}

@test "snap.sh --help exits 0" {
  make_preview_app
  run bash "${SCRIPTS}/snap.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"--sim"* ]] || false
}

@test "deliver.sh --noping exits 2 and sends nothing" {
  make_preview_app
  echo png > "${TMP}/a.png"
  run bash "${SCRIPTS}/deliver.sh" --noping "${TMP}/a.png"
  [ "$status" -eq 2 ]
  [[ "$output" == *"--no-ping"* ]] || false
  [ -z "$(grep osascript "${XLOG}" || true)" ]
  [ ! -d "${HOME}/Library/Mobile Documents" ]
}

@test "deliver.sh with two file arguments exits 2" {
  make_preview_app
  echo png > "${TMP}/a.png"
  run bash "${SCRIPTS}/deliver.sh" "${TMP}/a.png" "${TMP}/b.png"
  [ "$status" -eq 2 ]
  [ ! -d "${HOME}/Library/Mobile Documents" ]
}

@test "deliver.sh --help exits 0 without delivering" {
  make_preview_app
  run bash "${SCRIPTS}/deliver.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"--no-ping"* ]] || false
  [ ! -d "${HOME}/Library/Mobile Documents" ]
}

# --- CAT-47: delivery hint --------------------------------------------------------

@test "deliver.sh with no destination hints to export IMESSAGE_TO, not to write the plugin cache" {
  make_preview_app
  echo png > "${TMP}/a.png"
  unset IMESSAGE_TO
  run bash "${SCRIPTS}/deliver.sh" "${TMP}/a.png"
  [ "$status" -eq 0 ]
  [[ "$output" == *"export IMESSAGE_TO="* ]] || false
  [[ "$output" != *".imessage-to"* ]] || false
  [ -z "$(grep osascript "${XLOG}" || true)" ]
}

@test "deliver.sh pings via iMessage when IMESSAGE_TO is set" {
  make_preview_app
  echo png > "${TMP}/a.png"
  export IMESSAGE_TO="me@example.com"
  run bash "${SCRIPTS}/deliver.sh" "${TMP}/a.png"
  [ "$status" -eq 0 ]
  grep -q '^osascript' "${XLOG}"
}

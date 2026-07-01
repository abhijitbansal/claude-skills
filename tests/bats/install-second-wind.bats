#!/usr/bin/env bats

setup() {
  TMP="$(mktemp -d)"
  export WIND_HOME="$TMP/.wind"
  export WIND_RC="$TMP/zshrc"
  touch "$WIND_RC"
}

teardown() { rm -rf "$TMP"; }

@test "local mode creates layout and a working shim" {
  run sh tools/second-wind/install.sh --no-modify-path
  [ "$status" -eq 0 ]
  [ -f "$WIND_HOME/wind.py" ]
  [ -f "$WIND_HOME/dashboard.html" ]
  [ -x "$WIND_HOME/bin/wind" ]
  run "$WIND_HOME/bin/wind" --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"Second Wind"* ]]
}

@test "PATH line appended once, idempotent on rerun" {
  WIND_ASSUME_YES=1 run sh tools/second-wind/install.sh
  [ "$status" -eq 0 ]
  WIND_ASSUME_YES=1 run sh tools/second-wind/install.sh
  [ "$status" -eq 0 ]
  [ "$(grep -c '.wind/bin' "$WIND_RC")" -eq 1 ]
}

@test "--no-modify-path leaves rc untouched" {
  run sh tools/second-wind/install.sh --no-modify-path
  [ "$status" -eq 0 ]
  run grep -c '.wind/bin' "$WIND_RC"
  [ "$output" = "0" ]
}

@test "rerun does not clobber existing config.json" {
  run sh tools/second-wind/install.sh --no-modify-path
  echo '{"repos": []}' > "$WIND_HOME/config.json"
  run sh tools/second-wind/install.sh --no-modify-path
  [ "$status" -eq 0 ]
  [ "$(cat "$WIND_HOME/config.json")" = '{"repos": []}' ]
}

# --- download branch (fresh machine via the curl one-liner) -----------------
# Exercised hermetically with a file:// RAW_BASE. Copying install.sh alone into
# a temp dir removes the wind.py sibling, so the script takes the download path.

@test "download branch fetches wind.py + dashboard.html to dest" {
  local base="$PWD/tools/second-wind"
  cp "$base/install.sh" "$TMP/install.sh"
  run env WIND_HOME="$WIND_HOME" WIND_RAW_BASE="file://$base" \
    sh "$TMP/install.sh" --no-modify-path
  [ "$status" -eq 0 ]
  [ -s "$WIND_HOME/wind.py" ]
  [ -s "$WIND_HOME/dashboard.html" ]
  [[ "$output" == *"downloaded"* ]]
  # regression: -o DEST must precede `--`, else curl treats it as a URL
  [[ "$output" != *"No host part"* ]]
  [[ "$output" != *"Could not resolve host: -o"* ]]
  run "$WIND_HOME/bin/wind" --help
  [ "$status" -eq 0 ]
}

@test "download branch prints clone fallback and fails on unreachable base" {
  cp "$PWD/tools/second-wind/install.sh" "$TMP/install.sh"
  run env WIND_HOME="$WIND_HOME" WIND_RAW_BASE="file://$TMP/nope" \
    sh "$TMP/install.sh" --no-modify-path
  [ "$status" -ne 0 ]
  [[ "$output" == *"git clone"* ]]
  [[ "$output" == *"Install from a clone"* ]]
}

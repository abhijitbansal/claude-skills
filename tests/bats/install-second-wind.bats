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

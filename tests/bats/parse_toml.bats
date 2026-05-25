#!/usr/bin/env bats

load helpers

@test "parse_toml emits marketplaces JSON" {
  TOML="$(mktemp)"
  cat >"${TOML}" <<EOF
[meta]
schema_version = 1
[[marketplaces]]
name = "a"
repo = "owner/a"
EOF
  run python3 "${BATS_TEST_DIRNAME}/../../setup/parse_toml.py" "${TOML}" marketplaces
  [ "$status" -eq 0 ]
  [[ "$output" == *'"name": "a"'* ]]
}

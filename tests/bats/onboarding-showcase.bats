#!/usr/bin/env bats

# Repo-file content checks for the onboarding & features-showcase surfaces.
ROOT="${BATS_TEST_DIRNAME}/../.."

@test "/second-wind slash command exists and names the four steps" {
  local f="$ROOT/plugins/second-wind/commands/second-wind.md"
  [ -f "$f" ]
  grep -q "wind init"   "$f"
  grep -q "wind prompt" "$f"
  grep -q "wind up"     "$f"
  grep -q "wind dash"   "$f"
}

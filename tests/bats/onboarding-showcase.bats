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

@test "features.html lists every plugin and the filter chips" {
  local f="$ROOT/docs/features.html"
  [ -f "$f" ]
  for name in second-wind core-workflow ios-dev linear-pm; do
    grep -q "$name" "$f"
  done
  grep -q 'data-filter="Plugin"' "$f"
  grep -q 'data-filter="Skill"' "$f"
  grep -q 'data-filter="Command"' "$f"
  grep -q 'data-filter="Agent"' "$f"
  grep -q 'data-filter="CLI"' "$f"
  grep -q 'data-filter="Hook"' "$f"
}

@test "landing links to the features explorer" {
  grep -q 'docs/features.html' "$ROOT/site/index.html"
}

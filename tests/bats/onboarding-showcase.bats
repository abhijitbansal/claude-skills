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

@test "catalog lists every plugin and the filter chips" {
  local f="$ROOT/docs/catalog.html"
  [ -f "$f" ]
  for name in second-wind core-workflow ios-dev linear-pm prompt-craft; do
    grep -q "$name" "$f"
  done
  grep -q 'data-filter="Plugin"' "$f"
  grep -q 'data-filter="Skill"' "$f"
  grep -q 'data-filter="Command"' "$f"
  grep -q 'data-filter="Agent"' "$f"
  grep -q 'data-filter="CLI"' "$f"
  grep -q 'data-filter="Hook"' "$f"
}

@test "every plugin has a feature page on the shared design system" {
  for name in second-wind core-workflow ios-dev linear-pm prompt-craft; do
    local f="$ROOT/docs/features/$name.html"
    [ -f "$f" ]
    # all feature pages pull the one shared stylesheet (no per-page theme)
    grep -q 'site/assets/site.css' "$f"
    # consistent chrome + the required deep-dive sections
    grep -q 'nav class="site"' "$f"
    grep -q 'id="usability"' "$f"
    grep -q 'id="how"' "$f"
    grep -q 'id="install"' "$f"
  done
}

@test "the whole site shares one design system" {
  [ -f "$ROOT/site/assets/site.css" ]
  [ -f "$ROOT/site/assets/site.js" ]
  for f in "$ROOT/site/index.html" "$ROOT/docs/catalog.html" \
           "$ROOT/docs/architecture.html" "$ROOT/docs/machine-setup.html" \
           "$ROOT/docs/second-wind/index.html"; do
    grep -q 'assets/site.css' "$f"
  done
}

@test "landing showcases features and links to detail pages + catalog" {
  local f="$ROOT/site/index.html"
  grep -q 'docs/catalog.html' "$f"
  grep -q 'docs/features/second-wind.html' "$f"
  grep -q 'docs/features/prompt-craft.html' "$f"
  grep -q 'docs/features/ios-dev.html' "$f"
}

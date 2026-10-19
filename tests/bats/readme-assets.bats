#!/usr/bin/env bats

# README.md embeds images from docs/features/img. A renamed or never-committed
# asset renders as a broken image on GitHub, so every referenced path must exist.
ROOT="${BATS_TEST_DIRNAME}/../.."

@test "every docs/features/img path in README.md exists" {
  local readme="$ROOT/README.md"
  local paths
  paths="$(grep -o 'docs/features/img/[A-Za-z0-9._/-]*' "$readme" | sort -u)"

  # Guard against passing vacuously: the hero and diagram GIFs must be referenced.
  grep -q '^docs/features/img/portable-artifacts/launch-announcement\.gif$' <<<"$paths"
  grep -q '^docs/features/img/portable-artifacts/diagram-story\.gif$' <<<"$paths"

  local p
  while IFS= read -r p; do
    [ -f "$ROOT/$p" ] || { echo "missing: $p" >&2; return 1; }
  done <<<"$paths"
}

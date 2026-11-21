#!/usr/bin/env bats

# README.md may embed images from docs/features/img. A renamed or never-committed
# asset renders as a broken image on GitHub, so every referenced path must exist.
ROOT="${BATS_TEST_DIRNAME}/../.."

@test "every docs/features/img path in README.md exists" {
  local readme="$ROOT/README.md"
  local paths p
  paths="$(grep -o 'docs/features/img/[A-Za-z0-9._/-]*' "$readme" | sort -u || true)"
  [ -n "$paths" ] || skip "README.md embeds no docs/features/img assets"
  while IFS= read -r p; do
    [ -f "$ROOT/$p" ] || { echo "missing: $p" >&2; return 1; }
  done <<<"$paths"
}

# portable-artifacts moved to its own repo (its gifs, gallery and plugin files went with it).
# A repo-relative link or image into those paths would 404 on GitHub. The install command
# `node portable-artifacts/plugins/portable-artifacts/...` is a clone path, not a link: it
# does not match, because only `](path` and `src="path` / `href="path` forms are checked.
@test "README.md has no relative link into paths that moved to the portable-artifacts repo" {
  run grep -nE '\]\((\./)?(plugins/portable-artifacts|docs/features/(img|showcase)/portable-artifacts)|(src|href)="(\./)?(plugins/portable-artifacts|docs/features/(img|showcase)/portable-artifacts)' "$ROOT/README.md"
  [ "$status" -eq 1 ]
}

@test "the moved-path check fires on a link into plugins/portable-artifacts" {
  local f="${BATS_TEST_TMPDIR}/bad.md"
  printf '%s\n' 'See [usage](plugins/portable-artifacts/USAGE.md) and <img src="docs/features/img/portable-artifacts/x.gif">.' > "$f"
  run grep -cE '\]\((\./)?(plugins/portable-artifacts|docs/features/(img|showcase)/portable-artifacts)|(src|href)="(\./)?(plugins/portable-artifacts|docs/features/(img|showcase)/portable-artifacts)' "$f"
  [ "$output" = "1" ]
}

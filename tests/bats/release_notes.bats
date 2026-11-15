#!/usr/bin/env bats

load helpers

setup() {
  TMP="$(mktemp -d)"
  NOTES="${BATS_TEST_DIRNAME}/../../plugins/ios-dev/skills/release/scripts/release_notes.sh"
  PACK="${BATS_TEST_DIRNAME}/../../plugins/ios-dev/skills/release/scripts/paste_pack.py"
  make_fixture_app "${TMP}/app"
}
teardown() { rm -rf "${TMP}"; }

gitc() { git -C "${TMP}/app" -c user.email=t@t -c user.name=t "$@"; }

# Commit a file with a message; $1 = file name, $2 = message.
commit_msg() { echo "$1" > "${TMP}/app/$1" && gitc add -A && gitc commit -qm "$2"; }

# stdout only (the draft path) / stderr only (the scan summary and errors).
notes_stdout() { run bash -c 'bash "$0" "$@" 2>/dev/null' "${NOTES}" "$@"; }
notes_stderr() { run bash -c 'bash "$0" "$@" 2>&1 >/dev/null' "${NOTES}" "$@"; }

@test "collects Release-Note trailers since last tag into a bullet draft outside build/" {
  cd "${TMP}/app"
  gitc tag v1.2.0
  commit_msg a.txt $'feat: thing A\n\nRelease-Note: You can now do A.'
  commit_msg b.txt $'chore: internals'
  commit_msg c.txt $'fix: thing C\n\nRelease-Note: C no longer crashes.'
  notes_stdout 1.3.0
  [ "$status" -eq 0 ]
  [ "$output" = ".scratch/release/release-notes-1.3.0.md" ]
  run cat .scratch/release/release-notes-1.3.0.md
  out_has "- You can now do A."
  out_has "- C no longer crashes."
  out_lacks "internals"
}

@test "draft is not under build/, so a cold build cannot delete it, and it does not dirty the tree" {
  cd "${TMP}/app"
  commit_msg a.txt $'feat: thing A\n\nRelease-Note: You can now do A.'
  notes_stdout 1.3.0
  [ "$status" -eq 0 ]
  [[ "$output" != build/* ]]
  [ -f "${output}" ]
  [ -z "$(git status --porcelain)" ]
}

@test "prints how many commits were scanned and how many trailers were found" {
  cd "${TMP}/app"
  gitc tag v1.2.0
  commit_msg a.txt $'feat: A\n\nRelease-Note: Did A.'
  commit_msg b.txt $'feat: B\n\nRelease-Note: Did B.'
  commit_msg c.txt $'chore: C'
  notes_stderr 1.3.0
  [ "$status" -eq 0 ]
  out_has "scanned 3 commits since v1.2.0, found 2 trailers"
}

@test "zero trailers stops and names --allow-empty instead of writing a generic draft" {
  cd "${TMP}/app"
  notes_stderr 1.2.1
  [ "$status" -eq 4 ]
  out_has "found 0 trailers"
  out_has "--allow-empty"
  [ ! -f .scratch/release/release-notes-1.2.1.md ]
}

@test "--allow-empty falls back to the generic line" {
  cd "${TMP}/app"
  notes_stdout 1.2.1 --allow-empty
  [ "$status" -eq 0 ]
  run cat .scratch/release/release-notes-1.2.1.md
  out_has "- Bug fixes and improvements."
}

@test "appstore mode starts at the last non-TestFlight tag, testflight mode at the nearest tag" {
  cd "${TMP}/app"
  gitc tag v1.0.0
  commit_msg a.txt $'feat: A\n\nRelease-Note: Did A.'
  gitc tag v1.1.0-b3
  commit_msg b.txt $'feat: B\n\nRelease-Note: Did B.'
  notes_stdout 1.1.0 --mode appstore
  [ "$status" -eq 0 ]
  run cat .scratch/release/release-notes-1.1.0.md
  out_has "- Did A."
  out_has "- Did B."
  notes_stdout 1.1.0 --mode testflight
  [ "$status" -eq 0 ]
  run cat .scratch/release/release-notes-1.1.0.md
  out_has "- Did B."
  out_lacks "- Did A."
}

@test "appstore exclusion follows release.testflight_tag_format" {
  cd "${TMP}/app"
  printf '  testflight_tag_format: v{version}-rc{build}\n' >> .claude/app.yml
  gitc add -A && gitc commit -qm cfg
  gitc tag v1.0.0
  commit_msg a.txt $'feat: A\n\nRelease-Note: Did A.'
  gitc tag v1.1.0-rc3
  commit_msg b.txt $'feat: B\n\nRelease-Note: Did B.'
  notes_stdout 1.1.0 --mode appstore
  [ "$status" -eq 0 ]
  run cat .scratch/release/release-notes-1.1.0.md
  out_has "- Did A."
  out_has "- Did B."
}

@test "Release-Note lines outside the trailer block are found once each, quoted lines are not" {
  cd "${TMP}/app"
  gitc tag v1.2.0
  commit_msg a.txt $'feat: one\n\nRelease-Note: First change.\nCo-Authored-By: X <x@example.com>'
  commit_msg b.txt $'feat: two\n\nRelease-Note: Second change.\n\nCo-Authored-By: X <x@example.com>'
  commit_msg c.txt $'fix: three\n\n> Release-Note: quoted line'
  notes_stdout 1.3.0
  [ "$status" -eq 0 ]
  [ "$(grep -c 'First change.' .scratch/release/release-notes-1.3.0.md)" -eq 1 ]
  [ "$(grep -c 'Second change.' .scratch/release/release-notes-1.3.0.md)" -eq 1 ]
  [ "$(grep -c 'quoted line' .scratch/release/release-notes-1.3.0.md)" -eq 0 ]
}

@test "rejects unknown flags and a bad mode with the accepted ones listed" {
  cd "${TMP}/app"
  notes_stderr 1.3.0 --bogus
  [ "$status" -eq 2 ]
  out_has "--allow-empty"
  notes_stderr 1.3.0 --mode banana
  [ "$status" -eq 2 ]
}

write_listing() {
  mkdir -p "${TMP}/app/marketing"
  cat > "${TMP}/app/marketing/app-store-listing.md" <<'MD'
# Demo — App Store listing

## Name
Demo

## Subtitle (30 chars max)
Scan and keep

## Description
Demo scans documents.

## Keywords (100 chars, comma-separated)
scan,docs

## Promotional Text
Fresh and fast.
MD
}

@test "paste pack lists every field with its character count against the limit" {
  cd "${TMP}/app"
  write_listing
  gitc tag v1.2.0
  commit_msg a.txt $'feat: A\n\nRelease-Note: Did A.'
  notes_stdout 1.3.0
  run python3 "${PACK}" 1.3.0 --mode appstore
  [ "$status" -eq 0 ]
  out_has "Subtitle: 13/30 ok"
  out_has "Promotional text: 15/170 ok"
  out_has "Keywords: 9/100 ok"
  out_has "What's New: 8/4000 ok"
  [ -f .scratch/release/asc-paste-1.3.0.md ]
  run cat .scratch/release/asc-paste-1.3.0.md
  out_has "Scan and keep"
  out_has "- Did A."
}

@test "paste pack flags an over-limit field and a missing one, and exits 1" {
  cd "${TMP}/app"
  write_listing
  python3 - <<'PY'
p = "marketing/app-store-listing.md"
s = open(p).read().replace("Fresh and fast.", "x" * 171)
open(p, "w").write(s)
PY
  run python3 "${PACK}" 1.3.0 --mode appstore
  [ "$status" -eq 1 ]
  out_has "Promotional text: 171/170 OVER LIMIT"
  out_has "What's New: MISSING"
}

@test "paste pack in testflight mode lists What to Test from the notes draft" {
  cd "${TMP}/app"
  write_listing
  gitc tag v1.2.0
  commit_msg a.txt $'feat: A\n\nRelease-Note: Did A.'
  notes_stdout 1.3.0
  run python3 "${PACK}" 1.3.0 --mode testflight
  [ "$status" -eq 0 ]
  out_has "What to Test: 8/4000 ok"
  out_lacks "Promotional text"
}

@test "paste pack rejects unknown flags" {
  cd "${TMP}/app"
  run python3 "${PACK}" 1.3.0 --bogus
  [ "$status" -eq 2 ]
  out_has "--mode"
}

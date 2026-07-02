#!/usr/bin/env bats

load helpers

setup() {
  TMP="$(mktemp -d)"
  NOTES="${BATS_TEST_DIRNAME}/../../plugins/ios-dev/skills/release/scripts/release_notes.sh"
  make_fixture_app "${TMP}/app"
}
teardown() { rm -rf "${TMP}"; }

gitc() { git -C "${TMP}/app" -c user.email=t@t -c user.name=t "$@"; }

@test "collects Release-Note trailers since last tag into bullet draft" {
  cd "${TMP}/app"
  gitc tag v1.2.0
  echo a > a.txt && gitc add -A && gitc commit -qm $'feat: thing A\n\nRelease-Note: You can now do A.'
  echo b > b.txt && gitc add -A && gitc commit -qm $'chore: internals'
  echo c > c.txt && gitc add -A && gitc commit -qm $'fix: thing C\n\nRelease-Note: C no longer crashes.'
  run bash "${NOTES}" 1.3.0
  [ "$status" -eq 0 ]
  [ "$output" = "build/release-notes-1.3.0.md" ]
  run cat build/release-notes-1.3.0.md
  [[ "$output" == *"- You can now do A."* ]]
  [[ "$output" == *"- C no longer crashes."* ]]
  [[ "$output" != *"internals"* ]]
}

@test "no trailers anywhere falls back to generic line" {
  cd "${TMP}/app"
  run bash "${NOTES}" 1.2.1
  [ "$status" -eq 0 ]
  run cat build/release-notes-1.2.1.md
  [[ "$output" == *"- Bug fixes and improvements."* ]]
}

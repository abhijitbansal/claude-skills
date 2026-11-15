#!/usr/bin/env bats
#
# scripts/check_trailers.sh fails a commit range that carries a Claude-Session
# trailer or a model-named Co-Authored-By (AGENTS.md trailer rule). Runs on a
# throwaway repo.

setup() {
  TMP="$(mktemp -d)"
  CHECK="${BATS_TEST_DIRNAME}/../../scripts/check_trailers.sh"
  REPO="${TMP}/repo"
  git init --quiet "${REPO}"
  git -C "${REPO}" config user.email t@t
  git -C "${REPO}" config user.name Tester
  git -C "${REPO}" commit --quiet --allow-empty -m "chore: base"
  BASE="$(git -C "${REPO}" rev-parse HEAD)"
}

teardown() { rm -rf "${TMP}"; }

commit_msg() { git -C "${REPO}" commit --quiet --allow-empty -m "$1"; }

@test "passes a range with only the allowed repo trailer" {
  commit_msg "feat: good

Co-Authored-By: Claude <noreply@anthropic.com>"
  commit_msg "fix: human co-author

Co-Authored-By: Someone Else <someone@example.com>"
  run bash "${CHECK}" "${BASE}..HEAD" "${REPO}"
  [ "$status" -eq 0 ]
}

@test "fails on a Claude-Session trailer and names the commit" {
  commit_msg "feat: leaky session

Claude-Session: https://claude.ai/code/session_x"
  sha="$(git -C "${REPO}" rev-parse --short HEAD)"
  run bash "${CHECK}" "${BASE}..HEAD" "${REPO}"
  [ "$status" -eq 1 ]
  [[ "$output" == *"${sha}"* && "$output" == *"Claude-Session"* ]] || false
}

@test "fails on a model-named Co-Authored-By" {
  commit_msg "feat: model trailer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  run bash "${CHECK}" "${BASE}..HEAD" "${REPO}"
  [ "$status" -eq 1 ]
  [[ "$output" == *"Co-Authored-By: Claude Opus 5.5"* ]] || false
}

@test "only commits inside the range are checked" {
  git -C "${REPO}" commit --quiet --allow-empty -m "old

Claude-Session: https://claude.ai/code/session_old"
  mid="$(git -C "${REPO}" rev-parse HEAD)"
  commit_msg "feat: clean"
  run bash "${CHECK}" "${mid}..HEAD" "${REPO}"
  [ "$status" -eq 0 ]
}

@test "fails closed when the range does not resolve" {
  run bash "${CHECK}" "nosuchref..HEAD" "${REPO}"
  [ "$status" -ne 0 ]
  [[ "$output" != *"OK: no forbidden trailers"* ]] || false
  [[ "$output" == *"cannot list commits"* ]] || false
}

@test "rejects a missing range and unknown flags" {
  run bash "${CHECK}"
  [ "$status" -eq 2 ]
  run bash "${CHECK}" --bogus
  [ "$status" -eq 2 ]
  [[ "$output" == *"usage"* ]] || false
}

#!/usr/bin/env bats
#
# contribute.sh commits, pushes and opens PRs. Every test runs it against a
# temp clone whose origin is a bare temp repo, with a fake HOME and a stubbed
# gh, so no run can push to the checkout under test (CAT-12: an earlier
# version pushed 232 contrib/demo* branches into the real repo). teardown
# fails the test if the source repo's contrib/* branch list changed.

load helpers

setup() {
  TMP="$(mktemp -d)"
  export HOME="${TMP}/home"
  mkdir -p "${HOME}/.local/bin"
  SCRIPT="${BATS_TEST_DIRNAME}/../../setup/contribute.sh"
  REAL_REPO="${CONTRIBUTE_BATS_SOURCE_REPO:-${BATS_TEST_DIRNAME}/../..}"
  REAL_BRANCHES_BEFORE="$(git -C "${REAL_REPO}" branch --list 'contrib/*')"

  REMOTE="${TMP}/remote.git"
  git init --quiet --bare "${REMOTE}"
  # CI checks out shallow, so the work clone is shallow too; let it push.
  git -C "${REMOTE}" config receive.shallowUpdate true
  export CLAUDE_SKILLS_HOME="${TMP}/repo"
  git clone --quiet "${REAL_REPO}" "${CLAUDE_SKILLS_HOME}"
  git -C "${CLAUDE_SKILLS_HOME}" config user.email t@t
  git -C "${CLAUDE_SKILLS_HOME}" config user.name  Tester
  # contribute.sh switches to main; pin main to the cloned HEAD so tests
  # exercise the current branch's layout, not a stale main. No-op when the
  # clone already checked out main (can't force-update the current branch).
  if [ "$(git -C "${CLAUDE_SKILLS_HOME}" symbolic-ref --short HEAD)" != "main" ]; then
    git -C "${CLAUDE_SKILLS_HOME}" branch -f main HEAD
  fi
  git -C "${CLAUDE_SKILLS_HOME}" remote set-url origin "${REMOTE}"
  git -C "${CLAUDE_SKILLS_HOME}" push --quiet origin main

  # Inline gh stub: logs argv, auth succeeds, pr prints a URL.
  STUB_BIN="${TMP}/bin"
  GH_LOG="${TMP}/gh.log"
  mkdir -p "${STUB_BIN}"
  cat > "${STUB_BIN}/gh" <<EOF
#!/usr/bin/env bash
echo "gh \$*" >> "${GH_LOG}"
case "\$1" in
  pr) echo "https://example/pr/1" ;;
esac
exit 0
EOF
  chmod +x "${STUB_BIN}/gh"
  export PATH="${STUB_BIN}:${PATH}"
  cd "${CLAUDE_SKILLS_HOME}"
}

teardown() {
  local after
  after="$(git -C "${REAL_REPO}" branch --list 'contrib/*')"
  rm -rf "${TMP}"
  [ "${after}" = "${REAL_BRANCHES_BEFORE}" ] || {
    echo "contribute.bats leaked contrib/* branches into ${REAL_REPO}" >&2
    return 1
  }
}

@test "contribute.sh scaffolds a new skill on --skill and pushes to the bare temp remote" {
  run bash "${SCRIPT}" --skill demo --message "demo skill" --no-pr
  [ "$status" -eq 0 ]
  [ -f "${CLAUDE_SKILLS_HOME}/plugins/core-workflow/skills/demo/SKILL.md" ]
  git -C "${CLAUDE_SKILLS_HOME}" log --oneline | grep -q "demo"
  git -C "${REMOTE}" branch --list 'contrib/demo-*' | grep -q contrib/demo-
}

@test "contribute.sh --plugin scaffolds into the named plugin" {
  run bash "${SCRIPT}" --skill demo2 --plugin ios-dev --message "demo2 skill" --no-pr
  [ "$status" -eq 0 ]
  [ -f "${CLAUDE_SKILLS_HOME}/plugins/ios-dev/skills/demo2/SKILL.md" ]
}

@test "contribute.sh --plugin rejects unknown plugin" {
  run bash "${SCRIPT}" --skill demo3 --plugin nope --no-pr
  [ "$status" -ne 0 ]
  [[ "$output" == *"no plugin nope"* ]] || false
}

@test "contribute.sh refuses on dirty tree" {
  echo dirty > "${CLAUDE_SKILLS_HOME}/dirty"
  run bash "${SCRIPT}" --skill demo --no-pr
  [ "$status" -ne 0 ]
  [[ "$output" == *"working tree dirty"* ]] || false
}

@test "contribute.sh preflights gh auth before mutating" {
  # A gh whose auth check fails; never fall through to a real gh on PATH.
  mkdir -p "${TMP}/nogh"
  printf '#!/usr/bin/env bash\nexit 1\n' > "${TMP}/nogh/gh"
  chmod +x "${TMP}/nogh/gh"
  PATH="${TMP}/nogh:${PATH}" run bash "${SCRIPT}" --skill demo --message x --no-pr
  [ "$status" -ne 0 ]
  [[ "$output" == *"gh"* ]] || false
  [ -z "$(git -C "${REMOTE}" branch --list 'contrib/*')" ]
}

# Helpers for capture-mode tests: no commit on the work branch, no push.
assert_no_commit_no_push() {
  [ "$(git -C "${CLAUDE_SKILLS_HOME}" rev-parse HEAD)" = "$(git -C "${CLAUDE_SKILLS_HOME}" rev-parse main)" ]
  [ -z "$(git -C "${REMOTE}" branch --list 'contrib/*')" ]
}

@test "capture mode stops after capture and prints the diff without --commit/--push" {
  mkdir -p "${HOME}/.claude"
  printf '{"effortLevel": "low"}\n' > "${HOME}/.claude/settings.json"
  run bash "${SCRIPT}" --message "capture"
  [ "$status" -eq 0 ]
  [[ "$output" == *"templates/user-settings.json"* ]] || false
  [[ "$output" == *"--commit"* ]] || false
  assert_no_commit_no_push
}

@test "capture mode with a seeded token stops before commit and names the hit" {
  mkdir -p "${HOME}/.claude"
  printf '{"env": {"GITHUB_TOKEN": "ghp_%s"}}\n' "$(printf 'b%.0s' {1..36})" > "${HOME}/.claude/settings.json"
  run bash "${SCRIPT}" --message "capture" --push
  [ "$status" -ne 0 ]
  [[ "$output" == *"env.GITHUB_TOKEN"* ]] || false
  assert_no_commit_no_push
}

@test "capture --push stages only the paths capture wrote, never untracked debris" {
  mkdir -p "${HOME}/.claude/plugins"
  printf '{"effortLevel": "low"}\n' > "${HOME}/.claude/settings.json"
  cp "${BATS_TEST_DIRNAME}/../fixtures/live-state/known_marketplaces.json" "${HOME}/.claude/plugins/"
  # A uv that leaves debris in the repo mid-run, then does the real work.
  real_uv="$(command -v uv)"
  printf '#!/usr/bin/env bash\ntouch "%s/debris.log"\nexec "%s" "$@"\n' "${CLAUDE_SKILLS_HOME}" "${real_uv}" > "${STUB_BIN}/uv"
  chmod +x "${STUB_BIN}/uv"
  run bash "${SCRIPT}" --message "capture" --push --no-pr
  [ "$status" -eq 0 ]
  files="$(git -C "${CLAUDE_SKILLS_HOME}" show --name-only --format= HEAD)"
  [[ "$files" == *"templates/user-settings.json"* ]] || false
  [[ "$files" != *"debris.log"* ]] || false
  [ -f "${CLAUDE_SKILLS_HOME}/debris.log" ]
  git -C "${REMOTE}" branch --list 'contrib/*' | grep -q contrib/
}

@test "--skill commit holds only the scaffolded skill" {
  run bash "${SCRIPT}" --skill demo4 --message "demo4 skill" --no-pr
  [ "$status" -eq 0 ]
  files="$(git -C "${CLAUDE_SKILLS_HOME}" show --name-only --format= HEAD)"
  [ "$files" = "plugins/core-workflow/skills/demo4/SKILL.md" ]
}

@test "--auto-merge queues the merge with gh pr merge --auto" {
  run bash "${SCRIPT}" --skill demo5 --message "demo5 skill" --auto-merge
  [ "$status" -eq 0 ]
  grep -q "^gh pr merge --auto --squash --delete-branch" "${GH_LOG}"
  [[ "$output" == *"queued"* ]] || false
}

@test "--skill fails before any commit when bats or uv is missing" {
  # PATH holds only the tools contribute.sh needs, so bats and uv are absent
  # on every runner (apt puts bats in /usr/bin).
  minbin="${TMP}/minbin"
  mkdir -p "${minbin}"
  for t in bash env git date tr sed mkdir dirname cat; do
    ln -s "$(command -v "$t")" "${minbin}/$t"
  done
  ln -s "${STUB_BIN}/gh" "${minbin}/gh"
  PATH="${minbin}" run bash "${SCRIPT}" --skill demo6 --message x --no-pr
  [ "$status" -ne 0 ]
  [[ "$output" == *"bats"* && "$output" == *"uv"* ]] || false
  [ ! -e "${CLAUDE_SKILLS_HOME}/plugins/core-workflow/skills/demo6" ]
  [ -z "$(git -C "${CLAUDE_SKILLS_HOME}" branch --list 'contrib/*')" ]
}

@test "contribute.sh rejects an unknown flag and lists the accepted ones" {
  run bash "${SCRIPT}" --skil demo
  [ "$status" -eq 2 ]
  [[ "$output" == *"--skill"* && "$output" == *"--push"* ]] || false
}

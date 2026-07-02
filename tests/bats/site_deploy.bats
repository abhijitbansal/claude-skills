#!/usr/bin/env bats

load helpers

setup() {
  TMP="$(mktemp -d)"
  DEPLOY="${BATS_TEST_DIRNAME}/../../plugins/ios-dev/skills/site-pages-deploy-kit/scripts/deploy-site.sh"
  make_fixture_app "${TMP}/app"
  mkdir -p "${TMP}/app/site"
  echo '<html><body>hi</body></html>' > "${TMP}/app/site/index.html"
  git -C "${TMP}/app" add -A
  git -C "${TMP}/app" -c user.email=t@t -c user.name=t commit -qm site
  git init -q --bare "${TMP}/remote.git"
  export SITE_REMOTE="${TMP}/remote.git"
}
teardown() { rm -rf "${TMP}"; }

@test "deploys site subtree to remote main" {
  cd "${TMP}/app"
  run bash "${DEPLOY}"
  [ "$status" -eq 0 ]
  run git -C "${TMP}/remote.git" ls-tree --name-only main
  [[ "$output" == *"index.html"* ]]
}

@test "uncommitted site changes abort" {
  cd "${TMP}/app"
  echo change >> site/index.html
  run bash "${DEPLOY}"
  [ "$status" -ne 0 ]
  [[ "$output" == *"ncommitted"* ]]
}

@test "no SITE_REMOTE, .site-remote, or site.repo aborts with hint" {
  cd "${TMP}/app"
  unset SITE_REMOTE
  sed -i.bak '/repo: /d' .claude/app.yml 2>/dev/null; rm -f .claude/app.yml.bak
  run bash "${DEPLOY}"
  [ "$status" -ne 0 ]
  [[ "$output" == *"site.repo"* ]]
}

@test "app.yml site.repo used when no SITE_REMOTE (ssh form printed redacted-safe)" {
  cd "${TMP}/app"
  unset SITE_REMOTE
  printf 'site:\n  repo: example/demo-site\n' >> .claude/app.yml
  run bash "${DEPLOY}" --dry-run
  [ "$status" -eq 0 ]
  [[ "$output" == *"example/demo-site"* ]]
}

@test "dry-run pushes nothing" {
  cd "${TMP}/app"
  run bash "${DEPLOY}" --dry-run
  [ "$status" -eq 0 ]
  run git -C "${TMP}/remote.git" ls-tree --name-only main
  [[ "$output" != *"index.html"* ]]
}

@test "userinfo in remote URL is redacted in output" {
  cd "${TMP}/app"
  export SITE_REMOTE="https://user:tok3n@github.com/x/y.git"
  run bash "${DEPLOY}" --dry-run
  [[ "$output" != *"tok3n"* ]]
}

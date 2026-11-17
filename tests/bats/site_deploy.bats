#!/usr/bin/env bats

load helpers

setup() {
  TMP="$(mktemp -d)"
  export HOME="${TMP}/home"
  mkdir -p "${HOME}"
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

# --- CAT-50: strict flags on a public push path -------------------------------

remote_has_main() { git -C "${TMP}/remote.git" rev-parse --verify -q refs/heads/main >/dev/null; }
no_main() { ! remote_has_main; }

@test "misspelled --dryrun exits 2 listing accepted flags and pushes nothing" {
  cd "${TMP}/app"
  run bash "${DEPLOY}" --dryrun
  [ "$status" -eq 2 ]
  [[ "$output" == *"--dry-run"* ]] || false
  no_main
}

@test "extra positional argument exits 2 and pushes nothing" {
  cd "${TMP}/app"
  run bash "${DEPLOY}" --dry-run now
  [ "$status" -eq 2 ]
  no_main
}

@test "--help exits 0 and pushes nothing" {
  cd "${TMP}/app"
  run bash "${DEPLOY}" --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"--dry-run"* ]] || false
  no_main
}

# --- CAT-73: CNAME survives the force-push -------------------------------------

@test "site.domain set but site/CNAME missing aborts before pushing" {
  cd "${TMP}/app"
  printf 'site:\n  domain: demo.app\n' >> .claude/app.yml
  run bash "${DEPLOY}"
  [ "$status" -eq 1 ]
  [[ "$output" == *"CNAME"* ]] || false
  no_main
}

@test "site.domain set and site/CNAME committed deploys it" {
  cd "${TMP}/app"
  printf 'site:\n  domain: demo.app\n' >> .claude/app.yml
  printf 'demo.app\n' > site/CNAME
  git add -A && git -c user.email=t@t -c user.name=t commit -qm cname
  run bash "${DEPLOY}"
  [ "$status" -eq 0 ]
  run git -C "${TMP}/remote.git" ls-tree --name-only main
  [[ "$output" == *"CNAME"* ]] || false
}

# --- CAT-74: standalone template honours SITE_DIR and strict flags -------------

render_template() {  # $1 = site dir token value
  mkdir -p "${TMP}/app/scripts"
  sed -e "s|{{SITE_REPO}}|example/demo-site|g" -e "s|{{SITE_DIR}}|$1|g" \
    "${BATS_TEST_DIRNAME}/../../plugins/ios-dev/skills/site-pages-deploy-kit/templates/deploy-site.sh" \
    > "${TMP}/app/scripts/deploy-site.sh"
}

@test "template deploy-site.sh deploys a custom {{SITE_DIR}}" {
  cd "${TMP}/app"
  mkdir web && echo '<html>web</html>' > web/index.html
  render_template web
  git add -A && git -c user.email=t@t -c user.name=t commit -qm web
  run bash scripts/deploy-site.sh
  [ "$status" -eq 0 ]
  [[ "$output" == *"web/"* ]] || false
  run git -C "${TMP}/remote.git" show main:index.html
  [[ "$output" == *"web"* ]] || false
}

@test "template deploy-site.sh rejects --dryrun and pushes nothing" {
  cd "${TMP}/app"
  render_template site
  git add -A && git -c user.email=t@t -c user.name=t commit -qm tpl
  run bash scripts/deploy-site.sh --dryrun
  [ "$status" -eq 2 ]
  [[ "$output" == *"--dry-run"* ]] || false
  no_main
}

@test "template deploy-site.sh --dry-run pushes nothing" {
  cd "${TMP}/app"
  render_template site
  git add -A && git -c user.email=t@t -c user.name=t commit -qm tpl
  run bash scripts/deploy-site.sh --dry-run
  [ "$status" -eq 0 ]
  no_main
}

@test "template has no hard-coded site dir once rendered" {
  render_template web
  [ -z "$(grep -e '--prefix=site' -e 'porcelain -- site' -e 'status -- site' -e 'SITE_DIR="site"' "${TMP}/app/scripts/deploy-site.sh" || true)" ]
  grep -q 'SITE_DIR="web"' "${TMP}/app/scripts/deploy-site.sh"
  [ -z "$(grep '{{' "${TMP}/app/scripts/deploy-site.sh" || true)" ]
}

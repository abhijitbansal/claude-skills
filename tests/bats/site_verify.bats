#!/usr/bin/env bats

load helpers

setup() {
  TMP="$(mktemp -d)"
  VERIFY="${BATS_TEST_DIRNAME}/../../plugins/ios-dev/skills/site-pages-deploy-kit/scripts/verify-site.sh"
  SITE="${TMP}/site"
  mkdir -p "${SITE}"
  make_png "${SITE}/og-card.png" 32 32
  make_png "${SITE}/apple-touch-icon.png" 32 32
  : > "${SITE}/favicon.ico"
  good_page "${SITE}/index.html"
}
teardown() { rm -rf "${TMP}"; }

good_page() {
  cat > "$1" <<'HTML'
<!DOCTYPE html>
<html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'self'">
<meta property="og:image" content="https://demo.app/og-card.png">
<meta property="og:image:width" content="32">
<meta property="og:image:height" content="32">
</head><body>hi</body></html>
HTML
}

@test "well-formed site passes, exit 0" {
  run bash "${VERIFY}" "${SITE}"
  [ "$status" -eq 0 ]
  [[ "$output" != *"FAIL"* ]]
}

@test "missing og:image FAILs" {
  grep -v 'og:image"' "${SITE}/index.html" > "${SITE}/tmp" && grep -v 'property="og:image"' "${SITE}/tmp" > "${SITE}/index.html"
  sed -i.bak '/og:image" /d; /property="og:image"/d' "${SITE}/index.html"; rm -f "${SITE}/index.html.bak" "${SITE}/tmp"
  run bash "${VERIFY}" "${SITE}"
  [ "$status" -eq 1 ]
  [[ "$output" == *"og:image"* ]]
}

@test "wrong declared og dimensions FAIL against actual PNG pixels" {
  sed -i.bak 's/content="32"/content="64"/' "${SITE}/index.html"; rm -f "${SITE}/index.html.bak"
  run bash "${VERIFY}" "${SITE}"
  [ "$status" -eq 1 ]
  [[ "$output" == *"og declared"* ]]
}

@test "external font link FAILs" {
  sed -i.bak 's#</head>#<link href="https://fonts.googleapis.com/css2?family=X" rel="stylesheet"></head>#' "${SITE}/index.html"; rm -f "${SITE}/index.html.bak"
  run bash "${VERIFY}" "${SITE}"
  [ "$status" -eq 1 ]
  [[ "$output" == *"external"* ]]
}

@test "missing CSP meta FAILs" {
  sed -i.bak '/Content-Security-Policy/d' "${SITE}/index.html"; rm -f "${SITE}/index.html.bak"
  run bash "${VERIFY}" "${SITE}"
  [ "$status" -eq 1 ]
  [[ "$output" == *"CSP"* ]]
}

@test "missing favicon FAILs" {
  rm "${SITE}/favicon.ico"
  run bash "${VERIFY}" "${SITE}"
  [ "$status" -eq 1 ]
  [[ "$output" == *"favicon.ico"* ]]
}

@test "rendered site skeleton passes verify" {
  SKEL="${BATS_TEST_DIRNAME}/../../plugins/ios-dev/skills/site-pages-deploy-kit/templates/site-skeleton"
  OUT="${TMP}/skel"
  mkdir -p "${OUT}"
  cp -R "${SKEL}/." "${OUT}/"
  for f in "${OUT}"/*.html "${OUT}/CNAME" "${OUT}/.well-known/apple-app-site-association"; do
    sed -i.bak -e 's/{{APP_NAME}}/Demo/g' -e 's/{{SITE_DOMAIN}}/demo.app/g' \
      -e 's/{{APP_TEAM_ID}}/ABCDE12345/g' -e 's/{{APP_BUNDLE_ID}}/com.example.demo/g' "${f}"
    rm -f "${f}.bak"
  done
  make_png "${OUT}/og-card.png" 1200 630
  make_png "${OUT}/apple-touch-icon.png" 180 180
  : > "${OUT}/favicon.ico"
  run bash "${VERIFY}" "${OUT}"
  [ "$status" -eq 0 ]
  [[ "$output" != *"FAIL"* ]]
}

# --- CAT-73 / CAT-74: false passes and drift --------------------------------

with_domain() {  # run verify from a repo whose app.yml sets site.domain
  mkdir -p "${TMP}/.claude"
  printf 'app:\n  name: Demo\n  bundle_id: com.example.demo\n  scheme: Demo\n  team_id: ABCDE12345\n  url_scheme: demo\nsite:\n  domain: demo.app\n' > "${TMP}/.claude/app.yml"
  cd "${TMP}"
}

@test "og:image whose file is missing locally FAILs" {
  rm "${SITE}/og-card.png"
  run bash "${VERIFY}" "${SITE}"
  [ "$status" -eq 1 ]
  [[ "$output" == *"og:image file"* ]] || false
}

@test "og:image with an empty host FAILs" {
  sed -i.bak 's#https://demo.app/og-card.png#https:///og-card.png#' "${SITE}/index.html"; rm -f "${SITE}/index.html.bak"
  run bash "${VERIFY}" "${SITE}"
  [ "$status" -eq 1 ]
  [[ "$output" == *"host"* ]] || false
}

@test "external <script src> FAILs" {
  sed -i.bak 's#</head>#<script src="https://cdn.example.com/x.js"></script></head>#' "${SITE}/index.html"; rm -f "${SITE}/index.html.bak"
  run bash "${VERIFY}" "${SITE}"
  [ "$status" -eq 1 ]
  [[ "$output" == *"<script"* ]] || false
}

@test "protocol-relative <script src> FAILs" {
  sed -i.bak 's#</head>#<script src="//cdn.example.com/x.js"></script></head>#' "${SITE}/index.html"; rm -f "${SITE}/index.html.bak"
  run bash "${VERIFY}" "${SITE}"
  [ "$status" -eq 1 ]
}

@test "same-origin <script src> passes" {
  sed -i.bak 's#</head>#<script src="assets/app.js"></script></head>#' "${SITE}/index.html"; rm -f "${SITE}/index.html.bak"
  run bash "${VERIFY}" "${SITE}"
  [ "$status" -eq 0 ]
}

@test "rel=canonical link is exempt from the external-link check" {
  sed -i.bak 's#</head>#<link rel="canonical" href="https://demo.app/"></head>#' "${SITE}/index.html"; rm -f "${SITE}/index.html.bak"
  run bash "${VERIFY}" "${SITE}"
  [ "$status" -eq 0 ]
  [[ "$output" != *"FAIL"* ]] || false
}

@test "href-before-rel canonical is also exempt" {
  sed -i.bak 's#</head>#<link href="https://demo.app/" rel="canonical"></head>#' "${SITE}/index.html"; rm -f "${SITE}/index.html.bak"
  run bash "${VERIFY}" "${SITE}"
  [ "$status" -eq 0 ]
}

@test "site.domain set but CNAME missing FAILs" {
  with_domain
  run bash "${VERIFY}" "${SITE}"
  [ "$status" -eq 1 ]
  [[ "$output" == *"CNAME"* ]] || false
}

@test "site.domain set and CNAME matching passes" {
  with_domain
  printf 'demo.app\n' > "${SITE}/CNAME"
  run bash "${VERIFY}" "${SITE}"
  [ "$status" -eq 0 ]
  [[ "$output" != *"FAIL"* ]] || false
}

@test "CNAME naming a different domain FAILs" {
  with_domain
  printf 'other.example\n' > "${SITE}/CNAME"
  run bash "${VERIFY}" "${SITE}"
  [ "$status" -eq 1 ]
  [[ "$output" == *"CNAME"* ]] || false
}

@test "no site.domain: CNAME is not required" {
  cd "${TMP}"
  run bash "${VERIFY}" "${SITE}"
  [ "$status" -eq 0 ]
}

@test "unrendered {{token}} in a page FAILs" {
  sed -i.bak 's#<body>hi#<body>{{APP_NAME}}#' "${SITE}/index.html"; rm -f "${SITE}/index.html.bak"
  run bash "${VERIFY}" "${SITE}"
  [ "$status" -eq 1 ]
  [[ "$output" == *"unrendered"* ]] || false
}

nav_page() {  # $1 file, $2.. = hrefs
  local f="$1"; shift
  local links="" h
  for h in "$@"; do links="${links}<a href=\"${h}\">x</a>"; done
  cat > "${f}" <<HTML
<!DOCTYPE html>
<html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'self'">
<meta property="og:image" content="https://demo.app/og-card.png">
<meta property="og:image:width" content="32">
<meta property="og:image:height" content="32">
</head><body><nav>${links}</nav>hi</body></html>
HTML
}

@test "page whose nav drops a link FAILs with the missing target" {
  nav_page "${SITE}/index.html" index.html privacy.html support.html
  nav_page "${SITE}/privacy.html" index.html privacy.html
  run bash "${VERIFY}" "${SITE}"
  [ "$status" -eq 1 ]
  [[ "$output" == *"nav"* ]] || false
  [[ "$output" == *"support.html"* ]] || false
}

@test "identical navs across pages pass" {
  nav_page "${SITE}/index.html" index.html privacy.html
  nav_page "${SITE}/privacy.html" index.html privacy.html
  run bash "${VERIFY}" "${SITE}"
  [ "$status" -eq 0 ]
}

@test "nav links compare after resolving relative paths and ignoring externals" {
  mkdir -p "${SITE}/docs"
  nav_page "${SITE}/index.html" index.html docs/guide.html "https://github.com/x/y"
  nav_page "${SITE}/docs/guide.html" ../index.html guide.html "mailto:a@b.c" "#top"
  run bash "${VERIFY}" "${SITE}"
  [ "$status" -eq 0 ]
}

@test "home-page anchors compare equal to a subpage nav that links back with ../#anchor" {
  mkdir -p "${SITE}/privacy"
  nav_page "${SITE}/index.html" "#features" privacy/
  nav_page "${SITE}/privacy/index.html" "../#features" ./
  run bash "${VERIFY}" "${SITE}"
  [ "$status" -eq 0 ]
  [[ "$output" != *"FAIL"* ]]
}

@test "subpage nav missing a link the home page has still FAILs when anchors are involved" {
  mkdir -p "${SITE}/privacy"
  nav_page "${SITE}/index.html" "#features" privacy/ support.html
  nav_page "${SITE}/privacy/index.html" "../#features" ./
  run bash "${VERIFY}" "${SITE}"
  [ "$status" -eq 1 ]
  [[ "$output" == *"support.html"* ]] || false
}

@test "a second <nav> (TOC or breadcrumb) on a page does not count toward the site nav" {
  nav_page "${SITE}/index.html" index.html privacy.html
  nav_page "${SITE}/privacy.html" index.html privacy.html
  sed -i.bak 's#hi</body>#<nav class="toc"><a href="\#data">Data</a><a href="extra-page.html">Extra</a></nav>hi</body>#' "${SITE}/privacy.html"; rm -f "${SITE}/privacy.html.bak"
  grep -q 'class="toc"' "${SITE}/privacy.html"
  run bash "${VERIFY}" "${SITE}"
  [ "$status" -eq 0 ]
  [[ "$output" != *"FAIL"* ]]
}

@test "the first <nav> still decides: a differing first nav FAILs even with a TOC nav after it" {
  nav_page "${SITE}/index.html" index.html privacy.html support.html
  nav_page "${SITE}/privacy.html" index.html privacy.html
  sed -i.bak 's#hi</body>#<nav class="toc"><a href="support.html">S</a></nav>hi</body>#' "${SITE}/privacy.html"; rm -f "${SITE}/privacy.html.bak"
  run bash "${VERIFY}" "${SITE}"
  [ "$status" -eq 1 ]
  [[ "$output" == *"support.html"* ]] || false
}

@test "github.io project-site og:image resolves past the repo-name base path" {
  sed -i.bak 's#https://demo.app/og-card.png#https://user.github.io/demo-site/og-card.png#' "${SITE}/index.html"; rm -f "${SITE}/index.html.bak"
  run bash "${VERIFY}" "${SITE}"
  [ "$status" -eq 0 ]
  [[ "$output" != *"FAIL"* ]]
}

@test "github.io project-site og:image still FAILs when no file matches under or past the base path" {
  sed -i.bak 's#https://demo.app/og-card.png#https://user.github.io/demo-site/missing.png#' "${SITE}/index.html"; rm -f "${SITE}/index.html.bak"
  run bash "${VERIFY}" "${SITE}"
  [ "$status" -eq 1 ]
  [[ "$output" == *"og:image file"* ]] || false
}

@test "a base path on a non-github.io host is not stripped" {
  sed -i.bak 's#https://demo.app/og-card.png#https://demo.app/demo-site/og-card.png#' "${SITE}/index.html"; rm -f "${SITE}/index.html.bak"
  run bash "${VERIFY}" "${SITE}"
  [ "$status" -eq 1 ]
  [[ "$output" == *"og:image file"* ]] || false
}

@test "stretched image (attr aspect differs from pixels) FAILs" {
  make_png "${SITE}/shot.png" 100 200
  sed -i.bak 's#<body>hi#<body><img src="shot.png" width="300" height="200" alt="">#' "${SITE}/index.html"; rm -f "${SITE}/index.html.bak"
  run bash "${VERIFY}" "${SITE}"
  [ "$status" -eq 1 ]
  [[ "$output" == *"aspect"* ]] || false
}

@test "image with proportional width/height attributes passes" {
  make_png "${SITE}/shot.png" 100 200
  sed -i.bak 's#<body>hi#<body><img src="shot.png" width="50" height="100" alt="">#' "${SITE}/index.html"; rm -f "${SITE}/index.html.bak"
  run bash "${VERIFY}" "${SITE}"
  [ "$status" -eq 0 ]
}

@test "skeleton AASA excludes legal pages and has no catch-all component" {
  AASA="${BATS_TEST_DIRNAME}/../../plugins/ios-dev/skills/site-pages-deploy-kit/templates/site-skeleton/.well-known/apple-app-site-association"
  [ -z "$(grep -F '"/*"' "${AASA}" || true)" ]
  grep -q '/privacy' "${AASA}"
  grep -q '/support' "${AASA}"
  grep -q '"exclude": true' "${AASA}"
}

@test "skeleton ships .nojekyll and a CNAME template" {
  SKEL="${BATS_TEST_DIRNAME}/../../plugins/ios-dev/skills/site-pages-deploy-kit/templates/site-skeleton"
  [ -f "${SKEL}/.nojekyll" ]
  [ "$(cat "${SKEL}/CNAME")" = "{{SITE_DOMAIN}}" ]
}

@test "rendered skeleton with domain passes verify including CNAME and AASA" {
  SKEL="${BATS_TEST_DIRNAME}/../../plugins/ios-dev/skills/site-pages-deploy-kit/templates/site-skeleton"
  OUT="${TMP}/skel2"
  mkdir -p "${OUT}"
  cp -R "${SKEL}/." "${OUT}/"
  for f in "${OUT}"/*.html "${OUT}/CNAME" "${OUT}/.well-known/apple-app-site-association"; do
    sed -i.bak -e 's/{{APP_NAME}}/Demo/g' -e 's/{{SITE_DOMAIN}}/demo.app/g' \
      -e 's/{{APP_TEAM_ID}}/ABCDE12345/g' -e 's/{{APP_BUNDLE_ID}}/com.example.demo/g' "${f}"
    rm -f "${f}.bak"
  done
  make_png "${OUT}/og-card.png" 1200 630
  make_png "${OUT}/apple-touch-icon.png" 180 180
  : > "${OUT}/favicon.ico"
  with_domain
  run bash "${VERIFY}" "${OUT}"
  [ "$status" -eq 0 ]
  [[ "$output" != *"FAIL"* ]] || false
}

@test "site with unrendered AASA token FAILs" {
  mkdir -p "${SITE}/.well-known"
  printf '{"applinks":{"details":[{"appIDs":["{{APP_TEAM_ID}}.x"]}]}}\n' > "${SITE}/.well-known/apple-app-site-association"
  run bash "${VERIFY}" "${SITE}"
  [ "$status" -eq 1 ]
  [[ "$output" == *"unrendered"* ]] || false
}

# --- CAT-74: public og-card generator ---------------------------------------

OGCARD() { echo "${BATS_TEST_DIRNAME}/../../plugins/ios-dev/skills/site-pages-deploy-kit/scripts/og-card.py"; }

png_dims() { python3 - "$1" <<'PY'
import struct, sys
with open(sys.argv[1], "rb") as f:
    f.seek(16)
    print("%dx%d" % struct.unpack(">II", f.read(8)))
PY
}

@test "og-card.py --no-text writes a 1200x630 PNG that verify-site accepts" {
  run python3 "$(OGCARD)" --out "${SITE}/og-card.png" --no-text --force
  [ "$status" -eq 0 ]
  [ "$(png_dims "${SITE}/og-card.png")" = "1200x630" ]
  sed -i.bak -e 's/og:image:width" content="32"/og:image:width" content="1200"/' \
    -e 's/og:image:height" content="32"/og:image:height" content="630"/' "${SITE}/index.html"; rm -f "${SITE}/index.html.bak"
  run bash "${VERIFY}" "${SITE}"
  [ "$status" -eq 0 ]
}

@test "og-card.py with a title renders 1200x630 via Pillow" {
  python3 -c "import PIL" 2>/dev/null || skip "Pillow not installed"
  run python3 "$(OGCARD)" --out "${TMP}/out/og-card.png" --title "Demo" --subtitle "Tagline"
  [ "$status" -eq 0 ]
  [ "$(png_dims "${TMP}/out/og-card.png")" = "1200x630" ]
}

@test "og-card.py leaves an existing card alone without --force" {
  printf 'keep' > "${TMP}/card.png"
  run python3 "$(OGCARD)" --out "${TMP}/card.png" --no-text
  [ "$status" -eq 0 ]
  [ "$(cat "${TMP}/card.png")" = "keep" ]
}

@test "og-card.py rejects an unknown flag with exit 2 and lists accepted ones" {
  run python3 "$(OGCARD)" --out "${TMP}/card.png" --no-txt
  [ "$status" -eq 2 ]
  [[ "$output" == *"--no-text"* ]] || false
  [ ! -f "${TMP}/card.png" ]
}

@test "og-card.py without --title or --no-text exits 2 and writes nothing" {
  run python3 "$(OGCARD)" --out "${TMP}/card.png"
  [ "$status" -eq 2 ]
  [ ! -f "${TMP}/card.png" ]
}

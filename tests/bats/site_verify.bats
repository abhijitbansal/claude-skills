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

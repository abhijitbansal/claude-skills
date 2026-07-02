#!/usr/bin/env bash
# Lint the app site for the unfurl/CSP/asset bugs that recurred across
# doc-scan, floorprint and sift: og:image absolute + true dimensions,
# CSP meta present, self-hosted assets only, favicon set complete.
#
# Usage: verify-site.sh [site-dir]   (default: app.yml site.dir, else ./site)
# Output: PASS/FAIL lines; exit 1 on any FAIL.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../_lib/load_app_config.sh
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/../../_lib/load_app_config.sh" 2>/dev/null || true

DIR="${1:-${SITE_DIR:-site}}"
[[ -d "${DIR}" ]] || { echo "FAIL: site dir '${DIR}' not found"; exit 1; }

python3 - "${DIR}" <<'PY'
import os, re, struct, sys

d = sys.argv[1]
fails = 0

def fail(msg):
    global fails
    print(f"FAIL: {msg}")
    fails += 1

def png_size(path):
    with open(path, "rb") as f:
        f.seek(16)
        return struct.unpack(">II", f.read(8))

for root, _, files in os.walk(d):
    for name in sorted(files):
        if not name.endswith(".html"):
            continue
        page = os.path.join(root, name)
        html = open(page, encoding="utf-8", errors="replace").read()
        page_fails = fails

        def meta(prop):
            m = re.search(rf'property="{prop}"\s+content="([^"]+)"', html) or \
                re.search(rf'content="([^"]+)"\s+property="{prop}"', html)
            return m.group(1) if m else None

        og = meta("og:image")
        if not og or not og.startswith("http"):
            fail(f"{page}: og:image missing or not an absolute URL")
        else:
            w, h = meta("og:image:width"), meta("og:image:height")
            if not (w and h):
                fail(f"{page}: og:image:width/height missing (Teams/iMessage unfurl needs them)")
            else:
                local = os.path.join(d, os.path.basename(og))
                if os.path.exists(local):
                    pw, ph = png_size(local)
                    if (int(w), int(h)) != (pw, ph):
                        fail(f"{page}: og declared {w}x{h} but {os.path.basename(og)} is {pw}x{ph}")

        if re.search(r'<link[^>]+href="http', html):
            fail(f"{page}: external <link> resource — self-host fonts/assets (CSP + privacy)")
        if 'http-equiv="Content-Security-Policy"' not in html:
            fail(f"{page}: no CSP meta tag")

        if fails == page_fails:
            print(f"PASS: {page}")

for icon in ("favicon.ico", "apple-touch-icon.png"):
    if not os.path.exists(os.path.join(d, icon)):
        fail(f"{icon} missing from site root")

sys.exit(1 if fails else 0)
PY

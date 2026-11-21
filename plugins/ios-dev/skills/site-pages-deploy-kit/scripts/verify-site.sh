#!/usr/bin/env bash
# Lint the app site for the unfurl/CSP/asset/nav bugs that recurred across
# private sites: og:image absolute + real file + true dimensions, CSP meta
# present, self-hosted assets only (no external <link>/<script>), complete
# favicon set, the same <nav> links on every page, undistorted <img> aspect,
# CNAME present when site.domain is set, no unrendered {{tokens}}.
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

SITE_DOMAIN="${SITE_DOMAIN:-}" python3 - "${DIR}" <<'PY'
import json, os, posixpath, re, struct, sys
from urllib.parse import urlparse

d = sys.argv[1]
domain = os.environ.get("SITE_DOMAIN", "").strip()
fails = 0

ASPECT_TOLERANCE = 0.02   # relative; attribute aspect vs real pixels
TOKEN_RE = re.compile(r"\{\{[A-Za-z0-9_]+\}\}")


def fail(msg):
    global fails
    print(f"FAIL: {msg}")
    fails += 1


def png_size(path):
    with open(path, "rb") as f:
        f.seek(16)
        return struct.unpack(">II", f.read(8))


def jpeg_size(path):
    with open(path, "rb") as f:
        data = f.read()
    i = 2
    while i + 9 < len(data):
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker in (0xC0, 0xC1, 0xC2):
            h, w = struct.unpack(">HH", data[i + 5:i + 9])
            return w, h
        i += 2 + struct.unpack(">H", data[i + 2:i + 4])[0]
    return None


def image_size(path):
    try:
        with open(path, "rb") as f:
            head = f.read(8)
        if head.startswith(b"\x89PNG"):
            return png_size(path)
        if head.startswith(b"\xff\xd8"):
            return jpeg_size(path)
    except (OSError, struct.error):
        pass
    return None


def is_external(url):
    return bool(re.match(r"^([a-z][a-z0-9+.-]*:|//)", url, re.I))


def resolve(rel_page, href):
    """Site-root-relative path a href points at, or None for non-page links."""
    href = href.split("#")[0].split("?")[0].strip()
    if not href or is_external(href):
        return None
    if href.startswith("/"):
        target = href.lstrip("/")
    else:
        target = posixpath.join(posixpath.dirname(rel_page), href)
    target = posixpath.normpath(target) if target else "."
    if href.endswith("/") or target == ".":
        target = posixpath.join("" if target == "." else target, "index.html")
    return target


def og_local_path(parsed):
    """Site-dir file an og:image URL maps to. A github.io project site serves the
    site dir under /<repo>/, so retry once without that base-path segment."""
    path = parsed.path.lstrip("/")
    local = os.path.join(d, path)
    parts = path.split("/", 1)
    if not os.path.isfile(local) and parsed.netloc.endswith(".github.io") and len(parts) == 2:
        return os.path.join(d, parts[1])
    return local


def nav_links(rel_page, html):
    # Only the FIRST <nav> is the site nav; a later TOC or breadcrumb <nav> must
    # neither add links to the comparison nor mask a missing one.
    nav = re.search(r"<nav\b.*?</nav>", html, re.S | re.I)
    if not nav:
        return None
    hrefs = re.findall(r'href="([^"]*)"', nav.group(0))
    targets = set()
    for h in hrefs:
        # The home page's own "#features" is the same link a subpage writes as
        # "../#features" or "index.html#features"; elsewhere a bare anchor is ignored.
        target = rel_page if h.startswith("#") and rel_page == "index.html" else resolve(rel_page, h)
        if target:
            targets.add(target)
    return targets


# ---- collect pages --------------------------------------------------------
pages = {}
for root, _, files in os.walk(d):
    for name in sorted(files):
        if name.endswith(".html"):
            path = os.path.join(root, name)
            rel = os.path.relpath(path, d).replace(os.sep, "/")
            pages[rel] = (path, open(path, encoding="utf-8", errors="replace").read())

navs = {rel: nav_links(rel, html) for rel, (_, html) in pages.items()}
with_nav = sorted(rel for rel, links in navs.items() if links is not None)
ref = "index.html" if navs.get("index.html") is not None else (with_nav[0] if with_nav else None)

for rel in sorted(pages):
    page, html = pages[rel]
    page_fails = fails

    def meta(prop):
        m = re.search(rf'property="{prop}"\s+content="([^"]+)"', html) or \
            re.search(rf'content="([^"]+)"\s+property="{prop}"', html)
        return m.group(1) if m else None

    if TOKEN_RE.search(html):
        fail(f"{page}: unrendered {TOKEN_RE.search(html).group(0)} token left in page")

    og = meta("og:image")
    if not og or not og.startswith("http"):
        fail(f"{page}: og:image missing or not an absolute URL")
    else:
        parsed = urlparse(og)
        w, h = meta("og:image:width"), meta("og:image:height")
        if not (w and h):
            fail(f"{page}: og:image:width/height missing (Teams/iMessage unfurl needs them)")
        if not parsed.netloc:
            fail(f"{page}: og:image has an empty host ({og})")
        else:
            local = og_local_path(parsed)
            if not os.path.isfile(local):
                fail(f"{page}: og:image file {parsed.path} not found in the site dir")
            elif w and h:
                size = image_size(local)
                if size and (int(w), int(h)) != size:
                    fail(f"{page}: og declared {w}x{h} but {os.path.basename(local)} is {size[0]}x{size[1]}")

    for tag in re.findall(r"<link\b[^>]*>", html, re.I):
        if re.search(r'href="(https?:)?//', tag) and not re.search(r'rel="[^"]*\bcanonical\b', tag, re.I):
            fail(f"{page}: external <link> resource — self-host fonts/assets (CSP + privacy)")
            break
    for m in re.finditer(r'<script\b[^>]*\bsrc="((?:https?:)?//[^"]+)"', html, re.I):
        fail(f"{page}: external <script src=\"{m.group(1)}\"> — self-host scripts (CSP + privacy)")
    if 'http-equiv="Content-Security-Policy"' not in html:
        fail(f"{page}: no CSP meta tag")

    for tag in re.findall(r"<img\b[^>]*>", html, re.I):
        src = re.search(r'\bsrc="([^"]+)"', tag)
        iw = re.search(r'\bwidth="(\d+)"', tag)
        ih = re.search(r'\bheight="(\d+)"', tag)
        if not (src and iw and ih) or is_external(src.group(1)):
            continue
        target = resolve(rel, src.group(1))
        size = image_size(os.path.join(d, target)) if target else None
        if not size or not int(ih.group(1)):
            continue
        attr_ratio = int(iw.group(1)) / int(ih.group(1))
        real_ratio = size[0] / size[1]
        if abs(attr_ratio - real_ratio) / real_ratio > ASPECT_TOLERANCE:
            fail(f"{page}: <img src=\"{src.group(1)}\"> aspect {iw.group(1)}x{ih.group(1)} differs from file {size[0]}x{size[1]} (stretched)")

    if ref and rel != ref:
        links = navs[rel]
        if links is None:
            if rel != "404.html":
                fail(f"{page}: no <nav> (other pages have one, e.g. {ref})")
        else:
            missing, extra = sorted(navs[ref] - links), sorted(links - navs[ref])
            if missing or extra:
                parts = []
                if missing:
                    parts.append("missing " + ", ".join(missing))
                if extra:
                    parts.append("extra " + ", ".join(extra))
                fail(f"{page}: nav links differ from {ref}: {'; '.join(parts)}")

    if fails == page_fails:
        print(f"PASS: {page}")

# ---- site-level files -----------------------------------------------------
for icon in ("favicon.ico", "apple-touch-icon.png"):
    if not os.path.exists(os.path.join(d, icon)):
        fail(f"{icon} missing from site root")

cname = os.path.join(d, "CNAME")
if domain:
    if not os.path.isfile(cname):
        fail(f"CNAME missing — site.domain is '{domain}' and a force-push deploy drops the custom domain without it")
    elif open(cname).read().strip() != domain:
        fail(f"CNAME names '{open(cname).read().strip()}' but site.domain is '{domain}'")

for rel in ("CNAME", ".well-known/apple-app-site-association", "apple-app-site-association"):
    path = os.path.join(d, rel)
    if not os.path.isfile(path):
        continue
    text = open(path, encoding="utf-8", errors="replace").read()
    if TOKEN_RE.search(text):
        fail(f"{rel}: unrendered {TOKEN_RE.search(text).group(0)} token left in file")
    elif rel.endswith("association"):
        try:
            json.loads(text)
        except ValueError as exc:
            fail(f"{rel}: not valid JSON ({exc})")

sys.exit(1 if fails else 0)
PY

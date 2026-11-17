---
name: site-og-favicon-verify
description: Teams/iMessage/Slack link unfurl shows no image, a stretched image, or a generic card; favicon missing in tabs; fonts blocked by CSP. Use when a shared app-site link previews wrong, when adding og/meta tags, or when the site verify lint fails. The recurring root causes are relative og:image URLs, missing og:image:width/height, externally-hosted fonts vs strict CSP, and an incomplete favicon set.
---

# Site metadata: unfurl, favicon, CSP

The same three bugs shipped independently in three private sites
(`fix(meta): Teams titled-link preview — static og:image + dimensions`,
`fix(site): self-host fonts and add CSP meta`, `feat: complete favicon set`).
This skill is the checklist; `site-pages-deploy-kit/scripts/verify-site.sh`
is the executable version.

## Rules

**1. og:image must be an ABSOLUTE URL with explicit dimensions.**
Teams (and some Slack contexts) will not fetch a relative og:image, and
without `og:image:width`/`og:image:height` the first unfurl renders blank or
mis-scaled (the scraper won't wait to measure). Declared dims must match the
real pixels:

```html
<meta property="og:image" content="https://example.app/og-card.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
```

1200×630 is the safe cross-platform card size. Use one static, committed
og-card.png per site — not a dynamically-routed image.

**2. Self-host fonts; ship a strict CSP.**
`<link href="https://fonts.googleapis.com/…">` breaks under
`default-src 'self'` CSP and leaks visitor IPs to a third party. Vendor the
woff2, then:

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self'; style-src 'self'">
```

**3. Complete favicon set at the site root.**
Minimum: `favicon.ico` + `apple-touch-icon.png` (180×180). Generate all icon
sizes + the og card from ONE master image with an idempotent script so a
rebrand is one re-run. The kit ships the card generator:
`site-pages-deploy-kit/scripts/og-card.py` (1200×630, skips an existing file
unless `--force`).

**4. Progressive enhancement.**
Content visible with JS disabled — scrapers don't run your JS. (a private document-scanner app:
`content defaults visible if GSAP CDN fails to load`.)

## Verify

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/site-pages-deploy-kit/scripts/verify-site.sh" site
```

Smoke-test a real unfurl after deploying: paste the URL into Teams/iMessage —
first impressions cache, so verify BEFORE sharing widely.

## Markup is right but Teams shows a bare link

Teams has two separate pipelines, and a correct page can still look bare in
one of them. Work out which one you are seeing before changing any markup:

- **Paste from the Edge address bar** produces a titled link from the clipboard
  with no fetch at all. A plain-text paste does the same. Neither reads your
  og tags.
- **The crawler** fetches static HTML (it does not run JS), reads `twitter:card`
  first, and keeps an aggressive, sticky negative cache for a URL that once
  failed. Fixing the page does not clear that cache.

Diagnostic, in order:

1. Paste `https://<site>/?v=2` copied from Edge into a fresh chat. A new query
   string sidesteps the negative cache; if the card appears, the markup was
   fine and the old URL was cached.
2. Diff the live head against a page that unfurls correctly (same host if you
   have one): `curl -s <url> | sed -n '/<head>/,/<\/head>/p'` for both and
   compare the meta tags, `<link>` tags and any `ld+json`.
3. Check the image itself: `curl -sI <og:image url>` must return 200 with
   `content-type: image/png` (or jpeg), and the declared
   `og:image:width/height` must equal the file's real pixels.
4. Change one lever at a time and re-test with a fresh `?v=N` each time.

Sources disagree on what Teams gates on (one project found a static raster
og:image was the only trigger, another found page-level gates undocumented),
so treat the diff as a way to find your own difference, not as a rule.

## Related skills

- `site-pages-deploy-kit` — deploy + skeleton (skeleton pages pass this lint
  by construction).
- `pillow-favicon-set-no-rasterizer` — how to generate the raster favicon set
  (favicon.ico, apple-touch-icon.png) when no SVG rasterizer is installed.
- `subpage-nav-anchor-baseurl-ssr-label-drift` — a sibling per-page-metadata
  drift on the same kind of site (in-page nav anchors and SSR-default text,
  rather than unfurl/favicon/CSP).

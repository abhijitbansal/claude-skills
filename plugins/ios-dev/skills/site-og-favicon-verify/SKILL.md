---
name: site-og-favicon-verify
description: Teams/iMessage/Slack link unfurl shows no image, a stretched image, or a generic card; favicon missing in tabs; fonts blocked by CSP. Use when a shared app-site link previews wrong, when adding og/meta tags, or when the site verify lint fails. The recurring root causes are relative og:image URLs, missing og:image:width/height, externally-hosted fonts vs strict CSP, and an incomplete favicon set.
---

# Site metadata: unfurl, favicon, CSP

The same three bugs shipped independently in doc-scan, floorprint, and sift
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
sizes + the og card from ONE master image with an idempotent script
(floorprint's `scripts/build-og-card.sh` pattern) so a rebrand is one re-run.

**4. Progressive enhancement.**
Content visible with JS disabled — scrapers don't run your JS. (doc-scan:
`content defaults visible if GSAP CDN fails to load`.)

## Verify

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/site-pages-deploy-kit/scripts/verify-site.sh" site
```

Smoke-test a real unfurl after deploying: paste the URL into Teams/iMessage —
first impressions cache, so verify BEFORE sharing widely.

## Related

- `site-pages-deploy-kit` — deploy + skeleton (skeleton pages pass this lint
  by construction).
- `subpage-nav-anchor-baseurl-ssr-label-drift` — a sibling per-page-metadata
  drift on the same kind of site (in-page nav anchors and SSR-default text,
  rather than unfurl/favicon/CSP).

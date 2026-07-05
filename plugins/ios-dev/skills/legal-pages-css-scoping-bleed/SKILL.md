---
name: legal-pages-css-scoping-bleed
description: >-
  Privacy/support/legal pages render with broken layout (wrong top padding,
  content shoved down or clipped) after sharing the homepage's global
  stylesheet, even though those pages have no hero section; OR the
  nav/footer links differ page-to-page — a link present on the homepage is
  missing on privacy/support, or a page's own nav is missing its own link.
  Use when a marketing site has one shared CSS file across index.html +
  secondary static pages and a layout or nav/footer bug only reproduces on
  the non-home pages. Root causes: (1) hero-only rules written against bare
  `body`/`html` selectors leak into every page sharing the stylesheet; (2)
  nav/footer markup hand-duplicated per page instead of generated from one
  source of truth, so lists drift out of sync.
---

# Legal/support pages: CSS bleed + nav/footer drift

Two independent bugs that both show up on the *same* small marketing site
shape — one `index.html` with a distinct hero theme, plus flat secondary
pages (privacy, support) sharing `styles.css`. They were fixed in the same
session but have different root causes and different fixes; don't conflate
them.

## Bug 1 — hero CSS bleeding into secondary pages

### Symptom
The privacy or support page has broken spacing — extra top padding, content
pushed down as if there were a hero banner above it — despite that page
having no hero markup at all. Only reproduces on pages that share the
stylesheet but don't opt into the hero.

### Root cause
A rule was written assuming it would only ever apply to the homepage hero,
but was scoped to a bare, page-agnostic selector (`body { padding-top: … }`,
or similarly unscoped `html`/`body` rule). Every page that links the same
stylesheet inherits it, hero or not. The dark theme + accent color + pill nav
built for the hero has no natural page boundary once it lives in a shared
`.css` file.

### Fix
Scope hero/homepage-only rules under a page-level class, and add that class
only to the page(s) that actually have the hero. Never target bare
`body`/`html` for one page's presentation in a stylesheet shared by other
pages.

```css
/* WRONG — applies to every page that includes styles.css */
body {
  padding-top: 96px;
  background: var(--hero-dark);
}

/* CORRECT — scoped to pages that opt in */
body.has-hero {
  padding-top: 96px;
  background: var(--hero-dark);
}
```

```html
<!-- index.html -->
<body class="has-hero">…</body>

<!-- privacy.html / support.html — no hero class, rule doesn't apply -->
<body>…</body>
```

Audit the shared stylesheet for any other bare `body`/`html`/universal
selector that was really written with only one page in mind — the hero
padding rule is rarely the only offender once you go looking.

## Bug 2 — nav/footer links drift out of sync

### Symptom
The nav or footer differs across pages that are supposed to share identical
site-wide navigation: the homepage has a link that privacy.html or
support.html is missing, the footer is missing a link on some pages but not
others, or a page's *own* nav is missing the link back to itself.

### Root cause
No single source of truth for the link list. Each page's nav and footer
markup was hand-written/copy-pasted independently, so edits to one page's
links never propagated to the others. This is a straightforward N-way
copy-paste drift, not a CSS issue.

A specific trap that caused one of the missing-link regressions: a
"self-omit" rule — logic meant to hide the current page's own link from its
own nav (so you're not shown a link to the page you're already on). Because
this was implemented per-page rather than derived centrally, it silently
dropped the wrong link on one page.

### Fix
Generate nav/footer markup from one shared list (a JS array, a template
partial, a build-time include — whatever the site's tooling supports) and
render every page's nav/footer from it, rather than hand-listing links per
file.

```js
// WRONG — every page hand-lists its own subset of links
// index.html:    <nav><a href="/">Home</a><a href="/support">Support</a></nav>
// privacy.html:  <nav><a href="/">Home</a></nav>   <!-- missing Support -->

// CORRECT — one source of truth, each page renders from it
const NAV_LINKS = [
  { href: '/', label: 'Home' },
  { href: '/support.html', label: 'Support' },
  { href: '/privacy.html', label: 'Privacy' },
];

function renderNav(currentPath) {
  return NAV_LINKS
    .filter(link => link.href !== currentPath) // the self-omit rule — the one place a link silently disappears
    .map(link => `<a href="${link.href}">${link.label}</a>`)
    .join('');
}
```

If a self-omit (or any other per-page conditional) rule exists, treat it as
the highest-suspicion line in the file when a link goes missing — it is
exactly the kind of logic that looks correct for the page you're testing and
wrong for every other page.

## Evidence

Both bugs shipped on a small iOS app's marketing site (index.html hero +
privacy/support pages sharing one stylesheet). Bug 1 was a single fix:
scoping the hero's `body` padding rule under a page-level class and adding
that class only to index.html. Bug 2 took several follow-up commits after
the initial fix — each one caught one more page missing a link — because the
nav/footer was still hand-duplicated per page rather than generated from a
shared list; the self-omit-current-page logic was the specific place a link
got silently dropped.

## Related skills

- `site-og-favicon-verify` — covers link-preview metadata (og:image, CSP,
  favicons) on the same kind of site; not this bug — that skill assumes the
  page layout itself is already correct.
- `site-pages-deploy-kit` — the skeleton/deploy pipeline these pages ship
  through; use its `verify-site.sh` for the metadata lint, but it does not
  check CSS scoping or nav/footer link parity — that's this skill.

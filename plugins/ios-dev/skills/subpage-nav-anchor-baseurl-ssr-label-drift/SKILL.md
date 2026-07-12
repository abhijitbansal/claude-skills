---
name: subpage-nav-anchor-baseurl-ssr-label-drift
description: Shared nav/skip-link `href="#section"` resolves to a dead URL like `/repo/updates/#work` the moment a single-page static site (Astro/SSG under a base path, e.g. GitHub Pages `base: '/repo/'`) grows a second page, and an SSR-rendered label ("Theme · Light") stays wrong until hydration (or forever with JS off) after the client-side default it mirrors gets flipped. Use when adding page N+1 to a 1-page site, reviewing a shared header/nav/skip-link component on a base-path-hosted static site, or changing any client-side default (theme, locale, sort order) that has an SSR-rendered reflection.
---

# Multi-Page Static Site: Subpage Nav Anchors + SSR Default Drift

## Symptom

- Clicking a nav link that worked fine on the page it was written on now
  404s or silently no-ops on a subpage — `href="#work"` in a shared `Nav`
  component resolves relative to the current URL, landing on
  `/repo/updates/#work` instead of `/repo/#work`.
- A skip-link (or any in-page anchor) targets a section id that doesn't
  exist on the current page/state — sometimes because the target lives on
  a different page, sometimes because the id is rendered only inside a
  conditional branch and the empty state has no element with that id at
  all.
- A UI label rendered by the server is wrong on first paint — e.g. it says
  `Theme · Light` even though the client script actually applies dark mode
  by default — and stays wrong permanently if JavaScript is disabled.

None of these throw a build error. They ship clean and are caught by a
human clicking around or reading the rendered HTML.

## Root cause

Three variants of the same underlying mistake — a shared component or a
hardcoded string was authored against **one** page/state and never
re-verified when the site (or a client-side default) grew past it:

1. **Bare `#section` hrefs are relative to the current document**, not the
   site root. A shared `Nav` component's `href="#work"` only resolves
   correctly on the page that actually has `#work` in it. The moment the
   site grows a second page, every other page's copy of that link is dead
   — it just isn't dead on the page where it was first written and tested.
2. **Skip links / anchor targets assume the target element always
   renders.** Two ways this breaks: (a) a shared component points at a
   section id that only exists on some pages (same root cause as #1 —
   component blindness to which page it's rendered on), and (b) the
   target id is emitted inside a conditional branch (
   `weeks.length > 0 ? <div id="weeks">… : null`), so the empty-state
   render has no element with that id — the skip link is dead specifically
   when there's nothing to skip to.
3. **SSR-rendered text drifts from a client-side default after the
   default is flipped.** The server renders a label/aria-state that
   mirrors a client-side default (e.g. theme). When that default changes
   in the client script (light→dark), the hardcoded SSR string is a
   separate, un-synced source of truth — it keeps saying the old value
   until client JS runs, and forever if it doesn't.

## Fix

- Prefix every shared-nav section link with the site's base path so it
  resolves the same from any page:
  `href={`${import.meta.env.BASE_URL}#section`}`. On the page that already
  has the section, this is same-URL-plus-hash (no reload); on every other
  page it now navigates home first, then jumps to the section.
- For shared components with page-dependent anchor targets (e.g.
  `SkipLink`), make the target id and visible label **props** with
  sensible defaults instead of hardcoding them — forces each usage site to
  either confirm the default is correct or override it.
- Anchor target ids must exist in **all** render states of the page,
  including empty states — put the id on a wrapper element that always
  renders, never inside the conditional branch that only renders when
  there's content.
- When adding page N+1 to what was a 1-page site, grep the whole shared
  component tree for bare hash hrefs: `grep -rn 'href="#' src/` — every
  hit inside a shared component (not a page-local anchor) is a latent bug
  the moment a second page exists.
- When flipping a client-side default (theme, locale, sort order, etc.),
  grep for the **old** default's literal rendered strings across
  server-rendered markup — labels, `aria-*` state, alt text — e.g.
  `Theme · Light` — and update them alongside the client-side flip. The
  SSR string and the client default are two copies of the same fact; a
  change to one without the other is the bug.

## Evidence

Mined from a foundry Astro site served under a GitHub Pages project base
path (`base: '/repo/'`), growing from one page to several. Three related
failure modes, all shipped and user-reported/review-caught:

- `href="#work"` in a shared `Nav` component resolved to
  `/repo/updates/#work` on the subpage — dead URL, no way back — while
  working fine on the page it was written for.
- A skip link's target id, rendered only inside
  `weeks.length > 0 ? <div id="weeks">…` , was absent from the DOM in the
  empty state, making the skip link a no-op exactly when the page had
  nothing to skip to.
- A theme default was flipped light→dark in the client script while the
  server-rendered label still read `Theme · Light` — wrong until
  hydration, permanently wrong with JS off.

## Related skills

- `github-pages-flat-deploy-subdir-404` — the base-path/subdirectory
  deploy context this bug family lives in.
- `legal-pages-css-scoping-bleed` — another shared-component-on-a-growing-
  site mined lesson from the same marketing-site family.
- `site-pages-deploy-kit` — the deploy tooling for this site family; run
  the grep sweeps in this skill before invoking it on a page-count change.
- `site-og-favicon-verify` — sibling verification pass for other
  per-page-metadata drift on the same sites.

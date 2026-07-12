# Multi-Page Static Site: Subpage Anchor Links + SSR Default Drift

**Extracted:** 2026-07-11
**Context:** Astro (or any SSG) site served under a base path (GitHub Pages project site, `base: '/repo/'`) growing from one page to several; also any client-side default flipped after markup was authored.

## Problem

Three related failure modes, all shipped and user-reported/review-caught in foundry:

1. **Bare `#section` anchors in shared nav break on every subpage.** `href="#work"` in a shared `Nav` component resolves to `/repo/updates/#work` on the subpage — dead URL, user can't navigate back. Works on the page it was written for; silently broken everywhere else.
2. **Skip links target sections that don't exist on other pages/states.** Same shared-component blindness (`#work` on a page without a work section), plus the subtler variant: target id rendered inside a conditional branch (`weeks.length > 0 ? <div id="weeks">…` ) is a dead skip-link in the empty state — put the id on a wrapper that always renders.
3. **SSR-rendered default state drifts from the client default.** Flipping the site default (light→dark theme) in the client script while the server-rendered label still says `Theme · Light` = wrong label until hydration, permanently wrong with JS off. Any hardcoded SSR text that mirrors a client-side default must be updated with it.

## Solution

- Shared-nav section links: always `href={`${import.meta.env.BASE_URL}#section`}` (works from every page; on the home page itself it's same-URL + hash, no reload).
- Shared components with page-dependent targets (SkipLink): make target/label props with sensible defaults.
- Anchor ids must exist in **all** render states of the page (empty states included) — wrapper element, not conditional branch.
- Grep sweep when adding page N+1 to a 1-page site: `grep -rn 'href="#' src/` — every hit in a shared component is a bug.
- When flipping a client-side default: grep for the old default's literal strings in server-rendered markup (`Theme · Light`) — SSR fallbacks, labels, aria states.

## When to Use

- Adding the second page to any single-page site (the moment this class of bug is born).
- Reviewing shared header/nav/skip-link components on base-path-hosted sites.
- Any change of a client-side default (theme, locale, sort order) that has an SSR-rendered reflection.

// plugins/portable-artifacts/shared/test/icons.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SKILLS, SUN, MOON, AUTO, faviconSvg, faviconHref, faviconLink } from '../icons.mjs';
import { loadTheme, listThemes } from '../theme.mjs';

test('toggle icons are decorative inline SVGs drawn in currentColor', () => {
  for (const icon of [SUN, MOON, AUTO]) {
    assert.match(icon, /^<svg [^>]*aria-hidden="true"/);
    assert.match(icon, /currentColor/);
  }
  assert.notEqual(SUN, MOON);
});

test('every skill has a distinct favicon in the theme accent, light and dark', () => {
  const theme = loadTheme('paper');
  const svgs = SKILLS.map((s) => faviconSvg(s, theme));
  assert.equal(new Set(svgs).size, SKILLS.length);
  for (const svg of svgs) {
    assert.ok(svg.includes(theme.light.accent));
    assert.ok(svg.includes(theme.dark.accent));
    assert.match(svg, /@media \(prefers-color-scheme: ?dark\)/);
  }
});

test('faviconHref is a data URI with no raw quotes or angle brackets', () => {
  for (const name of listThemes()) {
    const href = faviconHref('make-diagram', loadTheme(name));
    assert.match(href, /^data:image\/svg\+xml,/);
    assert.doesNotMatch(href.slice('data:image/svg+xml,'.length), /["<>]/);
  }
});

test('faviconLink is one rel=icon link tag', () => {
  const link = faviconLink('make-explainer', loadTheme('ink'));
  assert.match(link, /^<link rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml,[^"]+">$/);
});

test('unknown skill throws, naming the known ones', () => {
  assert.throws(() => faviconSvg('make-nope', loadTheme('paper')), /make-dashboard, make-diagram, make-explainer, make-motion/);
});

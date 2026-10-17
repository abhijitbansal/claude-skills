import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flavorFor, FLAVORS, CARD_INKS, flavorVars } from '../scripts/lib/flavor.mjs';
import { loadTheme, listThemes } from '../shared/theme.mjs';
import { contrastRatio } from '../shared/contrast.mjs';

test('flavorFor: the three new themes are their own flavor; every other theme is classic', () => {
  assert.equal(flavorFor('dusk'), 'dusk');
  assert.equal(flavorFor('press'), 'press');
  assert.equal(flavorFor('poster'), 'poster');
  for (const name of ['paper', 'blueprint', 'ink', 'editorial', 'nope', undefined, '__proto__', 'toString']) assert.equal(flavorFor(name), 'classic', String(name));
  assert.deepEqual(FLAVORS, ['dusk', 'press', 'poster']);
  assert.ok(listThemes().filter((n) => flavorFor(n) !== 'classic').every((n) => FLAVORS.includes(n)));
});

// The solid verdict card (and anything else drawn in --card-bg) carries body text in --card-fg.
test('card inks: the text colour on each flavor\'s solid fill passes 4.5:1 in both modes', () => {
  for (const flavor of FLAVORS) {
    const theme = loadTheme(flavor);
    for (const mode of ['light', 'dark']) {
      const [bg, fg] = CARD_INKS[flavor][mode];
      const ratio = contrastRatio(theme[mode][bg], theme[mode][fg]);
      assert.ok(ratio >= 4.5, `${flavor} ${mode}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1`);
    }
  }
});

test('card inks guardrail: an unsafe pair is caught (press light vermilion under page text)', () => {
  const press = loadTheme('press').light;
  assert.ok(contrastRatio(press.surface, press.accent) < 4.5);
});

test('flavorVars: light on :root, dark under both dark selectors; empty for classic', () => {
  const css = flavorVars('poster');
  assert.match(css, /^:root\{--card-bg:var\(--glow\);--card-fg:var\(--text\)\}/);
  assert.match(css, /@media \(prefers-color-scheme: dark\)\{:root:not\(\[data-theme="light"\]\)\{--card-bg:var\(--glow\);--card-fg:var\(--page\)\}\}/);
  assert.match(css, /:root\[data-theme="dark"\]\{--card-bg:var\(--glow\);--card-fg:var\(--page\)\}/);
  assert.equal(flavorVars('classic'), '');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flavorFor, FLAVORS, CARD_INKS, flavorVars, cardInkProblems } from '../scripts/lib/flavor.mjs';
import { loadTheme, listThemes } from '../shared/theme.mjs';
import { contrastRatio } from '../shared/contrast.mjs';

// Every shipped theme must be classified: a new theme file fails here until it is listed as a flavor or as classic.
const LEGACY = ['blueprint', 'editorial', 'ink', 'paper'];

test('flavorFor: the three new themes are their own flavor; every other theme is classic', () => {
  assert.deepEqual(FLAVORS, ['dusk', 'press', 'poster']);
  for (const name of ['dusk', 'press', 'poster']) {
    assert.ok(listThemes().includes(name), `${name} ships`);
    assert.equal(flavorFor(name), name, `${name} must not fall to classic`);
  }
  assert.deepEqual([...FLAVORS, ...LEGACY].sort(), listThemes(), 'every shipped theme is either a flavor or a listed classic theme');
  for (const name of [...LEGACY, 'nope', undefined, '__proto__', 'toString']) assert.equal(flavorFor(name), 'classic', String(name));
});

const loaded = Object.fromEntries(FLAVORS.map((f) => [f, loadTheme(f)]));

// The solid verdict card (and anything else drawn in --card-bg) carries body text in --card-fg.
test('card inks: the text colour on each flavor\'s solid fill passes 4.5:1 in both modes', () => {
  assert.deepEqual(cardInkProblems(CARD_INKS, loaded, contrastRatio), []);
});

test('card inks guardrail: the same check reports an unsafe pair and a missing theme', () => {
  const bad = { press: { light: ['accent', 'surface'], dark: ['text', 'page'] }, nope: { light: ['text', 'page'] } };
  assert.deepEqual(cardInkProblems(bad, loaded, contrastRatio), ['press light: surface on accent is 4.03:1', 'nope light: page on text is 0.00:1']);
});

test('flavorVars: light on :root, dark under both dark selectors; empty for classic', () => {
  const css = flavorVars('poster');
  assert.match(css, /^:root\{--card-bg:var\(--glow\);--card-fg:var\(--text\)\}/);
  assert.match(css, /@media \(prefers-color-scheme: dark\)\{:root:not\(\[data-theme="light"\]\)\{--card-bg:var\(--glow\);--card-fg:var\(--page\)\}\}/);
  assert.match(css, /:root\[data-theme="dark"\]\{--card-bg:var\(--glow\);--card-fg:var\(--page\)\}/);
  assert.equal(flavorVars('classic'), '');
});

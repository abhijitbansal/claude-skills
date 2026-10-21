import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flavorFor, FLAVORS, CARD_INKS, flavorVars, cardInkProblems, SCRIM, scrimProblems, scrimVar } from '../scripts/lib/flavor.mjs';
import { loadTheme, listThemes } from '../shared/theme.mjs';
import { contrastRatio, mixHex } from '../shared/contrast.mjs';

// Every shipped theme must be classified: a new theme file fails here until it is listed as a flavor or as classic.
const LEGACY = ['blueprint', 'brief', 'editorial', 'ink', 'mono', 'paper'];

test('flavorFor: the three new themes are their own flavor; every other theme (brief and mono included) is classic', () => {
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
  const bad = { press: { light: ['page', 'surface'], dark: ['text', 'page'] }, nope: { light: ['text', 'page'] } };
  const light = loaded.press.light;
  const unsafe = `press light: surface on page is ${contrastRatio(light.surface, light.page).toFixed(2)}:1`;
  assert.ok(contrastRatio(light.surface, light.page) < 4.5, 'the fixture pair must stay unsafe');
  assert.deepEqual(cardInkProblems(bad, loaded, contrastRatio), [unsafe, 'nope light: page on text is 0.00:1']);
});

test('flavorVars: light on :root, dark under both dark selectors; empty for classic', () => {
  const css = flavorVars('poster');
  assert.match(css, /^:root\{--card-bg:var\(--glow\);--card-fg:var\(--text\)\}/);
  assert.match(css, /@media \(prefers-color-scheme: dark\)\{:root:not\(\[data-theme="light"\]\)\{--card-bg:var\(--glow\);--card-fg:var\(--page\)\}\}/);
  assert.match(css, /:root\[data-theme="dark"\]\{--card-bg:var\(--glow\);--card-fg:var\(--page\)\}/);
  assert.equal(flavorVars('classic'), '');
});

// The deck's title slide sets its text on a translucent scrim of --page over procedural art. The art can be any
// colour, so the proof takes the worst pixel: every token of the theme, pure black and pure white under the scrim.
test('scrim: text and text-2 pass 4.5:1 on the scrim over any art pixel, in every flavor and mode', () => {
  assert.ok(SCRIM.alpha > 0 && SCRIM.alpha < 1, 'the scrim is translucent');
  assert.deepEqual(scrimProblems(SCRIM, loaded, contrastRatio, mixHex), []);
});

test('scrim guardrail: a thin scrim or a muted ink is reported', () => {
  const thin = scrimProblems({ ...SCRIM, alpha: 0.4 }, loaded, contrastRatio, mixHex);
  assert.ok(thin.some((p) => p.startsWith('dusk light: text on the scrim over ')), thin.join('\n'));
  const muted = scrimProblems({ ...SCRIM, inks: ['accent'] }, loaded, contrastRatio, mixHex);
  assert.ok(muted.some((p) => p.startsWith('press light: accent on the scrim over #000000')), muted.join('\n'));
});

test('scrimVar: one declaration, the scrim alpha of --page; empty for classic', () => {
  assert.equal(scrimVar('dusk'), `:root{--scrim:color-mix(in srgb, var(--page) ${Math.round(SCRIM.alpha * 100)}%, transparent)}`);
  assert.equal(scrimVar('classic'), '');
});

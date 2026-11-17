import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contrastRatio, relativeLuminance, checkTheme, mixHex, TINT, MIN_SURFACE_STEP } from '../contrast.mjs';
import { listThemes, loadTheme } from '../theme.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

test('WCAG maths matches known values', () => {
  assert.ok(Math.abs(relativeLuminance('#ffffff') - 1) < 1e-12);
  assert.equal(relativeLuminance('#000000'), 0);
  assert.equal(contrastRatio('#000000', '#ffffff').toFixed(2), '21.00');
  assert.equal(Number(contrastRatio('#777777', '#ffffff').toFixed(2)), 4.48);
  assert.equal(contrastRatio('#ffffff', '#000000'), contrastRatio('#000000', '#ffffff'), 'order does not matter');
});

test('every shipped theme passes checkTheme in both modes', () => {
  for (const name of listThemes()) assert.deepEqual(checkTheme(loadTheme(name)), [], name);
});

test('a low-contrast theme fails with the token, mode and ratio named (guardrail RED proof)', () => {
  const bad = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures/low-contrast.json'), 'utf8'));
  const errors = checkTheme(bad);
  assert.ok(errors.some((e) => e.path === 'light.text3' && /\d\.\d\d:1 against page; needs 4\.5:1/.test(e.message)), JSON.stringify(errors));
  assert.ok(errors.some((e) => e.path === 'dark.accent' && /needs 3:1/.test(e.message)));
  assert.ok(errors.some((e) => e.path === 'light.seq' && /must get stronger/.test(e.message)));
});

test('mixHex mixes two colours per channel like color-mix(in srgb)', () => {
  assert.equal(mixHex('#000000', '#ffffff', 0.1), '#e6e6e6');
  assert.equal(mixHex('#0e7490', '#ffffff', 0.1), '#e7f1f4');
  assert.equal(mixHex('#abcdef', '#123456', 1), '#abcdef');
  assert.equal(TINT, 0.1);
});

test('a kind hue too pale for its tint fails with the token, mode and ratio named (guardrail RED proof)', () => {
  const bad = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures/low-contrast.json'), 'utf8'));
  const errors = checkTheme(bad);
  assert.ok(errors.some((e) => e.path === 'light.kindExternal' && /\d\.\d\d:1 against surface; needs 4\.5:1/.test(e.message)), JSON.stringify(errors));
  assert.ok(errors.some((e) => e.path === 'dark.kindDecision' && /against its tint; needs 4\.5:1/.test(e.message)));
  assert.ok(errors.some((e) => e.path === 'dark.kindDecision' && /against page; needs 3:1/.test(e.message)));
});

// ---- surface steps (guardrail RED proofs: each bad theme is the shipped paper theme with one token broken) ----

const paperWith = (mode, patch) => {
  const t = structuredClone(loadTheme('paper'));
  Object.assign(t[mode], patch);
  for (const [k, v] of Object.entries(patch)) if (v === undefined) delete t[mode][k];
  return t;
};
const show = (errors) => JSON.stringify(errors, null, 1);

test('a surface2 that drops text3 under 4.5:1 fails naming light.text3 and the ratio', () => {
  const errors = checkTheme(paperWith('light', { surface2: '#d0d0d0', surface3: '#c4c4c4' }));
  assert.ok(errors.some((e) => e.path === 'light.text3' && /\d\.\d\d:1 against surface2; needs 4\.5:1/.test(e.message)), show(errors));
});

test('a dark surface3 darker than surface2 fails naming the mode and the token', () => {
  const errors = checkTheme(paperWith('dark', { surface3: '#191c1b' }));
  assert.ok(errors.some((e) => e.path === 'dark.surface3' && /must be lighter than surface2 in dark mode/.test(e.message)), show(errors));
});

test('a light surface2 equal to surface fails naming the mode and the token', () => {
  const errors = checkTheme(paperWith('light', { surface2: '#ffffff' }));
  assert.ok(errors.some((e) => e.path === 'light.surface2' && /must be darker than surface in light mode/.test(e.message)), show(errors));
});

test('a surface step too small to see fails with the step and the minimum named', () => {
  const errors = checkTheme(paperWith('light', { surface2: '#fdfdfd' }));
  assert.ok(MIN_SURFACE_STEP > 1);
  assert.ok(errors.some((e) => e.path === 'light.surface2' && /step is \d\.\d\d:1 from surface; needs at least \d\.\d\d:1/.test(e.message)), show(errors));
});

test('an accent under 4.5:1 on surface2 fails: the accent is text (links, kickers) on every surface', () => {
  const errors = checkTheme(paperWith('light', { surface2: '#e2e2e2', surface3: '#d6d6d6' }));
  assert.ok(errors.some((e) => e.path === 'light.accent' && /\d\.\d\d:1 against surface2; needs 4\.5:1 as text/.test(e.message)), show(errors));
});

test('a status colour under 3:1 on a surface step fails: chips and badges sit on every step', () => {
  const errors = checkTheme(paperWith('light', { surface2: '#a0a0a0', surface3: '#949494' }));
  assert.ok(errors.some((e) => e.path === 'light.good' && /\d\.\d\d:1 against surface2; needs 3:1/.test(e.message)), show(errors));
});

test('a theme without a surface token gets a named error, not a TypeError', () => {
  const errors = checkTheme(paperWith('dark', { surface3: undefined }));
  assert.ok(errors.some((e) => e.path === 'dark.surface3' && /missing; needs a #rrggbb colour/.test(e.message)), show(errors));
});

test('shipped surfaces: light steps go darker, dark steps go lighter, each at least MIN_SURFACE_STEP apart', () => {
  for (const name of listThemes()) {
    const t = loadTheme(name);
    for (const mode of ['light', 'dark']) {
      const [a, b, c] = ['surface', 'surface2', 'surface3'].map((k) => relativeLuminance(t[mode][k]));
      const ok = mode === 'light' ? a > b && b > c : a < b && b < c;
      assert.ok(ok, `${name}.${mode} surfaces out of order`);
      assert.ok(contrastRatio(t[mode].surface, t[mode].surface2) >= MIN_SURFACE_STEP, `${name}.${mode} surface2 step`);
      assert.ok(contrastRatio(t[mode].surface2, t[mode].surface3) >= MIN_SURFACE_STEP, `${name}.${mode} surface3 step`);
    }
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contrastRatio, relativeLuminance, checkTheme, mixHex, TINT } from '../contrast.mjs';
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

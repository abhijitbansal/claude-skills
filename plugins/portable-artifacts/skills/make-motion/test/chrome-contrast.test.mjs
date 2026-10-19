// The preview chrome (styles.css) draws only with theme tokens; every pair it uses must read in every theme.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contrastRatio } from '../shared/contrast.mjs';
import { loadTheme, listThemes } from '../shared/theme.mjs';

const CSS = readFileSync(new URL('../template/styles.css', import.meta.url), 'utf8');
const TEXT = 4.5;
const NON_TEXT = 3;
// [foreground, background, minimum, where]
const PAIRS = [
  ['text', 'page', TEXT, 'button glyphs, page text'],
  ['text', 'surface', TEXT, 'error box, control bar'],
  ['text3', 'surface', TEXT, 'readout, scene marks, provenance'],
  ['text3', 'page', TEXT, 'pressed mute glyph'],
  ['page', 'accent', TEXT, 'play glyph on the accent button'],
  ['accent', 'surface', NON_TEXT, 'focus ring, scrubber, hover ring'],
  ['bad', 'surface', NON_TEXT, 'error box edge'],
];

for (const name of listThemes()) {
  test(`${name}: every preview chrome colour pair reaches its contrast minimum`, () => {
    const c = loadTheme(name).dark;
    for (const [fg, bg, min, where] of PAIRS) {
      const ratio = contrastRatio(c[fg], c[bg]);
      assert.ok(ratio >= min, `${name} ${fg} on ${bg} (${where}): ${ratio.toFixed(2)} < ${min}`);
    }
  });
}

test('styles.css uses no literal colour, so the pairs above are the only ones it can draw', () => {
  const body = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.deepEqual(body.match(/#[0-9a-f]{3,8}\b|\b(?:rgb|hsl)a?\(/gi) ?? [], []);
  const used = new Set([...body.matchAll(/var\(--([a-z0-9]+)\)/gi)].map((m) => m[1]));
  const tokens = new Set(Object.keys(loadTheme('dusk').dark));
  const colourVars = [...used].filter((v) => tokens.has(v));
  const covered = new Set(PAIRS.flatMap(([fg, bg]) => [fg, bg]).concat('line'));
  assert.deepEqual(colourVars.filter((v) => !covered.has(v)), [], 'a colour token the contrast pairs do not cover');
});

test('the literal-colour guard fires on a literal (guardrail proof)', () => {
  assert.equal('a{color:#fff}'.match(/#[0-9a-f]{3,8}\b|\b(?:rgb|hsl)a?\(/gi).length, 1);
});

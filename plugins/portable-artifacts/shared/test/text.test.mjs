import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { measure, wrap, lineHeight, fontFor } from '../text.mjs';
import { listThemes, loadTheme } from '../theme.mjs';

const METRICS = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../fonts/metrics.json', import.meta.url)), 'utf8'));
const PLEX = { family: 'IBM Plex Sans', weight: 400, size: 14 };
const PLEX_BOLD = { ...PLEX, weight: 600 };

// Reference widths from Chrome. Method: Playwright (system Chrome, channel 'chrome'),
// the shipped woff2 loaded via `new FontFace(family, 'url(data:font/woff2;base64,…)')`,
// then canvas `ctx.font = '<weight> 14px "<family>"'; ctx.measureText(text).width`.
// Chrome applies kerning; our advance-sum does not, hence the tolerances below.
// Measured 2026-10-12: Hello (Plex Sans 400) 32.970 px in Chrome vs 33.04 from metrics; the
// 28-char phrase differs by -0.04% to +0.80% across the eight fonts (Newsreader worst).
const CHROME = {
  'IBM Plex Sans|400': { Hello: 32.969970703125, 'Checkout API gateway service': 189.32174682617188 },
  'IBM Plex Sans|600': { Hello: 33.89396667480469, 'Checkout API gateway service': 196.46177673339844 },
  'IBM Plex Mono|400': { Hello: 41.999969482421875, 'Checkout API gateway service': 235.1998291015625 },
  'Newsreader|600': { Hello: 33.900970458984375, 'Checkout API gateway service': 188.48878479003906 },
  'Bricolage Grotesque|600': { Hello: 34.033966064453125, 'Checkout API gateway service': 204.30178833007812 },
  'Atkinson Hyperlegible|400': { Hello: 31.625961303710938, 'Checkout API gateway service': 186.05982971191406 },
  'Atkinson Hyperlegible|700': { Hello: 34.24397277832031, 'Checkout API gateway service': 202.27183532714844 },
  'JetBrains Mono|400': { Hello: 41.999969482421875, 'Checkout API gateway service': 235.1998291015625 },
};

test('empty string measures 0', () => {
  assert.equal(measure('', PLEX), 0);
});

test('Hello in Plex Sans 400 14px matches Chrome within 0.5 px', () => {
  assert.ok(Math.abs(measure('Hello', PLEX) - 32.97) <= 0.5, String(measure('Hello', PLEX)));
});

test('every shipped font stays within 2% of Chrome on a phrase (kerning slack) and 0.5 px on Hello', () => {
  for (const [key, texts] of Object.entries(CHROME)) {
    const [family, weight] = key.split('|');
    const font = { family, weight: Number(weight), size: 14 };
    for (const [text, expected] of Object.entries(texts)) {
      const got = measure(text, font);
      const tol = text === 'Hello' ? 0.5 : expected * 0.02;
      assert.ok(Math.abs(got - expected) <= tol, `${key} "${text}": got ${got}, Chrome ${expected}`);
    }
  }
});

test('width grows with text and with size', () => {
  assert.ok(measure('Hello world', PLEX) > measure('Hello', PLEX));
  assert.ok(measure('Hello', { ...PLEX, size: 28 }) > measure('Hello', PLEX));
  assert.ok(Math.abs(measure('Hello', { ...PLEX, size: 28 }) - 2 * measure('Hello', PLEX)) < 1e-9);
});

test('bold is wider than regular', () => {
  assert.ok(measure('Checkout API gateway', PLEX_BOLD) > measure('Checkout API gateway', PLEX));
});

test('weight defaults to 400 and size to 14', () => {
  assert.equal(measure('Hello', { family: 'IBM Plex Sans' }), measure('Hello', PLEX));
});

test('a weight the family lacks resolves to the nearest available one', () => {
  // Plex Sans ships 400 and 600; 500 is closer to 400 (tie goes lighter), 700 to 600.
  assert.equal(measure('Hello', { ...PLEX, weight: 500 }), measure('Hello', PLEX));
  assert.equal(measure('Hello', { ...PLEX, weight: 700 }), measure('Hello', PLEX_BOLD));
});

test('unknown family throws and lists what is available', () => {
  assert.throws(() => measure('x', { family: 'Comic Sans' }), /Comic Sans.*IBM Plex Sans/);
});

test('wrap breaks on words; every line fits', () => {
  const lines = wrap('Checkout API gateway service', 90, PLEX);
  assert.ok(lines.length >= 2, JSON.stringify(lines));
  for (const l of lines) assert.ok(measure(l, PLEX) <= 90, `"${l}"`);
  assert.equal(lines.join(' '), 'Checkout API gateway service');
});

test('wrap leaves short text on one line and returns [] for empty text', () => {
  assert.deepEqual(wrap('Hello', 200, PLEX), ['Hello']);
  assert.deepEqual(wrap('', 200, PLEX), []);
});

test('wrap honours explicit newlines', () => {
  assert.deepEqual(wrap('a\nb', 200, PLEX), ['a', 'b']);
});

test('a single 60-char word hard-breaks with no hyphen and no loss', () => {
  const word = 'x'.repeat(60);
  const lines = wrap(word, 100, PLEX);
  assert.ok(lines.length >= 2);
  assert.equal(lines.join(''), word);
  assert.ok(!lines.join('').includes('-'));
  for (const l of lines) assert.ok(measure(l, PLEX) <= 100, `"${l}"`);
});

test('wrap terminates when one glyph is wider than maxWidth', () => {
  assert.deepEqual(wrap('WWW', 1, PLEX), ['W', 'W', 'W']);
});

test('a long word mid-sentence breaks on its own lines, later words rejoin the tail', () => {
  const lines = wrap(`go ${'y'.repeat(40)} on`, 80, PLEX);
  assert.equal(lines[0], 'go');
  assert.equal(lines.join('').replaceAll(' ', ''), `go${'y'.repeat(40)}on`);
  for (const l of lines) assert.ok(measure(l, PLEX) <= 80, `"${l}"`);
});

test('CJK falls back to a safe non-zero width of at least 1 em per glyph', () => {
  const { fallback, unitsPerEm } = METRICS['IBM Plex Sans|400'];
  const w = measure('注文データベース', PLEX);
  assert.ok(w > 0);
  assert.ok(w >= (8 * fallback / unitsPerEm) * 14, `${w}`);
  // fallback x 1.6 is 0.91 em for Plex Sans, so the 1 em floor applies.
  assert.ok(Math.abs(w - 8 * 14) < 1e-9, `${w}`);
});

test('wide glyphs (CJK, emoji) measure at least 1 em in every shipped font', () => {
  for (const key of Object.keys(METRICS)) {
    const [family, weight] = key.split('|');
    const font = { family, weight: Number(weight), size: 14 };
    assert.ok(measure('注', font) >= 14, `${key} single CJK glyph`);
    assert.ok(measure('注文データ'.slice(0, 4), font) >= 4 * 14, `${key} 4 CJK glyphs`);
    assert.ok(measure('\u{1F680}', font) >= 14, `${key} rocket emoji`);
    assert.ok(measure('\u2600', font) >= 14, `${key} U+2600 pictograph below U+2E80`);
  }
});

test('wide glyphs hard-break consistently with measure()', () => {
  const lines = wrap('注文データベースの設計', 50, PLEX);
  assert.ok(lines.length >= 3, JSON.stringify(lines));
  for (const l of lines) assert.ok(measure(l, PLEX) <= 50, `"${l}"`);
  assert.equal(lines.join(''), '注文データベースの設計');
});

test('unknown non-CJK codepoints use plain fallback; emoji never measure 0', () => {
  const fb = METRICS['IBM Plex Sans|400'].fallback / METRICS['IBM Plex Sans|400'].unitsPerEm * 14;
  assert.ok(Math.abs(measure('Ж', PLEX) - fb) < 1e-9, 'Cyrillic is below U+2E80');
  assert.ok(measure('😀', PLEX) > 0);
});

test('lineHeight is at least size x 1.3 and scales with size', () => {
  assert.ok(lineHeight(PLEX) >= 14 * 1.3 - 1e-9);
  assert.ok(lineHeight({ ...PLEX, size: 28 }) > lineHeight(PLEX));
  assert.ok(lineHeight({ family: 'IBM Plex Sans' }) >= 14 * 1.3 - 1e-9);
});

test('fontFor: body and mono give their lowest weight, display its declared weight', () => {
  const paper = loadTheme('paper');
  assert.deepEqual(fontFor(paper, 'body'), { family: 'IBM Plex Sans', weight: 400 });
  assert.deepEqual(fontFor(paper, 'mono'), { family: 'IBM Plex Mono', weight: 400 });
  assert.deepEqual(fontFor(paper, 'display'), { family: 'Newsreader', weight: 600 });
  assert.deepEqual(fontFor(loadTheme('editorial'), 'body'), { family: 'Atkinson Hyperlegible', weight: 400 });
  assert.throws(() => fontFor(paper, 'heading'), /heading.*display, body, mono/);
});

test('drift guard: every family|weight any theme uses has metrics', () => {
  for (const name of listThemes()) {
    const theme = loadTheme(name);
    for (const [role, def] of Object.entries(theme.fonts)) {
      for (const weight of Object.keys(def.weights)) {
        const m = METRICS[`${def.family}|${weight}`];
        assert.ok(m, `${name}.${role}: no metrics for ${def.family}|${weight}`);
        assert.ok(m.unitsPerEm > 0 && m.ascender > 0 && m.descender <= 0 && m.lineGap >= 0, `${def.family}|${weight} vertical metrics`);
        assert.ok(m.fallback > 0, `${def.family}|${weight} fallback`);
        assert.ok(m.advance['72'] > 0 && m.advance['32'] > 0 && m.advance['233'] > 0, `${def.family}|${weight} ASCII + Latin-1 advances`);
        // Printable ASCII is complete; Latin-1 may lack a glyph or two (Bricolage has no U+00A4/U+00AD) and then measures at `fallback`.
        for (const cp of range(0x20, 0x7e)) assert.ok(String(cp) in m.advance, `${def.family}|${weight} missing U+${cp.toString(16)}`);
      }
    }
  }
});

test('metrics.json keys are sorted and nothing extra is shipped', () => {
  const keys = Object.keys(METRICS);
  assert.deepEqual(keys, [...keys].sort());
  const used = new Set(listThemes().flatMap((n) => Object.values(loadTheme(n).fonts).flatMap((d) => Object.keys(d.weights).map((w) => `${d.family}|${w}`))));
  assert.deepEqual(new Set(keys), used);
});

function range(a, b) {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

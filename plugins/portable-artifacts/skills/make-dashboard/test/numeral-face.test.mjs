// Numbers on chart axes and in the footer are set in a face whose zero is plain. Atkinson Hyperlegible (brief,
// editorial) draws only a slashed zero: its font file has no `zero` feature and no plain alternate (GSUB features
// ccmp, frac, pnum, tnum; checked with .scratch/r3/zero.mjs), so those themes take their own fallback stack instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numeralFont } from '../scripts/lib/numeral-face.mjs';
import { loadTheme } from '../shared/theme.mjs';
import { buildProject } from './helpers/browser.mjs';

test('brief and editorial set numbers in their fallback stack, never Atkinson Hyperlegible', () => {
  for (const name of ['brief', 'editorial']) {
    const font = numeralFont(loadTheme(name).fonts);
    assert.equal(font, loadTheme(name).fonts.body.fallback, name);
    assert.ok(!font.includes('Atkinson'), name);
  }
});

test('a theme whose body face has a plain zero keeps it for numbers', () => {
  const fonts = loadTheme('paper').fonts;
  assert.equal(numeralFont(fonts), `"${fonts.body.family}", ${fonts.body.fallback}`);
});

test('the page carries the numeral face as --font-num, and the footer and refresh lines use it', () => {
  const spec = { title: 'T', sources: { sales: { type: 'csv', path: 'data/sales.csv' } }, queries: { q: 'SELECT region, SUM(amount) AS revenue FROM sales GROUP BY 1' }, charts: [{ id: 'c', title: 'C', query: 'q', kind: 'bar', x: 'region', y: 'revenue' }] };
  const { html } = buildProject(spec, { theme: 'brief' });
  assert.ok(html.includes(`--font-num: ${loadTheme('brief').fonts.body.fallback}`), 'the token holds the fallback stack');
  assert.ok(html.includes(`.pa-footer, .card details > summary { font-family: ${loadTheme('brief').fonts.body.fallback}; }`), 'footer and refresh lines');
  assert.match(html, /css\('--font-num'\) \|\| css\('--font'\)/, 'charts are drawn in it');
});

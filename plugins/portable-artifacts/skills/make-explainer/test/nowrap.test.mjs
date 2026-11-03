// Number-plus-unit tokens stay on one line: markdown wraps them in <span class="nw">, a KPI value longer than
// 12 characters draws a warning, and a table cell that holds a number is held on one line. No browser needed;
// test/nowrap-browser.test.mjs checks the rendered result.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderInline, renderMarkdown, renderHeadingInline } from '../scripts/lib/markdown.mjs';
import { validateSpec } from '../scripts/lib/spec.mjs';
import { render as renderTable } from '../scripts/lib/render/table.mjs';
import { render as renderKpis } from '../scripts/lib/render/kpis.mjs';

const fixture = (name) => JSON.parse(fs.readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8'));

test('a number with a spaced unit is wrapped in a nowrap span and keeps its space', () => {
  assert.ok(renderInline('fell to 1,204 ms').includes('<span class="nw">1,204 ms</span>'));
  assert.equal(renderInline('up +12 % today'), 'up <span class="nw">+12 %</span> today');
  assert.equal(renderInline('about $4.2k'), 'about <span class="nw">$4.2k</span>');
});

test('prose in bold, links and headings is wrapped too', () => {
  assert.equal(renderInline('**87%** hit'), '<strong><span class="nw">87%</span></strong> hit');
  assert.ok(renderInline('[1,204 ms](https://example.com)').includes('>' + '<span class="nw">1,204 ms</span></a>'));
  assert.ok(renderHeadingInline('Down to 87 %').includes('<span class="nw">87 %</span>'));
  assert.ok(renderMarkdown('- cut 1,204 ms\n\nthen 5 MB').includes('<span class="nw">5 MB</span>'));
});

test('nothing is wrapped inside a code span', () => {
  assert.equal(renderInline('`87 %` in code'), '<code>87 %</code> in code');
  assert.ok(!renderInline('`1,204 ms`').includes('nw'));
});

test('a link url holding a number and unit is unchanged', () => {
  const html = renderInline('[report](https://example.com/a?p=87%25&t=5ms)');
  assert.equal(html, '<a href="https://example.com/a?p=87%25&amp;t=5ms" rel="noopener noreferrer">report</a>');
});

test('an ordinary noun after a number is left alone', () => {
  assert.equal(renderInline('12 files and 3 options'), '12 files and 3 options');
});

test('text next to a token is escaped, and escaping never hides a token', () => {
  assert.equal(renderInline('<b>87%</b> & "5 MB"'), '&lt;b&gt;<span class="nw">87%</span>&lt;/b&gt; &amp; &quot;<span class="nw">5 MB</span>&quot;');
});

test('a table cell holding a number is held on one line; a text cell is not', () => {
  const html = renderTable({ columns: ['Name', 'Count', 'Note'], rows: [['a', 380, 'plain words'], ['b', '12%', 'more words']] });
  assert.equal(html.match(/<td class="a-r nw">/g).length, 2);
  assert.equal(html.match(/<td class="a-l">/g).length, 2);
});

test('a number in a mixed column is held on one line; its text neighbour is not', () => {
  const html = renderTable({ columns: ['Name', 'Load'], rows: [['a', '380'], ['b', 'not measured']] });
  assert.match(html, /<td class="a-l nw">380<\/td>/);
  assert.match(html, /<td class="a-l">not measured<\/td>/);
});

test('an explicit right alignment also holds the cell on one line', () => {
  const html = renderTable({ columns: ['Name', 'Note'], align: ['left', 'right'], rows: [['a', 'about a thing']] });
  assert.match(html, /<td class="a-r nw">/);
});

test('a KPI section carries the length of its longest one-line value; short values carry none, wide and long values keep their own', () => {
  const html = renderKpis({ items: [{ label: 'S', value: '87%' }, { label: 'M', value: '1,204 ms' }, { label: 'N', value: 123456789 }, { label: 'L', value: 'On track for Q4 launch' }] });
  assert.match(html, /^<dl class="kpis" style="--n: 8">/);
  assert.match(html, /<dd class="kpi-value">87%<\/dd>/);
  assert.match(html, /<dd class="kpi-value">1,204 ms<\/dd>/);
  assert.match(html, /<dd class="kpi-value" style="--n: 11">123,456,789<\/dd>/);
  assert.match(html, /<dd class="kpi-value" style="--n: 22">On track for Q4 launch<\/dd>/);
});

test('a section whose every value is wide or long carries no length of its own', () => {
  assert.match(renderKpis({ items: [{ label: 'N', value: 123456789 }, { label: 'L', value: 'On track for Q4 launch' }] }), /^<dl class="kpis">\n/);
});

test('a value too long for a small tile takes a full-row tile; a short one does not', () => {
  const html = renderKpis({ items: [{ label: 'A', value: '1234567890' }, { label: 'B', value: '12345678901' }] });
  const tiles = html.match(/<div class="kpi [^"]*">/g);
  assert.ok(!tiles[0].includes('kpi-wide'), tiles[0]);
  assert.ok(tiles[1].includes('kpi-wide'), tiles[1]);
});

test('validate warns once, at the KPI value that is longer than 12 characters', async () => {
  const { ok, errors, warnings } = await validateSpec(fixture('nowrap.explainer.json'));
  assert.equal(ok, true, JSON.stringify(errors));
  assert.deepEqual(warnings, [{ path: 'sections[0].items[3].value', message: 'KPI value is 22 characters; keep it to 12 or move words to note' }]);
});

test('validate does not warn for a short string value, a long number or a 12-character value', async () => {
  const spec = (value) => ({ title: 'T', sections: [{ type: 'kpis', items: [{ label: 'L', value }] }] });
  for (const value of ['87%', 123456789012345, '123456789012']) {
    const { warnings } = await validateSpec(spec(value));
    assert.deepEqual(warnings, [], String(value));
  }
  const { warnings } = await validateSpec(spec('1234567890123'));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].message, /^KPI value is 13 characters/);
});

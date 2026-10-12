import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'vega-lite';
import { expandCharts, temporalUnit } from '../scripts/lib/views.mjs';
import { KIND_NAMES } from '../scripts/lib/kinds.mjs';

const GOLDEN = path.join(path.dirname(fileURLToPath(import.meta.url)), 'golden');

// One result per shape the kinds need.
const results = {
  cat: { columns: ['region', 'revenue'], types: ['VARCHAR', 'DOUBLE'], rows: [{ region: 'North', revenue: 120 }, { region: 'South', revenue: 80 }], rowCount: 2 },
  catcol: { columns: ['quarter', 'region', 'revenue'], types: ['VARCHAR', 'VARCHAR', 'DOUBLE'], rows: [{ quarter: 'Q1', region: 'North', revenue: 1 }, { quarter: 'Q1', region: 'South', revenue: 2 }], rowCount: 2 },
  time: { columns: ['month', 'region', 'revenue'], types: ['DATE', 'VARCHAR', 'DOUBLE'], rows: [{ month: '2025-01-01', region: 'North', revenue: 1 }, { month: '2025-02-01', region: 'North', revenue: 2 }], rowCount: 2 },
  xy: { columns: ['a', 'b', 'c', 'g'], types: ['DOUBLE', 'DOUBLE', 'DOUBLE', 'VARCHAR'], rows: [{ a: 1, b: 2, c: 3, g: 'p' }], rowCount: 1 },
  grid: { columns: ['day', 'hour', 'n'], types: ['VARCHAR', 'VARCHAR', 'INTEGER'], rows: [{ day: 'Mon', hour: '9', n: 3 }], rowCount: 1 },
  odd: { columns: ['Total Revenue', 'a.b'], types: ['DOUBLE', 'VARCHAR'], rows: [{ 'Total Revenue': 5, 'a.b': 'x' }], rowCount: 1 },
  none: { columns: ['region', 'revenue'], types: ['VARCHAR', 'DOUBLE'], rows: [], rowCount: 0 },
};

const KIND_CHARTS = {
  bar: { query: 'cat', x: 'region', y: 'revenue' },
  'stacked-bar': { query: 'catcol', x: 'quarter', y: 'revenue', color: 'region' },
  'grouped-bar': { query: 'catcol', x: 'quarter', y: 'revenue', color: 'region' },
  line: { query: 'time', x: 'month', y: 'revenue', color: 'region' },
  area: { query: 'time', x: 'month', y: 'revenue' },
  scatter: { query: 'xy', x: 'a', y: 'b', color: 'g' },
  bubble: { query: 'xy', x: 'a', y: 'b', size: 'c' },
  heatmap: { query: 'grid', x: 'hour', y: 'day', value: 'n' },
  histogram: { query: 'xy', value: 'a' },
  boxplot: { query: 'xy', value: 'a', x: 'g' },
  donut: { query: 'cat', x: 'region', y: 'revenue' },
};

const expand1 = (chart) => {
  const out = expandCharts({ charts: [{ id: 'c', title: 'C', ...chart }] }, results);
  assert.deepEqual(out.errors, []);
  return out.charts[0];
};

test('temporalUnit picks the coarsest unit that fits every value', () => {
  assert.equal(temporalUnit(['2025-01-01', '2026-01-01']), 'utcyear');
  assert.equal(temporalUnit(['2025-01-01', '2025-02-01T00:00:00.000Z']), 'utcyearmonth');
  assert.equal(temporalUnit(['2025-01-01', '2025-01-02']), 'utcyearmonthdate');
  assert.equal(temporalUnit(['2025-01-01T10:30:00.000Z']), null);
  assert.equal(temporalUnit([]), null);
});

for (const kind of KIND_NAMES) {
  test(`kind ${kind}: primary view matches golden and compiles; table always follows`, () => {
    const c = expand1({ kind, ...KIND_CHARTS[kind] });
    assert.equal(c.views[0].name, kind);
    assert.equal(c.views.at(-1).name, 'table');
    assert.doesNotThrow(() => compile({ ...c.views[0].vegaLite, data: { values: [] } }));
    const file = path.join(GOLDEN, `${kind}.json`);
    if (process.env.PA_WRITE_GOLDEN === '1') fs.writeFileSync(file, `${JSON.stringify(c.views[0].vegaLite, null, 2)}\n`);
    assert.deepEqual(JSON.parse(JSON.stringify(c.views[0].vegaLite)), JSON.parse(fs.readFileSync(file, 'utf8')), `${kind} differs from ${file}`);
  });
}

test('odd column names are escaped in field, shown raw in the axis title', () => {
  const c = expand1({ kind: 'bar', query: 'odd', x: 'a.b', y: 'Total Revenue' });
  const enc = c.views[0].vegaLite.encoding;
  assert.equal(enc.x.field, 'a\\.b');
  assert.equal(enc.x.title, 'a.b');
  assert.equal(enc.y.field, 'Total Revenue');
});

test('long or many labels turn a bar horizontal with step height', () => {
  const rows = Array.from({ length: 9 }, (_, i) => ({ region: `R${i}`, revenue: i }));
  const c = expandCharts({ charts: [{ id: 'c', title: 'C', kind: 'bar', query: 'many', x: 'region', y: 'revenue' }] },
    { many: { columns: ['region', 'revenue'], types: ['VARCHAR', 'DOUBLE'], rows, rowCount: 9 } }).charts[0];
  const vl = c.views[0].vegaLite;
  assert.equal(vl.encoding.y.field, 'region');
  assert.equal(vl.encoding.x.field, 'revenue');
  assert.deepEqual(vl.height, { step: 24 });
});

test('zero rows: chart is marked empty and still offers the table', () => {
  const c = expand1({ kind: 'bar', query: 'none', x: 'region', y: 'revenue' });
  assert.equal(c.empty, true);
  assert.deepEqual(c.views.map((v) => v.name), ['bar', 'table']);
});

test('raw vegaLite charts become [chart, table] with tooltips added at build', () => {
  const c = expand1({ query: 'cat', vegaLite: { mark: 'bar', encoding: { x: { field: 'region', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative' } } } });
  assert.deepEqual(c.views.map((v) => v.name), ['chart', 'table']);
  assert.deepEqual(c.views[0].vegaLite.mark, { type: 'bar', tooltip: true });
});

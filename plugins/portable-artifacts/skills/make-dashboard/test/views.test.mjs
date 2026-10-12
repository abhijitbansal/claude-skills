import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'vega-lite';
import { expandCharts, temporalUnit, availableViews } from '../scripts/lib/views.mjs';
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
  assert.deepEqual(c.views.map((v) => v.name), ['bar', 'sorted', 'table'], 'share is blocked (no positive total); sorted stays');
});

test('raw vegaLite charts become [chart, table] with tooltips added at build', () => {
  const c = expand1({ query: 'cat', vegaLite: { mark: 'bar', encoding: { x: { field: 'region', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative' } } } });
  assert.deepEqual(c.views.map((v) => v.name), ['chart', 'table']);
  assert.deepEqual(c.views[0].vegaLite.mark, { type: 'bar', tooltip: true });
});

test('coloured area: hover dots are stacked like the area (read the stacked end field)', () => {
  const c = expand1({ kind: 'area', query: 'time', x: 'month', y: 'revenue', color: 'region' });
  const vl = c.views[0].vegaLite;
  assert.equal(vl.layer[2].encoding.y.stack, 'zero');
  const file = path.join(GOLDEN, 'area.color.json');
  if (process.env.PA_WRITE_GOLDEN === '1') fs.writeFileSync(file, `${JSON.stringify(vl, null, 2)}\n`);
  assert.deepEqual(JSON.parse(JSON.stringify(vl)), JSON.parse(fs.readFileSync(file, 'utf8')), `area+color differs from ${file}`);
  const marks = compile({ ...vl, data: { values: [] } }).spec.marks;
  const dots = marks.find((m) => m.type === 'symbol');
  assert.equal(dots.encode.update.y.field, 'revenue_end');
});

test('uncoloured area and coloured line keep their dots unstacked', () => {
  const area = expand1({ kind: 'area', query: 'time', x: 'month', y: 'revenue' }).views[0].vegaLite;
  assert.equal(area.layer[2].encoding.y.stack, undefined);
  const line = expand1({ kind: 'line', query: 'time', x: 'month', y: 'revenue', color: 'region' }).views[0].vegaLite;
  assert.equal(line.layer[2].encoding.y.stack, undefined);
});

test('x zoom is bound only on a temporal x (Vega-Lite drops it, with a warning, on a nominal x)', () => {
  const zoomNames = (vl) => vl.layer[0].params.map((p) => p.name);
  for (const kind of ['line', 'area']) {
    assert.deepEqual(zoomNames(expand1({ kind, query: 'time', x: 'month', y: 'revenue' }).views[0].vegaLite), ['pa_zoom']);
    assert.deepEqual(zoomNames(expand1({ kind, query: 'catcol', x: 'quarter', y: 'revenue' }).views[0].vegaLite), []);
    assert.deepEqual(zoomNames(expand1({ kind, query: 'catcol', x: 'quarter', y: 'revenue', color: 'region' }).views[0].vegaLite), ['pa_legend']);
  }
});

test('line and area with a nominal x keep the query order (sort: null); temporal x is unchanged', () => {
  for (const kind of ['line', 'area']) {
    const nominal = expand1({ kind, query: 'catcol', x: 'quarter', y: 'revenue', color: 'region' }).views[0].vegaLite;
    assert.equal(nominal.encoding.x.sort, null);
    const temporal = expand1({ kind, query: 'time', x: 'month', y: 'revenue' }).views[0].vegaLite;
    assert.equal('sort' in temporal.encoding.x, false);
  }
});

const r = (rows, columns = ['region', 'revenue'], types = ['VARCHAR', 'DOUBLE']) => ({ rows, columns, types, rowCount: rows.length });

test('default alternates per kind, in order, with table last', () => {
  const names = (chart, res) => expandCharts({ charts: [{ id: 'c', title: 'C', ...chart }] }, res).charts[0].views.map((v) => v.name);
  assert.deepEqual(names({ kind: 'bar', query: 'cat', x: 'region', y: 'revenue' }, results), ['bar', 'sorted', 'share', 'table']);
  assert.deepEqual(names({ kind: 'line', query: 'time', x: 'month', y: 'revenue', color: 'region' }, results), ['line', 'area', 'table']);
  assert.deepEqual(names({ kind: 'donut', query: 'cat', x: 'region', y: 'revenue' }, results), ['donut', 'bar', 'table']);
});

test('negative values block share/normalized; NULLs are ignored; zero total blocks share', () => {
  const chart = { kind: 'bar', x: 'region', y: 'revenue' };
  assert.deepEqual(availableViews(chart, r([{ region: 'a', revenue: 5 }, { region: 'b', revenue: -1 }])).blocked.share, 'share needs every revenue >= 0 (row 2 has -1)');
  assert.deepEqual(availableViews(chart, r([{ region: 'a', revenue: 5 }, { region: 'b', revenue: null }])).offered, ['sorted', 'share']);
  assert.match(availableViews(chart, r([{ region: 'a', revenue: 0 }])).blocked.share, /positive total/);
  assert.match(availableViews(chart, r([])).blocked.share, /positive total/, 'zero rows: no division by zero');
});

test('an unavailable default is dropped silently; an unavailable requested view is an error', () => {
  const res = { neg: r([{ region: 'a', revenue: 5 }, { region: 'b', revenue: -1 }]) };
  let out = expandCharts({ charts: [{ id: 'c', title: 'C', kind: 'bar', query: 'neg', x: 'region', y: 'revenue' }] }, res);
  assert.deepEqual(out.charts[0].views.map((v) => v.name), ['bar', 'sorted', 'table']);
  out = expandCharts({ charts: [{ id: 'c', title: 'C', kind: 'bar', query: 'neg', x: 'region', y: 'revenue', views: ['share'] }] }, res);
  assert.deepEqual(out.errors, [{ path: 'charts[0].views[0]', message: 'share needs every revenue >= 0 (row 2 has -1)' }]);
});

test('views narrows and reorders; table is always appended once', () => {
  const out = expandCharts({ charts: [{ id: 'c', title: 'C', kind: 'bar', query: 'cat', x: 'region', y: 'revenue', views: ['table', 'share'] }] }, results);
  assert.deepEqual(out.charts[0].views.map((v) => v.name), ['bar', 'share', 'table']);
});

test('donut primary needs <= 6 slices; colour needs <= 8 values (<= 3 for scatter)', () => {
  const seven = r(Array.from({ length: 7 }, (_, i) => ({ region: `r${i}`, revenue: 1 })));
  let out = expandCharts({ charts: [{ id: 'c', title: 'C', kind: 'donut', query: 'q', x: 'region', y: 'revenue' }] }, { q: seven });
  assert.deepEqual(out.errors, [{ path: 'charts[0].kind', message: 'donut needs <= 6 slices (region has 7); use kind "bar"' }]);
  const four = { columns: ['a', 'b', 'g'], types: ['DOUBLE', 'DOUBLE', 'VARCHAR'], rows: ['p', 'q', 'r', 's'].map((g, i) => ({ a: i, b: i, g })), rowCount: 4 };
  out = expandCharts({ charts: [{ id: 'c', title: 'C', kind: 'scatter', query: 'q', x: 'a', y: 'b', color: 'g' }] }, { q: four });
  assert.deepEqual(out.errors, [{ path: 'charts[0].color', message: 'g has 4 values; scatter colour allows at most 3 (fold the rest into "Other" in SQL or drop color)' }]);
});

test('pair is kept only when there are two views to show', () => {
  let out = expandCharts({ charts: [{ id: 'c', title: 'C', kind: 'bar', query: 'cat', x: 'region', y: 'revenue', pair: true, width: 'half' }] }, results);
  assert.equal(out.charts[0].pair, true);
  assert.equal(out.charts[0].width, 'full', 'pair forces full width');
  out = expandCharts({ charts: [{ id: 'c', title: 'C', kind: 'heatmap', query: 'grid', x: 'hour', y: 'day', value: 'n', pair: true }] }, results);
  assert.equal(out.charts[0].pair, true, 'heatmap + table still makes a pair');
});

for (const [kind, view, chart] of [
  ['bar', 'sorted', KIND_CHARTS.bar], ['bar', 'share', KIND_CHARTS.bar],
  ['stacked-bar', 'grouped', KIND_CHARTS['stacked-bar']], ['stacked-bar', 'normalized', KIND_CHARTS['stacked-bar']],
  ['grouped-bar', 'stacked', KIND_CHARTS['grouped-bar']],
  ['line', 'area', KIND_CHARTS.line], ['area', 'line', KIND_CHARTS.area],
  ['bubble', 'scatter', KIND_CHARTS.bubble], ['histogram', 'boxplot', KIND_CHARTS.histogram],
  ['boxplot', 'histogram', KIND_CHARTS.boxplot], ['donut', 'bar', KIND_CHARTS.donut],
]) {
  test(`alternate ${kind} -> ${view} matches golden and compiles`, () => {
    const c = expandCharts({ charts: [{ id: 'c', title: 'C', kind, ...chart }] }, results).charts[0];
    const v = c.views.find((x) => x.name === view);
    assert.ok(v, `${view} offered for ${kind}`);
    assert.doesNotThrow(() => compile({ ...v.vegaLite, data: { values: [] } }));
    const file = path.join(GOLDEN, `${kind}.${view}.json`);
    if (process.env.PA_WRITE_GOLDEN === '1') fs.writeFileSync(file, `${JSON.stringify(v.vegaLite, null, 2)}\n`);
    assert.deepEqual(JSON.parse(JSON.stringify(v.vegaLite)), JSON.parse(fs.readFileSync(file, 'utf8')));
  });
}

test('zero rows: a requested view blocked only by the empty result is dropped, not an error (data refreshes must not fail a build)', () => {
  const out = expandCharts({ charts: [{ id: 'c', title: 'C', kind: 'bar', query: 'none', x: 'region', y: 'revenue', views: ['share'] }] }, results);
  assert.deepEqual(out.errors, []);
  assert.deepEqual(out.charts[0].views.map((v) => v.name), ['bar', 'table']);
  assert.equal(out.charts[0].empty, true);
});

test('non-empty data still errors on a requested blocked view (negatives are a real defect)', () => {
  const res = { neg: r([{ region: 'a', revenue: 5 }, { region: 'b', revenue: -1 }]) };
  const out = expandCharts({ charts: [{ id: 'c', title: 'C', kind: 'bar', query: 'neg', x: 'region', y: 'revenue', views: ['share'] }] }, res);
  assert.equal(out.errors.length, 1);
  const zeroTotal = expandCharts({ charts: [{ id: 'c', title: 'C', kind: 'bar', query: 'z', x: 'region', y: 'revenue', views: ['share'] }] }, { z: r([{ region: 'a', revenue: 0 }]) });
  assert.match(zeroTotal.errors[0].message, /positive total/);
});

test('views naming the primary kind is ignored in the expansion (no error, no duplicate tab)', () => {
  const out = expandCharts({ charts: [{ id: 'c', title: 'C', kind: 'bar', query: 'cat', x: 'region', y: 'revenue', views: ['bar', 'sorted'] }] }, results);
  assert.deepEqual(out.errors, []);
  assert.deepEqual(out.charts[0].views.map((v) => v.name), ['bar', 'sorted', 'table']);
});

test('area with color stacks: a negative y is an error like donut (use line)', () => {
  const time = (rows) => ({ columns: ['month', 'region', 'revenue'], types: ['DATE', 'VARCHAR', 'DOUBLE'], rows, rowCount: rows.length });
  const neg = time([{ month: '2025-01-01', region: 'N', revenue: 5 }, { month: '2025-02-01', region: 'N', revenue: -2 }]);
  const area = { id: 'c', title: 'C', kind: 'area', query: 'q', x: 'month', y: 'revenue', color: 'region' };
  assert.deepEqual(expandCharts({ charts: [area] }, { q: neg }).errors, [
    { path: 'charts[0].kind', message: 'area with color stacks; it needs every revenue >= 0 (row 2 has -2); use kind line' },
  ]);
  // Uncoloured area, and a coloured line, do not stack: negatives are fine.
  assert.deepEqual(expandCharts({ charts: [{ ...area, color: undefined }] }, { q: neg }).errors, []);
  assert.deepEqual(expandCharts({ charts: [{ ...area, kind: 'line' }] }, { q: neg }).errors, []);
  // Zero rows is a data refresh, not a defect.
  assert.deepEqual(expandCharts({ charts: [area] }, { q: time([]) }).errors, []);
});

test('a NULL colour category counts toward the colour cap', () => {
  const groups = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', null];
  const rows = groups.map((region, i) => ({ quarter: `Q${i}`, region, revenue: 1 }));
  const res = { columns: ['quarter', 'region', 'revenue'], types: ['VARCHAR', 'VARCHAR', 'DOUBLE'], rows, rowCount: rows.length };
  const out = expandCharts({ charts: [{ id: 'c', title: 'C', kind: 'stacked-bar', query: 'q', x: 'quarter', y: 'revenue', color: 'region' }] }, { q: res });
  assert.deepEqual(out.errors, [{ path: 'charts[0].color', message: 'region has 9 values; stacked-bar colour allows at most 8 (fold the rest into "Other" in SQL or drop color)' }]);
  const eight = { ...res, rows: rows.slice(0, 8) };
  assert.deepEqual(expandCharts({ charts: [{ id: 'c', title: 'C', kind: 'stacked-bar', query: 'q', x: 'quarter', y: 'revenue', color: 'region' }] }, { q: eight }).errors, []);
});

test('numeric strings (wide DECIMALs arrive as strings) count as numbers in availability checks', () => {
  const chart = { kind: 'bar', x: 'region', y: 'revenue' };
  const str = r([{ region: 'a', revenue: '5.50' }, { region: 'b', revenue: '-1.25' }]);
  assert.equal(availableViews(chart, str).blocked.share, 'share needs every revenue >= 0 (row 2 has -1.25)');
  assert.deepEqual(availableViews(chart, r([{ region: 'a', revenue: '5.50' }, { region: 'b', revenue: '2' }])).offered, ['sorted', 'share']);
  assert.match(availableViews(chart, r([{ region: 'a', revenue: '0' }])).blocked.share, /positive total/);
  const out = expandCharts({ charts: [{ id: 'c', title: 'C', kind: 'donut', query: 'q', x: 'region', y: 'revenue' }] }, { q: str });
  assert.deepEqual(out.errors, [{ path: 'charts[0].kind', message: 'donut needs every revenue >= 0; use kind "bar"' }]);
});

test('guardrails: the 8-colour cap holds on a non-scatter kind; negatives block normalized and a coloured area alternate', () => {
  const nine = Array.from({ length: 9 }, (_, i) => ({ month: '2025-01-01', region: `r${i}`, revenue: 1 }));
  const res = { columns: ['month', 'region', 'revenue'], types: ['DATE', 'VARCHAR', 'DOUBLE'], rows: nine, rowCount: 9 };
  const out = expandCharts({ charts: [{ id: 'c', title: 'C', kind: 'line', query: 'q', x: 'month', y: 'revenue', color: 'region' }] }, { q: res });
  assert.match(out.errors[0].message, /region has 9 values; line colour allows at most 8/);

  const neg = { columns: ['quarter', 'region', 'revenue'], types: ['VARCHAR', 'VARCHAR', 'DOUBLE'], rows: [{ quarter: 'Q1', region: 'a', revenue: 3 }, { quarter: 'Q1', region: 'b', revenue: -1 }], rowCount: 2 };
  const stacked = availableViews({ kind: 'stacked-bar', x: 'quarter', y: 'revenue', color: 'region' }, neg);
  assert.equal(stacked.blocked.normalized, 'normalized needs every revenue >= 0 (row 2 has -1)');
  assert.deepEqual(stacked.offered, ['grouped']);
  const explicit = expandCharts({ charts: [{ id: 'c', title: 'C', kind: 'stacked-bar', query: 'q', x: 'quarter', y: 'revenue', color: 'region', views: ['normalized'] }] }, { q: neg });
  assert.deepEqual(explicit.errors, [{ path: 'charts[0].views[0]', message: 'normalized needs every revenue >= 0 (row 2 has -1)' }]);

  const timeNeg = { columns: ['month', 'region', 'revenue'], types: ['DATE', 'VARCHAR', 'DOUBLE'], rows: [{ month: '2025-01-01', region: 'a', revenue: 3 }, { month: '2025-02-01', region: 'a', revenue: -1 }], rowCount: 2 };
  const line = { kind: 'line', x: 'month', y: 'revenue', color: 'region' };
  assert.equal(availableViews(line, timeNeg).blocked.area, 'area needs every revenue >= 0 (row 2 has -1)');
  assert.deepEqual(availableViews(line, timeNeg).offered, []);
  assert.deepEqual(availableViews({ ...line, color: undefined }, timeNeg).offered, ['area'], 'uncoloured area does not stack');
});

// ---- format reaches every quantitative encoding and every tooltip ------------
const CURRENCY = '$,.2~f';
const tipByTitle = (vl) => Object.fromEntries((vl.encoding.tooltip ?? vl.layer.at(-1).encoding.tooltip).map((t) => [t.title, t]));
const withFormat = (kind) => expand1({ kind, format: 'currency', ...KIND_CHARTS[kind] });

test('format: bar-like and line-like tooltips format the number and leave categories alone', () => {
  for (const kind of ['bar', 'stacked-bar', 'grouped-bar', 'donut']) {
    const tips = tipByTitle(withFormat(kind).views[0].vegaLite);
    assert.equal(tips.revenue.format, CURRENCY, kind);
    assert.equal(tips.region.format, undefined, kind);
  }
  for (const kind of ['line', 'area']) {
    const vl = withFormat(kind).views[0].vegaLite;
    assert.equal(tipByTitle(vl).revenue.format, CURRENCY, kind);
    assert.equal(vl.layer[0].mark === 'line' || vl.layer[0].mark === 'area', true, 'the main mark carries no tooltip of its own');
  }
});

test('format: heatmap colour and bubble size get a legend format; donut theta has no axis', () => {
  const heat = withFormat('heatmap').views[0].vegaLite;
  assert.deepEqual(heat.encoding.color.legend, { format: CURRENCY });
  assert.equal('axis' in heat.encoding.color, false);
  assert.equal(tipByTitle(heat).n.format, CURRENCY);
  const bubble = withFormat('bubble').views[0].vegaLite;
  assert.deepEqual(bubble.encoding.size.legend, { format: CURRENCY });
  assert.equal('axis' in bubble.encoding.size, false);
  assert.equal(tipByTitle(bubble).c.format, CURRENCY);
  const donut = withFormat('donut').views[0].vegaLite;
  assert.equal('axis' in donut.encoding.theta, false);
  assert.equal('legend' in donut.encoding.theta, false);
});

test('format: histogram formats the bins but not the count; boxplot formats its stats through numberFormat', () => {
  const hist = withFormat('histogram').views[0].vegaLite;
  assert.equal(hist.encoding.x.axis.format, CURRENCY);
  const tips = tipByTitle(hist);
  assert.equal(tips.a.format, CURRENCY);
  assert.equal(tips.Count.format, undefined);
  assert.equal(withFormat('boxplot').views[0].vegaLite.config.numberFormat, CURRENCY);
  assert.equal('config' in expand1({ kind: 'boxplot', ...KIND_CHARTS.boxplot }).views[0].vegaLite, false, 'no format, no config');
});

test('share and normalized tooltips: raw value formatted, share titled "Share of <y>" in .1%', () => {
  const share = expand1({ kind: 'bar', format: 'currency', ...KIND_CHARTS.bar }).views.find((v) => v.name === 'share').vegaLite;
  assert.deepEqual(share.encoding.tooltip.map((t) => [t.title, t.field, t.format]), [
    ['region', 'region', undefined], ['revenue', 'revenue', CURRENCY], ['Share of revenue', 'pa_share', '.1%'],
  ]);
  const norm = expand1({ kind: 'stacked-bar', format: 'currency', ...KIND_CHARTS['stacked-bar'] }).views.find((v) => v.name === 'normalized').vegaLite;
  assert.equal(tipByTitle(norm).revenue.format, CURRENCY);
});

test('every kind and alternate compiles without Vega-Lite warnings, with and without format', () => {
  for (const format of [undefined, 'currency', 'percent', 'compact', 'number']) {
    for (const kind of KIND_NAMES) {
      const c = expand1({ kind, ...(format ? { format } : {}), ...KIND_CHARTS[kind] });
      for (const v of c.views.filter((x) => x.vegaLite)) {
        const logs = [];
        const logger = { level: () => logger, warn: (...a) => logs.push(a.join(' ')), info: () => logger, debug: () => logger, error: (...a) => logs.push(a.join(' ')) };
        compile({ ...v.vegaLite, data: { values: [] } }, { logger });
        assert.deepEqual(logs, [], `${kind}/${v.name}/${format}`);
      }
    }
  }
});

test('raw vegaLite keeps tooltip: true on every mark', () => {
  const c = expand1({ query: 'cat', vegaLite: { layer: [{ mark: 'bar' }, { mark: { type: 'rule', tooltip: false } }], encoding: { x: { field: 'region', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative' } } } });
  assert.deepEqual(c.views[0].vegaLite.layer.map((l) => l.mark), [{ type: 'bar', tooltip: true }, { type: 'rule', tooltip: false }]);
});

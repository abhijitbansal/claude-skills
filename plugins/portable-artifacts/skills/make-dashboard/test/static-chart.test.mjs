import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { vegaConfig } from '../scripts/lib/vega-config.mjs';
import { vegaConfigScript } from '../scripts/lib/html.mjs';
import { formatValue } from '../scripts/lib/format.mjs';
import { inferTypes, columnsOf, inlineChart } from '../scripts/lib/inline-chart.mjs';
import { staticView, coloursOf, fontOf, renderThemedSvgs } from '../scripts/lib/static-chart.mjs';
import { FORMAT_NAMES, expandCharts } from '../scripts/lib/views.mjs';
import { FORMATS } from '../scripts/lib/spec.mjs';
import { chartData, validateChart } from '../scripts/lib/pipeline.mjs';
import { loadTheme } from '../shared/theme.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const theme = loadTheme('paper');
const rows = [{ region: 'West', amount: 214.5 }, { region: 'North', amount: 360 }, { region: 'South', amount: 150 }];

// ---- the shared Vega config ---------------------------------------------------------------

test('vegaConfig maps colours to axes, marks and ranges', () => {
  const colours = coloursOf(theme.light);
  const cfg = vegaConfig(colours, 'Test, sans-serif');
  assert.deepEqual(cfg.range.category, colours.cat);
  assert.deepEqual(cfg.range.heatmap, colours.seq);
  assert.equal(cfg.axis.labelColor, colours.text3);
  assert.equal(cfg.axis.titleColor, colours.text2);
  assert.equal(cfg.bar.stroke, colours.surface);
  assert.equal(cfg.bar.fill, colours.cat[0]);
  assert.equal(cfg.font, 'Test, sans-serif');
  assert.equal(cfg.background, null);
});

// The page's copy is the function's own source (Function.prototype.toString), so it cannot drift from the Node copy
// or silently break: a helper outside the function would throw here, in the page's sandbox.
test('the page gets vegaConfig as window.PAVegaConfig, the same function the static render uses', () => {
  const sandbox = { window: {} };
  vm.runInNewContext(vegaConfigScript(), sandbox);
  const colours = coloursOf(theme.dark);
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.window.PAVegaConfig(colours, 'F'))), vegaConfig(colours, 'F'));
});

test('the page runtime builds its config through PAVegaConfig, not its own copy of the mapping', () => {
  const runtime = fs.readFileSync(path.join(ROOT, 'template/runtime.js'), 'utf8');
  assert.match(runtime, /window\.PAVegaConfig\(/);
  assert.ok(!runtime.includes('labelPadding'), 'the mapping lives in vega-config.mjs only');
});

test('format names match the dashboard schema', () => {
  assert.deepEqual([...FORMAT_NAMES].sort(), [...FORMATS].sort());
});

// ---- inline charts ------------------------------------------------------------------------

test('types are inferred per column: numbers, ISO dates, everything else', () => {
  const data = [{ d: '2025-01-02', n: 1, s: 'a', m: 1 }, { d: '2025-02-03', n: 2.5, s: '7', m: 'x' }, { d: '2025-02-04', n: null }];
  const columns = columnsOf(data);
  assert.deepEqual(columns, ['d', 'n', 's', 'm']);
  assert.deepEqual(inferTypes(data, columns), ['DATE', 'DOUBLE', 'VARCHAR', 'VARCHAR']);
  assert.deepEqual(inferTypes([{ d: '2025-13-45' }], ['d']), ['VARCHAR'], 'not a real date');
});

test('an inline chart expands to the view a dashboard chart of that kind would get', () => {
  const c = inlineChart({ kind: 'bar', x: 'region', y: 'amount', format: 'currency' }, rows);
  assert.deepEqual(c.errors, []);
  assert.equal(c.label, 'Bar');
  const dash = expandCharts({ charts: [{ id: 'c', title: 'C', query: 'q', kind: 'bar', x: 'region', y: 'amount', format: 'currency' }] },
    { q: { rows, columns: ['region', 'amount'], types: ['VARCHAR', 'DOUBLE'], rowCount: 3 } });
  assert.deepEqual(c.vegaLite, dash.charts[0].views[0].vegaLite);
});

test('inline chart errors name the field and the fix', () => {
  const at = (chart, data = rows) => inlineChart(chart, data).errors.map((e) => `${e.path}: ${e.message}`);
  assert.match(at({ kind: 'barr', x: 'region', y: 'amount' })[0], /^kind: unknown kind "barr"; did you mean "bar"\?/);
  assert.match(at({ kind: 'bar', x: 'region', y: 'amount', format: 'currancy' })[0], /^format: unknown format "currancy"; did you mean "currency"\?/);
  assert.match(at({ kind: 'bar', x: 'regoin', y: 'amount' })[0], /^x: "regoin" is not a column of the data \(columns: region, amount\); did you mean "region"\?/);
  assert.match(at({ kind: 'bar', x: 'amount', y: 'amount' })[0], /^x: "amount" is numeric \(DOUBLE\); x of kind "bar" needs a text column or a date or timestamp column/);
  assert.match(at({ kind: 'bar', x: 'region' })[0], /^y: required for kind "bar"/);
  assert.match(at({ kind: 'bar', x: 'region', y: 'amount', size: 'amount' })[0], /^size: kind "bar" does not use size/);
  const many = Array.from({ length: 9 }, (_, i) => ({ q: 'Q1', g: `g${i}`, v: i }));
  assert.match(at({ kind: 'stacked-bar', x: 'q', y: 'v', color: 'g' }, many)[0], /^color: g has 9 values; stacked-bar colour allows at most 8/);
});

// ---- static rendering ---------------------------------------------------------------------

test('staticView drops params, hover-only layers and interaction opacity, and nothing else', () => {
  const line = inlineChart({ kind: 'line', x: 'd', y: 'v', color: 'g' }, ['2025-01-01', '2025-02-01'].flatMap((d) => ['a', 'b'].map((g) => ({ d, v: 1, g })))).vegaLite;
  assert.equal(line.layer.length, 3);
  const flat = staticView(line);
  assert.equal(flat.layer.length, 1, 'rule and dots layers are hover-only');
  assert.ok(!JSON.stringify(flat).includes('pa_'), 'no interaction params or conditions left');
  assert.equal(flat.layer[0].mark, 'line');
  assert.deepEqual(flat.encoding.x, line.encoding.x);
  const bar = staticView(inlineChart({ kind: 'bar', x: 'region', y: 'amount' }, rows).vegaLite);
  assert.ok(!JSON.stringify(bar).includes('pa_'));
  assert.equal(bar.mark.type ?? bar.mark, 'bar');
});

test('the light and dark SVGs hold marks, axis titles and their own palette', async () => {
  const { vegaLite } = inlineChart({ kind: 'bar', x: 'region', y: 'amount', format: 'currency' }, rows);
  const all = await renderThemedSvgs(vegaLite, rows, theme, { idPrefix: 'k-' });
  const { light, dark } = { light: all.light.wide, dark: all.dark.wide };
  for (const svg of [light, dark, all.light.narrow, all.dark.narrow]) {
    assert.match(svg, /^<svg [^>]*aria-hidden="true"/);
    assert.equal((svg.match(/<path[^>]*class="[^"]*"/g) ?? []).length > 0, true);
    assert.match(svg, />region</);
    assert.match(svg, />amount</);
    assert.match(svg, />\$\d/, 'currency format reaches the axis labels');
    assert.ok(!/aria-label|role=/.test(svg), 'aria attributes are dropped; the figure is one labelled image');
    assert.ok(!/fill="white"/.test(svg), 'no hard-coded white background');
  }
  const bars = (svg) => (svg.match(/<path[^>]*d="M[^"]*"[^>]*fill="(#[0-9a-f]{3,8})"/gi) ?? []).length;
  assert.equal(bars(light), 3);
  assert.ok(light.includes(theme.light.cat1) && !light.includes(theme.dark.cat1), 'light uses the light palette');
  assert.ok(dark.includes(theme.dark.cat1) && !dark.includes(theme.light.cat1), 'dark uses the dark palette');
  assert.ok(dark.includes(theme.dark.text3), 'dark axis labels use the dark ink');
  assert.ok(light.includes(fontOf(theme.fonts).replaceAll('"', '&quot;')) || light.includes(theme.fonts.body.family), 'page body font');
  const ids = (svg) => [...svg.matchAll(/ id="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(ids(light).every((id) => id.startsWith('k-lw-')) && ids(dark).every((id) => id.startsWith('k-dw-')));
  assert.ok(ids(all.light.narrow).every((id) => id.startsWith('k-ln-')) && ids(all.dark.narrow).every((id) => id.startsWith('k-dn-')));
  assert.ok(!light.includes('url(#clip') || light.includes('url(#k-lw-clip'), 'references follow the renamed ids');
  const widthOf = (svg) => Number(/<svg [^>]*\swidth="(\d+)"/.exec(svg)[1]);
  assert.equal(widthOf(light), 600);
  assert.equal(widthOf(all.light.narrow), 320, 'the narrow variant is drawn for a phone');
});

test('data text is escaped in the SVG', async () => {
  const evil = [{ region: '<img src=x onerror=alert(1)>', amount: 3 }, { region: 'b', amount: 4 }];
  const { vegaLite } = inlineChart({ kind: 'bar', x: 'region', y: 'amount' }, evil);
  const { light } = await renderThemedSvgs(vegaLite, evil, theme);
  assert.ok(!light.wide.includes('<img') && !light.narrow.includes('<img'));
  assert.ok(light.wide.includes('&lt;img'));
});

test('every kind renders in both schemes (line and area drop their hover layers, a heatmap keeps its ramp)', async () => {
  const dates = ['2025-01-01', '2025-02-01', '2025-03-01'];
  const cases = {
    line: [{ kind: 'line', x: 'd', y: 'v', color: 'g' }, dates.flatMap((d, i) => ['a', 'b'].map((g, j) => ({ d, v: i * 3 + j + 1, g })))],
    area: [{ kind: 'area', x: 'd', y: 'v' }, dates.map((d, i) => ({ d, v: i + 1 }))],
    heatmap: [{ kind: 'heatmap', x: 'a', y: 'b', value: 'n' }, [{ a: 'x', b: 'p', n: 1 }, { a: 'y', b: 'p', n: 5 }, { a: 'x', b: 'q', n: 3 }, { a: 'y', b: 'q', n: 9 }]],
    donut: [{ kind: 'donut', x: 'a', y: 'n' }, [{ a: 'x', n: 1 }, { a: 'y', n: 5 }]],
    scatter: [{ kind: 'scatter', x: 'a', y: 'n', color: 'g' }, [{ a: 1, n: 1, g: 'p' }, { a: 2, n: 5, g: 'q' }]],
    boxplot: [{ kind: 'boxplot', value: 'n', x: 'g' }, [1, 2, 3, 4, 5, 9, 2, 3].map((n, i) => ({ n, g: i % 2 ? 'p' : 'q' }))],
    histogram: [{ kind: 'histogram', value: 'n' }, [1, 2, 3, 4, 5, 9, 2, 3].map((n) => ({ n }))],
    bubble: [{ kind: 'bubble', x: 'a', y: 'n', size: 's' }, [{ a: 1, n: 1, s: 3 }, { a: 2, n: 5, s: 7 }]],
    'stacked-bar': [{ kind: 'stacked-bar', x: 'q', y: 'v', color: 'g' }, ['Q1', 'Q2'].flatMap((q) => ['a', 'b'].map((g, j) => ({ q, v: j + 2, g })))],
  };
  for (const [kind, [chart, data]] of Object.entries(cases)) {
    const c = inlineChart(chart, data);
    assert.deepEqual(c.errors, [], kind);
    const { light, dark } = await renderThemedSvgs(c.vegaLite, data, theme);
    for (const svg of [light.wide, light.narrow, dark.wide, dark.narrow]) {
      assert.match(svg, /<svg /, kind);
      assert.ok(svg.length > 1000, kind);
    }
  }
});

// ---- one chart of a dashboard -------------------------------------------------------------

function project() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-chart-')));
  made.push(dir);
  fs.cpSync(path.join(ROOT, 'test/fixtures/data'), path.join(dir, 'data'), { recursive: true });
  const file = path.join(dir, 'dashboard.json');
  fs.writeFileSync(file, JSON.stringify({
    title: 'Sales',
    sources: { sales: { type: 'csv', path: 'data/sales.csv' } },
    queries: { rev: 'SELECT region, SUM(amount) AS revenue FROM sales GROUP BY 1 ORDER BY 2 DESC' },
    charts: [{ id: 'by-region', title: 'Revenue by region', query: 'rev', kind: 'bar', x: 'region', y: 'revenue', format: 'currency' }],
  }));
  return file;
}

test('chartData returns the primary view and the query rows without writing anything', async () => {
  const file = project();
  const before = fs.readdirSync(path.dirname(file)).sort();
  const out = await chartData(file, 'by-region');
  assert.equal(out.ok, true, JSON.stringify(out.errors));
  assert.equal(out.chart.title, 'Revenue by region');
  assert.deepEqual(out.result.columns, ['region', 'revenue']);
  assert.ok(out.result.rows.length >= 2);
  assert.equal(out.view.encoding.y.axis.format, '$,.2~f');
  assert.deepEqual(fs.readdirSync(path.dirname(file)).sort(), before);
});

test('an unknown chart id is reported at "chart" with a did-you-mean', async () => {
  const file = project();
  const out = await validateChart(file, 'by-regoin');
  assert.equal(out.ok, false);
  assert.deepEqual(out.errors, [{ path: 'chart', message: 'chart "by-regoin" not found in the dashboard; did you mean "by-region"?' }]);
  assert.match((await validateChart(file, 'zzzzzzzz')).errors[0].message, /available: by-region/);
});

test('a dashboard spec that does not validate is reported with its own paths', async () => {
  const file = project();
  const spec = JSON.parse(fs.readFileSync(file, 'utf8'));
  spec.charts[0].x = 'regoin';
  fs.writeFileSync(file, JSON.stringify(spec));
  const out = await validateChart(file, 'by-region');
  assert.equal(out.ok, false);
  assert.equal(out.errors[0].path, 'charts[0].x');
});

// ---- tick labels --------------------------------------------------------------------------

// The text of every axis label in an SVG, with whether it is drawn (opacity) and where it sits.
function labels(svg) {
  return [...svg.matchAll(/<text text-anchor="(\w+)" transform="translate\(([-\d.]+),([-\d.]+)\)[^"]*"[^>]*font-size="(\d+)px"[^>]*opacity="([\d.]+)">([^<]*)<\/text>/g)]
    .map((m) => ({ anchor: m[1], x: Number(m[2]), y: Number(m[3]), size: Number(m[4]), shown: Number(m[5]) > 0, text: m[6] }));
}
// A horizontal axis row: the labels sharing a y; boxes use the same width estimate Vega does (0.8 em per character).
function overlaps(row) {
  const boxes = row.filter((l) => l.shown).map((l) => {
    const w = l.text.length * l.size * 0.8;
    const left = l.anchor === 'end' ? l.x - w : l.anchor === 'middle' ? l.x - w / 2 : l.x;
    return [left, left + w, l.text];
  }).sort((a, b) => a[0] - b[0]);
  return boxes.slice(1).filter((b, i) => b[0] < boxes[i][1]).map((b) => b[2]);
}

const BUGS = [{ team: 'Core platform', bugs: 1200 }, { team: 'Web', bugs: 700 }, { team: 'Infrastructure', bugs: 400 }, { team: 'Mobile', bugs: 260 }];

test('the end tick of a value axis is drawn, and no drawn tick labels overlap', async () => {
  const { vegaLite } = inlineChart({ kind: 'bar', x: 'team', y: 'bugs', format: 'compact' }, BUGS);
  const svgs = await renderThemedSvgs(vegaLite, BUGS, theme);
  for (const [size, svg] of Object.entries(svgs.light)) {
    const ticks = labels(svg).filter((l) => /^[\d.]+k?$/.test(l.text) && l.y < 40);
    assert.ok(ticks.length >= 3, `${size}: ${ticks.length} tick labels`);
    assert.ok(ticks.every((l) => l.shown), `${size}: no tick label is hidden`);
    const value = (t) => Number.parseFloat(t) * (t.endsWith('k') ? 1000 : 1);
    assert.ok(Math.max(...ticks.map((l) => value(l.text))) >= 1200, `${size}: the last tick reaches the longest bar (1200)`);
    assert.deepEqual(overlaps(ticks), [], `${size}: no two drawn tick labels overlap`);
  }
});

test('date ticks sit on the data dates, the last one included; a phone has room for the first and the last', async () => {
  const data = ['2025-01-06', '2025-01-13', '2025-01-20'].flatMap((day, i) => ['North', 'South'].map((region, j) => ({ day, region, revenue: 10 + i * 5 + j })));
  const { vegaLite } = inlineChart({ kind: 'line', x: 'day', y: 'revenue', color: 'region' }, data);
  const svgs = await renderThemedSvgs(vegaLite, data, theme);
  for (const [size, svg] of Object.entries(svgs.light)) {
    const dates = labels(svg).filter((l) => /^[A-Z][a-z]{2} \d\d, \d{4}$/.test(l.text));
    const expected = size === 'wide' ? ['Jan 06, 2025', 'Jan 13, 2025', 'Jan 20, 2025'] : ['Jan 06, 2025', 'Jan 20, 2025'];
    assert.deepEqual(dates.map((l) => l.text), expected, `${size}: data dates`);
    assert.ok(dates.every((l) => l.shown), `${size}: every date label is drawn`);
  }
});

test('many dates are thinned to evenly spread data dates that include the first and the last', async () => {
  const data = Array.from({ length: 24 }, (_, i) => ({ d: `2024-${String(Math.floor(i / 2) + 1).padStart(2, '0')}-${i % 2 ? '15' : '01'}`, v: i }));
  const { vegaLite } = inlineChart({ kind: 'line', x: 'd', y: 'v' }, data);
  const svgs = await renderThemedSvgs(vegaLite, data, theme);
  for (const [size, svg] of Object.entries(svgs.light)) {
    const dates = labels(svg).filter((l) => /^[A-Z][a-z]{2} \d\d, \d{4}$/.test(l.text));
    assert.equal(dates.length, size === 'wide' ? 4 : 2, `${size}: ${dates.length} date labels`);
    assert.equal(dates[0].text, 'Jan 01, 2024');
    assert.equal(dates.at(-1).text, 'Dec 15, 2024');
    assert.deepEqual(overlaps(dates), []);
  }
});

test('date labels are not cut short on a phone; long category labels are', async () => {
  const data = ['2025-01-06', '2025-01-13'].map((day, i) => ({ day, v: i + 1 }));
  const { vegaLite } = inlineChart({ kind: 'line', x: 'day', y: 'v' }, data);
  const narrow = (await renderThemedSvgs(vegaLite, data, theme)).light.narrow;
  assert.ok(labels(narrow).some((l) => l.text === 'Jan 13, 2025'), 'whole date label');
  const grid = [{ a: 'abcdefghijklmnop', b: 'p', n: 1 }, { a: 'short', b: 'p', n: 2 }];
  const heat = inlineChart({ kind: 'heatmap', x: 'a', y: 'b', value: 'n' }, grid).vegaLite;
  const drawn = await renderThemedSvgs(heat, grid, theme);
  assert.ok(labels(drawn.light.narrow).some((l) => l.text.endsWith('…')), 'x labels honour the narrow labelLimit');
  assert.ok(labels(drawn.light.wide).some((l) => l.text === 'abcdefghijklmnop'), 'the wide drawing has room for the whole label');
});

// ---- inline types and formatting ------------------------------------------------------------

test('ISO date-times infer as TIMESTAMP, plain dates stay DATE, and zone-less times are read as UTC for drawing', () => {
  const data = [{ t: '2025-01-01T10:30:00Z', d: '2025-01-01', z: '2025-01-01 10:30', m: '2025-01-01' }, { t: '2025-01-02T11:00:00.250+02:00', d: '2025-01-02', z: '2025-01-02T11:00', m: '2025-01-02T00:00:00Z' }];
  const columns = columnsOf(data);
  assert.deepEqual(inferTypes(data, columns), ['TIMESTAMP', 'DATE', 'TIMESTAMP', 'TIMESTAMP']);
  assert.deepEqual(inferTypes([{ t: '2025-01-01T25:00:00Z' }], ['t']), ['VARCHAR'], 'not a real time');
  const line = inlineChart({ kind: 'line', x: 't', y: 'n' }, data.map((r, i) => ({ t: r.z, n: i })));
  assert.deepEqual(line.errors, []);
  assert.deepEqual(line.plotRows.map((r) => r.t), ['2025-01-01T10:30:00.000Z', '2025-01-02T11:00:00.000Z']);
  assert.equal(line.vegaLite.encoding.x.type, 'temporal');
});

test('formatValue applies a dashboard format to a number and leaves text alone', () => {
  assert.equal(formatValue(336.25, 'currency'), '$336.25');
  assert.equal(formatValue(1200, 'compact'), '1.2K');
  assert.equal(formatValue(0.456, 'percent'), '45.6%');
  assert.equal(formatValue(0.1 + 0.2), '0.3');
  assert.equal(formatValue(null), '—');
  assert.equal(formatValue('West', 'currency'), 'West');
});

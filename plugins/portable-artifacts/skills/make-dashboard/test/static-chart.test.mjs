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
import { labelWidth, tickLayout } from '../scripts/lib/axis-ticks.mjs';
import { inferTypes, columnsOf, inlineChart } from '../scripts/lib/inline-chart.mjs';
import { staticView, coloursOf, fontOf, renderThemedSvgs, axisFormat, thin } from '../scripts/lib/static-chart.mjs';
import { FORMAT_NAMES, expandCharts } from '../scripts/lib/views.mjs';
import { FORMATS } from '../scripts/lib/spec.mjs';
import { chartData, validateChart } from '../scripts/lib/pipeline.mjs';
import { loadTheme } from '../shared/theme.mjs';
import { measure } from '../shared/text.mjs';

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

// Every axis label in an SVG, with whether it is drawn (opacity) and where it sits.
function labels(svg) {
  return [...svg.matchAll(/<text text-anchor="(\w+)" transform="translate\(([-\d.]+),([-\d.]+)\)[^"]*"[^>]*font-size="(\d+)px"[^>]*opacity="([\d.]+)">([^<]*)<\/text>/g)]
    .map((m) => ({ anchor: m[1], x: Number(m[2]), y: Number(m[3]), size: Number(m[4]), shown: Number(m[5]) > 0, text: m[6] }));
}
// A value-axis label reads as a number ("$1,200", "1.2k", "−5", "45%"); category and date labels do not.
const isValueLabel = (l) => /^[−-]?\$?[\d,]+(\.\d+)?[a-zA-Zµ%]?$/.test(l.text) && l.size === 12;
const valueOf = (text) => {
  const m = /^([−-]?)\$?([\d,.]+)([kMGTµm%]?)$/.exec(text);
  const scale = { '': 1, k: 1e3, M: 1e6, G: 1e9, T: 1e12, '%': 0.01, m: 1e-3, 'µ': 1e-6 }[m[3]];
  return Number(m[1] === '' ? 1 : -1) * Number(m[2].replaceAll(',', '')) * scale;
};
// Boxes by the real advances of the theme's body font (the page's own text metrics); two drawn labels must not touch.
function overlaps(list, family) {
  const boxes = list.filter((l) => l.shown).map((l) => {
    const w = labelWidth(l.text, l.size, family);
    const left = l.anchor === 'end' ? l.x - w : l.anchor === 'middle' ? l.x - w / 2 : l.x;
    return { text: l.text, x0: left, x1: left + w, y0: l.y - l.size, y1: l.y };
  });
  const clash = [];
  boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => {
    if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) clash.push(`${a.text} / ${b.text}`);
  }));
  return clash;
}
const NAMES = ['Core platform', 'Web', 'Infrastructure', 'Mobile'];
const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];
const weekly = (n) => Array.from({ length: n }, (_, i) => `2025-${String(1 + Math.floor(i / 4)).padStart(2, '0')}-${String(1 + (i % 4) * 7).padStart(2, '0')}`);
const spread = (scale) => [1, 0.58, 0.33, 0.21];
// One chart per kind and orientation; `scale` sets the magnitude so the labels run from "6" to "1.2M".
const CASES = {
  'bar, horizontal': (k) => ({ chart: { kind: 'bar', x: 'team', y: 'v' }, rows: NAMES.map((team, i) => ({ team, v: k * spread()[i] })) }),
  'bar, vertical': (k) => ({ chart: { kind: 'bar', x: 'q', y: 'v' }, rows: QUARTERS.map((q, i) => ({ q, v: k * spread()[i] })) }),
  histogram: (k) => ({ chart: { kind: 'histogram', value: 'v' }, rows: Array.from({ length: 60 }, (_, i) => ({ v: (k / 12) * (1 + ((i * 7) % 11)) })) }),
  scatter: (k) => ({ chart: { kind: 'scatter', x: 'a', y: 'v' }, rows: Array.from({ length: 12 }, (_, i) => ({ a: (k / 3) * (i + 1), v: k * spread()[i % 4] })) }),
  line: (k) => ({ chart: { kind: 'line', x: 'd', y: 'v' }, rows: weekly(6).map((d, i) => ({ d, v: k * (0.2 + i / 8) })) }),
  area: (k) => ({ chart: { kind: 'area', x: 'd', y: 'v' }, rows: weekly(6).map((d, i) => ({ d, v: k * (0.2 + i / 8) })) }),
  'stacked bar': (k) => ({ chart: { kind: 'stacked-bar', x: 'q', y: 'v', color: 'g' }, rows: QUARTERS.flatMap((q, i) => ['a', 'b'].map((g, j) => ({ q, g, v: k * spread()[i] * (1 + j) }))) }),
};

test('no value-axis label is ever hidden or overlapped, whichever theme font draws it: every kind, both sizes, plain, compact and currency, small to huge', async () => {
  const problems = [];
  for (const themeName of ['paper', 'editorial']) {
    const themed = loadTheme(themeName);
    const family = themed.fonts.body.family;
    for (const [name, make] of Object.entries(CASES)) {
      for (const format of [undefined, 'compact', 'currency']) {
        for (const magnitude of [6, 1200, 1234567]) {
          const { chart, rows } = make(magnitude);
          const c = inlineChart({ ...chart, ...(format ? { format } : {}) }, rows);
          assert.deepEqual(c.errors, [], name);
          const svgs = await renderThemedSvgs(c.vegaLite, c.plotRows, themed);
          for (const [size, svg] of Object.entries(svgs.light)) {
            const ticks = labels(svg).filter(isValueLabel);
            const tag = `${themeName} / ${name} / ${format ?? 'plain'} / ${magnitude} / ${size}`;
            if (ticks.length < 2) problems.push(`${tag}: only ${ticks.length} value labels`);
            if (ticks.some((l) => !l.shown)) problems.push(`${tag}: hidden ${ticks.filter((l) => !l.shown).map((l) => l.text)} of ${ticks.map((l) => l.text)}`);
            const clash = overlaps(ticks, family);
            if (clash.length > 0) problems.push(`${tag}: overlap ${clash}`);
          }
        }
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('the value domain ends within one tick step of the data', async () => {
  const check = async (data, format, size, which, ceiling) => {
    const c = inlineChart({ kind: 'bar', x: 'team', y: 'v', ...(format ? { format } : {}) }, data);
    const svg = (await renderThemedSvgs(c.vegaLite, data, theme)).light[size];
    const ticks = labels(svg).filter(isValueLabel).map((l) => valueOf(l.text)).sort((a, b) => a - b);
    const step = ticks.at(-1) - ticks.at(-2);
    const max = Math.max(...data.map((r) => r.v));
    assert.ok(ticks.at(-1) >= max, `${which}: last tick ${ticks.at(-1)} reaches ${max}`);
    assert.ok(ticks.at(-1) - max < step, `${which}: last tick ${ticks.at(-1)} is within one step (${step}) of ${max}`);
    assert.ok(ticks.at(-1) <= ceiling, `${which}: the domain ends at ${ticks.at(-1)}, not past ${ceiling}`);
  };
  const rows = (v) => [{ team: 'Core platform', v }, { team: 'Web', v: v * 0.5 }, { team: 'Mobile', v: v * 0.2 }];
  for (const size of ['wide', 'narrow']) {
    await check(rows(1200), undefined, size, `1200 ${size}`, 1500);
    await check(rows(1234567), 'compact', size, `1.23M ${size}`, 1500000);
    await check(rows(87), 'currency', size, `87 ${size}`, 100);
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

test('many dates are thinned to every k-th data date, starting at the first and ending on the last', async () => {
  const data = Array.from({ length: 24 }, (_, i) => ({ d: `2024-${String(Math.floor(i / 2) + 1).padStart(2, '0')}-${i % 2 ? '15' : '01'}`, v: i }));
  const { vegaLite } = inlineChart({ kind: 'line', x: 'd', y: 'v' }, data);
  const svgs = await renderThemedSvgs(vegaLite, data, theme);
  for (const [size, svg] of Object.entries(svgs.light)) {
    const dates = labels(svg).filter((l) => /^[A-Z][a-z]{2} \d\d, \d{4}$/.test(l.text));
    assert.deepEqual(dates.map((l) => l.text), size === 'wide' ? ['Jan 01, 2024', 'May 01, 2024', 'Sep 01, 2024', 'Dec 15, 2024'] : ['Jan 01, 2024', 'Dec 15, 2024'], `${size}: data dates`);
    assert.deepEqual(overlaps(dates, theme.fonts.body.family), []);
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

// ---- date axes -----------------------------------------------------------------------------

const dateLabels = (svg) => labels(svg).filter((l) => /^[A-Z][a-z]{2} \d\d/.test(l.text) || /^\d{4}$/.test(l.text) || /^[A-Z][a-z]{2} \d{4}$/.test(l.text));

test('a raw vegaLite chart keeps the axis values it set', async () => {
  const rows = ['2025-01-06', '2025-01-13', '2025-01-20'].map((d, i) => ({ d, v: i + 1 }));
  const raw = { mark: 'line', encoding: { x: { field: 'd', type: 'temporal', timeUnit: 'utcyearmonthdate', axis: { values: [Date.UTC(2025, 0, 13)] } }, y: { field: 'v', type: 'quantitative' } } };
  const svgs = await renderThemedSvgs(raw, rows, theme);
  for (const [size, svg] of Object.entries(svgs.light)) {
    assert.deepEqual(dateLabels(svg).map((l) => l.text), ['Jan 13, 2025'], `${size}: only the date the chart named`);
  }
});

test('hourly data gets 24-hour labels on the readings, stepping evenly; a single date shows the date', async () => {
  const hours = Array.from({ length: 24 }, (_, i) => ({ t: `2025-01-06T${String(i).padStart(2, '0')}:30:00Z`, v: i }));
  const { vegaLite } = inlineChart({ kind: 'line', x: 't', y: 'v' }, hours);
  const svgs = await renderThemedSvgs(vegaLite, hours, theme);
  for (const [size, svg] of Object.entries(svgs.light)) {
    const times = dateLabels(svg);
    assert.ok(times.length >= 2 && times.every((l) => /^Jan 06 \d\d:\d\d$/.test(l.text)), `${size}: ${times.map((l) => l.text)}`);
    const minutes = times.map((l) => Number(l.text.slice(7, 9)) * 60 + Number(l.text.slice(10)));
    const gaps = minutes.slice(1).map((m, i) => m - minutes[i]);
    assert.ok(new Set(gaps.slice(0, -1)).size <= 1, `${size}: even steps, the last may be shorter, got ${gaps}`);
    assert.ok(gaps.at(-1) <= gaps[0], `${size}: the last step is never longer, got ${gaps}`);
    assert.ok(minutes.every((m) => m % 60 === 30), `${size}: every label is a reading (:30), not an interpolated time`);
    assert.equal(minutes[0], 30, `${size}: starts at the first reading`);
    assert.equal(minutes.at(-1), 23 * 60 + 30, `${size}: ends on the last reading`);
  }
  const one = [{ d: '2025-01-06', v: 3 }];
  const single = inlineChart({ kind: 'line', x: 'd', y: 'v' }, one).vegaLite;
  assert.deepEqual(dateLabels((await renderThemedSvgs(single, one, theme)).light.wide).map((l) => l.text), ['Jan 06, 2025']);
});

test('the last reading is always labelled: 12 monthly readings end on Dec, not Sep', async () => {
  const months = Array.from({ length: 12 }, (_, i) => ({ month: `2024-${String(i + 1).padStart(2, '0')}-01`, v: i + 1 }));
  const { vegaLite } = inlineChart({ kind: 'line', x: 'month', y: 'v' }, months);
  const svgs = await renderThemedSvgs(vegaLite, months, theme);
  const text = (svg) => labels(svg).filter((l) => /^[A-Z][a-z]{2} \d{4}$/.test(l.text)).map((l) => l.text);
  assert.deepEqual(text(svgs.light.wide), ['Jan 2024', 'May 2024', 'Sep 2024', 'Dec 2024']);
  assert.deepEqual(text(svgs.light.narrow), ['Jan 2024', 'Dec 2024']);
  assert.deepEqual(overlaps(labels(svgs.light.wide).filter((l) => /^[A-Z][a-z]{2} \d{4}$/.test(l.text)), theme.fonts.body.family), []);
});

test('thin: the last reading is added when there is room, else it takes the place of the last k-th tick', () => {
  const at = (n) => Array.from({ length: n }, (_, i) => i * 1000);
  const idx = (times) => times.map((t) => t / 1000);
  assert.deepEqual(idx(thin(at(12), 4)), [0, 4, 8, 11], 'room: one more tick');
  assert.deepEqual(idx(thin(at(8), 4)), [0, 3, 7], 'no room: 6 gives way to 7');
  assert.deepEqual(idx(thin(at(7), 4)), [0, 2, 4, 6], 'divides evenly: unchanged');
  assert.deepEqual(idx(thin(at(13), 4)), [0, 4, 8, 12], 'divides evenly: unchanged');
  assert.deepEqual(idx(thin(at(24), 2)), [0, 23], 'two ticks are the first and the last');
  assert.deepEqual(idx(thin(at(3), 4)), [0, 1, 2], 'few readings: all of them');
  for (let n = 2; n <= 80; n++) for (const max of [2, 3, 4, 7]) {
    const ticks = thin(at(n), max);
    assert.ok(ticks.length <= Math.max(max, Math.min(n, max)), `n=${n} max=${max}: ${ticks.length} ticks`);
    assert.equal(ticks[0], 0, `n=${n} max=${max}: starts at the first`);
    assert.equal(ticks.at(-1), (n - 1) * 1000, `n=${n} max=${max}: ends at the last`);
  }
});

test('tick labels are sized by the theme font\'s real advances, and by Vega\'s 0.8 em for a family it has none for', () => {
  const sample = '1,234,567';
  for (const family of ['IBM Plex Sans', 'Atkinson Hyperlegible', 'JetBrains Mono']) {
    assert.equal(labelWidth(sample, 12, family), measure(sample, { family, size: 12, weight: 400 }), family);
  }
  assert.notEqual(labelWidth(sample, 12, 'IBM Plex Sans'), labelWidth(sample, 12, 'Atkinson Hyperlegible'));
  assert.equal(labelWidth(sample, 12, 'No Such Sans'), sample.length * 0.8 * 12, 'unknown family: the estimate Vega uses');
  assert.equal(labelWidth(sample, 12), sample.length * 0.8 * 12, 'no family: the same estimate');
});

test('tickLayout fits the labels of the font it is given: a narrower face keeps more ticks in the same room', () => {
  const ticks = (family, pixels) => tickLayout({ domain: [0, 100], pixels, label: () => sample, fontSize: 12, horizontal: true, max: 9, family }).values.length;
  const sample = '1,234,567';
  assert.deepEqual([ticks('Atkinson Hyperlegible', 420), ticks('IBM Plex Sans', 420)], [6, 3], 'Atkinson is narrower than Plex Sans');
  assert.deepEqual([ticks('IBM Plex Sans', 460), ticks('JetBrains Mono', 460)], [6, 3], 'Plex Sans is narrower than the monospace');
  assert.equal(ticks('No Such Sans', 460), ticks(undefined, 460), 'unknown family = the 0.8 em estimate');
  assert.equal(ticks(undefined, 460), 3, 'which is wider than any of the real faces here');
});

test('the same chart gets different ticks under two theme fonts, and each fits its own font', async () => {
  const rows = [{ team: 'Core platform', v: 1234567 }, { team: 'Web', v: 700000 }, { team: 'Mobile', v: 250000 }];
  const { vegaLite } = inlineChart({ kind: 'bar', x: 'team', y: 'v' }, rows);
  for (const name of ['paper', 'editorial']) {
    const themed = loadTheme(name);
    const svg = (await renderThemedSvgs(vegaLite, rows, themed)).light.wide;
    const ticks = labels(svg).filter(isValueLabel);
    assert.ok(ticks.length >= 3 && ticks.every((l) => l.shown), `${name}: ${ticks.map((l) => l.text)}`);
    assert.deepEqual(overlaps(ticks, themed.fonts.body.family), [], name);
  }
});

test('axisFormat formats a number the way the axis does', () => {
  assert.equal(axisFormat(1200, 'compact'), '1.2k');
  assert.equal(axisFormat(1234.5, 'currency'), '$1,234.5');
  assert.equal(axisFormat(0.1 + 0.2, 'number'), '0.3');
  assert.equal(axisFormat(0.456, 'percent'), '45.6%');
  assert.equal(axisFormat(7, undefined), '7');
});

test('tickLayout: the smallest 1-2-5 step whose labels fit, a domain that ends on a tick', async () => {
  const { tickLayout, niceStep } = await import('../scripts/lib/axis-ticks.mjs');
  const label = (v) => String(v);
  assert.deepEqual([0.9, 1, 1.1, 2.1, 5.1, 7].map(niceStep), [1, 1, 2, 5, 10, 10]);
  const roomy = tickLayout({ domain: [0, 1200], pixels: 600, label, fontSize: 12, horizontal: true, max: 7 });
  assert.deepEqual(roomy, { values: [0, 200, 400, 600, 800, 1000, 1200], domain: [0, 1200] });
  const tight = tickLayout({ domain: [0, 1200], pixels: 120, label, fontSize: 12, horizontal: true, max: 4 });
  assert.ok(tight.domain[1] >= 1200 && tight.domain[1] < 1200 + (tight.values[1] - tight.values[0]));
  const flat = tickLayout({ domain: [5, 5], pixels: 300, label, fontSize: 12, horizontal: true, max: 5 });
  assert.ok(flat.domain[0] < 5 && flat.domain[1] > 5, 'a zero range gets a window round the value');
  assert.deepEqual(tickLayout({ domain: [0, 0], pixels: 100, label, fontSize: 12, horizontal: true, max: 4 }).domain, [0, 1]);
  assert.equal(tickLayout({ domain: [Number.NaN, 1], pixels: 300, label, fontSize: 12, horizontal: true, max: 5 }), null, 'no extent keeps the default axis');
  const negative = tickLayout({ domain: [-3, 8], pixels: 300, label, fontSize: 12, horizontal: false, max: 6 });
  assert.ok(negative.values.includes(0) && negative.domain[0] <= -3 && negative.domain[1] >= 8);
});

test('thinned time ticks are every k-th reading, then the last: six hourly readings', async () => {
  const six = Array.from({ length: 6 }, (_, i) => ({ t: `2025-01-06T0${i}:10:00Z`, v: i }));
  const { vegaLite } = inlineChart({ kind: 'line', x: 't', y: 'v' }, six);
  const svgs = await renderThemedSvgs(vegaLite, six, theme);
  assert.deepEqual(dateLabels(svgs.light.wide).map((l) => l.text), ['Jan 06 00:10', 'Jan 06 02:10', 'Jan 06 04:10', 'Jan 06 05:10']);
  assert.deepEqual(dateLabels(svgs.light.narrow).map((l) => l.text), ['Jan 06 00:10', 'Jan 06 05:10']);
});

// ---- axes a raw vegaLite chart set itself ---------------------------------------------------

test('a raw vegaLite chart keeps its own scale and tick settings', async () => {
  const rows = [{ k: 'a', v: 40 }, { k: 'b', v: 87 }];
  const view = (y) => ({ mark: 'bar', encoding: { x: { field: 'k', type: 'nominal' }, y: { field: 'v', type: 'quantitative', ...y } } });
  const ticks = async (y, size = 'wide') => labels((await renderThemedSvgs(view(y), rows, theme)).light[size]).filter(isValueLabel).map((l) => valueOf(l.text));
  const fixed = await ticks({ scale: { domain: [0, 87] } });
  assert.ok(fixed.length >= 3 && Math.max(...fixed) <= 87, `fixed domain [0, 87] stays: ${fixed}`);
  assert.ok(Math.max(...(await ticks({ scale: { domain: [0, 87] } }, 'narrow'))) <= 87, 'narrow too');
  const loose = await ticks({ scale: { domainMax: 87, nice: false } });
  assert.ok(Math.max(...loose) <= 87, `domainMax and nice:false stay: ${loose}`);
  const own = await ticks({ axis: { values: [0, 87] } });
  assert.deepEqual(own, [0, 87], 'axis.values stay');
  assert.deepEqual(await ticks({ axis: { tickCount: 2 } }), [0, 50], 'axis.tickCount stays');
});

// ---- zero-range axes ------------------------------------------------------------------------

test('a value axis with no range is a clean axis, never 0.000000', async () => {
  const zeros = [{ k: 'a', v: 0 }, { k: 'b', v: 0 }];
  const flat = [{ x: 4, y: 4 }, { x: 4, y: 4 }];
  const cases = [
    [inlineChart({ kind: 'bar', x: 'k', y: 'v' }, zeros), zeros, 'all-zero bars'],
    [inlineChart({ kind: 'scatter', x: 'x', y: 'y' }, flat), flat, 'equal-value scatter'],
  ];
  for (const [c, data, name] of cases) {
    assert.deepEqual(c.errors, [], name);
    for (const [size, svg] of Object.entries((await renderThemedSvgs(c.vegaLite, data, theme)).light)) {
      const ticks = labels(svg).filter(isValueLabel);
      assert.ok(ticks.length >= 2, `${name} ${size}: ${ticks.map((l) => l.text)}`);
      assert.ok(ticks.every((l) => l.shown && !/\.\d{3,}/.test(l.text)), `${name} ${size}: clean labels ${ticks.map((l) => l.text)}`);
      assert.deepEqual(overlaps(ticks), [], `${name} ${size}`);
    }
  }
  const zeroBars = labels((await renderThemedSvgs(cases[0][0].vegaLite, zeros, theme)).light.narrow).filter(isValueLabel).map((l) => l.text);
  assert.ok(zeroBars[0] === '0' && zeroBars.at(-1) === '1' && zeroBars.every((t) => !t.endsWith('.0')), `all-zero bars run 0 to 1: ${zeroBars}`);
});

// ---- explicit formats on a phone ------------------------------------------------------------

test('on a phone, currency and number axes shorten like plain ones so three ticks fit', async () => {
  const rows = [{ team: 'Core platform', v: 1234567 }, { team: 'Web', v: 617283 }, { team: 'Mobile', v: 246913 }];
  for (const [format, prefix] of [['currency', '$'], ['number', '']]) {
    const c = inlineChart({ kind: 'bar', x: 'team', y: 'v', format }, rows);
    const svgs = await renderThemedSvgs(c.vegaLite, rows, theme);
    const narrow = labels(svgs.light.narrow).filter(isValueLabel);
    assert.ok(narrow.length >= 3, `${format}: ${narrow.map((l) => l.text)}`);
    assert.ok(narrow.every((l) => l.shown && l.text.startsWith(prefix)), `${format}: ${narrow.map((l) => l.text)}`);
    assert.ok(Math.max(...narrow.map((l) => valueOf(l.text))) <= 1500000, `${format}: domain ends at ${narrow.at(-1).text}`);
    assert.ok(narrow.some((l) => /M$/.test(l.text)), `${format}: millions are shortened (${narrow.map((l) => l.text)})`);
  }
  const wide = labels((await renderThemedSvgs(inlineChart({ kind: 'bar', x: 'team', y: 'v', format: 'currency' }, rows).vegaLite, rows, theme)).light.wide);
  assert.ok(wide.some((l) => l.text === '$1,000,000'), 'wide stays $1,000,000');
});

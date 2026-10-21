// KPI values stay on one line in a built dashboard and are sized to their tile instead of spilling.
// Driven in a real browser with the shared probes: nowrapProblems finds a number-plus-unit token that spans
// two lines, overflowProblems finds a KPI value that is wider than its tile.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser, haveBrowser, buildProject } from './helpers/browser.mjs';
import { nowrapProblems, overflowProblems } from '../shared/nowrap-probe.mjs';

let browser;
// A browser that will not close must not keep the file alive.
after(() => Promise.race([browser?.close().catch(() => {}), new Promise((r) => setTimeout(r, 15000).unref())]));

const LONG = 'Northwest Europe Zone1';
const literal = (text) => `SELECT '${text}' AS v`;
const SPEC = {
  title: 'Numbers',
  sources: { sales: { type: 'csv', path: 'data/sales.csv' } },
  queries: {
    rev: 'SELECT region, SUM(amount) AS revenue FROM sales GROUP BY 1 ORDER BY 2 DESC',
    pct: literal('87%'),
    ms: literal('1,204 ms'),
    cash: literal('$48.2K'),
    uptime: literal('99.9%'),
    long: literal(LONG),
  },
  kpis: [
    { id: 'k-pct', title: 'Pass rate', query: 'pct', field: 'v' },
    { id: 'k-ms', title: 'Latency', query: 'ms', field: 'v' },
    { id: 'k-cash', title: 'Spend', query: 'cash', field: 'v' },
    { id: 'k-long', title: 'Busiest region', query: 'long', field: 'v' },
    { id: 'k-up', title: 'Uptime', query: 'uptime', field: 'v' },
  ],
  charts: [{ id: 'c1', title: 'Revenue', query: 'rev', vegaLite: { mark: 'bar', encoding: { x: { field: 'region', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative' } } } }],
};

async function open(theme, width, spec = SPEC) {
  browser ??= await launchBrowser();
  const { out } = buildProject(spec, { theme });
  const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: 'light' });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(pathToFileURL(path.join(out, 'index.html')).href);
  await page.waitForFunction(() => window.paReady === true, null, { timeout: 15000 });
  return { page, problems, context };
}

// Each KPI value's rendered line count, and its width against its tile's content box.
const valueLines = (page) => page.evaluate(() => [...document.querySelectorAll('.kpi-value')].map((el) => {
  const range = document.createRange();
  range.selectNodeContents(el);
  const tops = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
  return { text: el.textContent, lines: tops.size };
}));

// The rows the KPI tiles form, as the share of the section's width each row's tiles and gaps take.
// A hole beside short tiles shows as a low share.
const rowFill = (page) => page.evaluate(() => {
  const grid = document.querySelector('.kpis');
  const g = grid.getBoundingClientRect();
  const rows = new Map();
  for (const tile of grid.querySelectorAll('.kpi')) {
    const r = tile.getBoundingClientRect();
    const row = rows.get(Math.round(r.top)) ?? { right: 0, left: Infinity };
    rows.set(Math.round(r.top), { right: Math.max(row.right, r.right), left: Math.min(row.left, r.left) });
  }
  return { wide: grid.querySelectorAll('.kpi-wide').length, rows: [...rows.values()].map((r) => (r.right - r.left) / g.width) };
});

for (const theme of [undefined, 'dusk']) {
  for (const width of [1280, 390]) {
    test(`KPI values stay on one line, fit their tile and leave no hole in the row at ${width}px (${theme ?? 'paper'})`, async (t) => {
      if (!(await haveBrowser())) return t.skip('no browser');
      const { page, problems, context } = await open(theme, width);
      try {
        assert.equal(LONG.length, 22);
        assert.deepEqual(await nowrapProblems(page, { root: '.kpis' }), []);
        assert.deepEqual(await overflowProblems(page, '.kpi-value'), []);
        assert.deepEqual(await overflowProblems(page, '.kpi'), []);
        const lines = await valueLines(page);
        assert.deepEqual(lines.map((l) => l.text), ['87%', '1,204 ms', '$48.2K', LONG, '99.9%']);
        assert.deepEqual(lines.filter((l) => l.lines !== 1), [], 'every value is one line');
        const { wide, rows } = await rowFill(page);
        assert.equal(wide, 1, 'the 22-character value is the one wide tile');
        for (const share of rows) assert.ok(share >= 0.95, `a row fills ${Math.round(share * 100)}% of the section`);
        assert.deepEqual(problems, []);
      } finally {
        await context.close();
      }
    });
  }
}

test('the KPI tile is a size container and its value is held to one line', async (t) => {
  if (!(await haveBrowser())) return t.skip('no browser');
  const { page, context } = await open(undefined, 390);
  try {
    const style = await page.evaluate(() => {
      const el = document.querySelector('#kpi-k-ms .kpi-value');
      const long = document.querySelector('#kpi-k-long');
      return { whiteSpace: getComputedStyle(el).whiteSpace, containerType: getComputedStyle(el.parentElement).containerType, n: el.style.getPropertyValue('--n'),
        longN: long.querySelector('.kpi-value').style.getPropertyValue('--n'), longClass: long.className };
    });
    assert.equal(style.whiteSpace, 'nowrap');
    assert.equal(style.containerType, 'inline-size');
    assert.equal(style.n, '8');
    assert.equal(style.longN, '22');
    assert.equal(style.longClass, 'kpi kpi-wide kpi-long', 'a value too long for any tile may wrap');
  } finally {
    await context.close();
  }
});

// ---- values that cannot fit one line, and values just past a short tile's width ------------------

const SPACED = 'Insufficient data for the chosen regions';
const UNBROKEN = 'ABCDEFGHIJ'.repeat(4);
const TEN = '$1,234,567';
const mixed = (extra) => {
  const queries = { rev: SPEC.queries.rev, pct: literal('87%'), ms: literal('1,204 ms'), ...Object.fromEntries(extra.map(([id, text]) => [id, literal(text)])) };
  const kpis = [{ id: 'k-pct', title: 'Pass rate', query: 'pct', field: 'v' }, { id: 'k-ms', title: 'Latency', query: 'ms', field: 'v' },
    ...extra.map(([id, , title]) => ({ id: `k-${id}`, title, query: id, field: 'v' }))];
  return { ...SPEC, queries, kpis };
};

// Each value's rendered line boxes that lie outside its tile.
const clipped = (page) => page.evaluate(() => [...document.querySelectorAll('.kpi-value')].flatMap((el) => {
  const tile = el.closest('.kpi').getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(el);
  return [...range.getClientRects()].filter((r) => r.left < tile.left - 1 || r.right > tile.right + 1).map(() => el.textContent);
}));

for (const [name, long] of [['with spaces', SPACED], ['unbroken', UNBROKEN]]) {
  test(`a 40-character value ${name} wraps inside its tile instead of spilling, at 320, 390 and 1280px`, async (t) => {
    if (!(await haveBrowser())) return t.skip('no browser');
    assert.equal(long.length, 40);
    const { page, context } = await open(undefined, 320, mixed([['long', long, 'Notes'], ['ten', TEN, 'Total']]));
    try {
      for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        assert.deepEqual(await overflowProblems(page, '.kpi-value'), [], `value spills at ${width}px`);
        assert.deepEqual(await overflowProblems(page, '.kpi'), [], `tile spills at ${width}px`);
        assert.deepEqual(await clipped(page), [], `value leaves its tile at ${width}px`);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `page scrolls sideways at ${width}px`);
        assert.equal(await page.evaluate(() => document.querySelector('#kpi-k-long .kpi-value').textContent), long, 'the whole text is in the page');
      }
    } finally {
      await context.close();
    }
  });
}

test('a 10-character value fits its tile and leaves no hole, at 536 and 390px', async (t) => {
  if (!(await haveBrowser())) return t.skip('no browser');
  assert.equal(TEN.length, 10);
  const { page, context } = await open(undefined, 536, mixed([['ten', TEN, 'Total'], ['up', '99.9%', 'Uptime']]));
  try {
    for (const width of [536, 390]) {
      await page.setViewportSize({ width, height: 900 });
      assert.deepEqual(await overflowProblems(page, '.kpi-value'), [], `spill at ${width}px`);
      assert.deepEqual(await clipped(page), [], `clipped at ${width}px`);
      const { rows } = await rowFill(page);
      for (const share of rows) assert.ok(share >= 0.95, `a row fills ${Math.round(share * 100)}% of the section at ${width}px`);
    }
  } finally {
    await context.close();
  }
});

test('the probe fires: a value forced past its tile spills it, on one line', async (t) => {
  if (!(await haveBrowser())) return t.skip('no browser');
  const { page, context } = await open(undefined, 390);
  try {
    // --fs-lg caps the size, so a wrong --n alone cannot spill; the size is forced as well.
    await page.addStyleTag({ content: '.kpi-value { --n: 1 !important; font-size: 60px !important; }' });
    assert.ok((await overflowProblems(page, '.kpi-value')).length > 0, 'a value too big for its tile is reported');
    assert.deepEqual(await nowrapProblems(page, { root: '.kpis' }), [], 'and it still has not wrapped');
  } finally {
    await context.close();
  }
});

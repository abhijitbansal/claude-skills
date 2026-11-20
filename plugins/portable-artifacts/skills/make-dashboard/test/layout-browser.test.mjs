// Card heads and KPI tiles line up across a row, whatever each one holds. Driven in a real browser.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser, haveBrowser, buildProject } from './helpers/browser.mjs';

let browser;
after(() => Promise.race([browser?.close().catch(() => {}), new Promise((r) => setTimeout(r, 15000).unref())]));

const REV = 'SELECT region, SUM(amount) AS revenue FROM sales GROUP BY 1 ORDER BY 2 DESC';
const BY_MONTH = "SELECT date_trunc('month', date) AS month, SUM(amount) AS revenue FROM sales GROUP BY 1 ORDER BY 1";
// Two half cards side by side: a short title with view tabs, and a long title (two lines at half width) with none.
const SPEC = {
  title: 'Layout',
  sources: { sales: { type: 'csv', path: 'data/sales.csv' } },
  queries: { rev: REV, month: BY_MONTH, total: 'SELECT SUM(amount) AS revenue, SUM(units) AS units, AVG(amount) AS avg_sale FROM sales', long: "SELECT 'Northwest Europe Zone1' AS v" },
  kpis: [
    { id: 'k1', title: 'Revenue', query: 'total', field: 'revenue', format: 'currency', trend: { query: 'month', field: 'revenue' } },
    { id: 'k2', title: 'Units', query: 'total', field: 'units' },
    { id: 'k3', title: 'Average sale', query: 'total', field: 'avg_sale', format: 'currency' },
  ],
  charts: [
    { id: 'a', title: 'Revenue', query: 'rev', width: 'half', kind: 'bar', x: 'region', y: 'revenue' },
    { id: 'b', title: 'Revenue by region across every quarter of the year, with the regions sorted by their total', query: 'rev', width: 'half', kind: 'bar', x: 'region', y: 'revenue', views: ['table'] },
  ],
};
// The same tiles plus one wide tile, which switches the KPI section to wrapping flex rows.
const WIDE = { ...SPEC, kpis: [...SPEC.kpis, { id: 'k4', title: 'Busiest region', query: 'long', field: 'v' }] };

async function open(spec, width, theme) {
  browser ??= await launchBrowser();
  const { out } = buildProject(spec, { theme });
  const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: 'light' });
  const page = await context.newPage();
  await page.goto(pathToFileURL(path.join(out, 'index.html')).href);
  await page.waitForFunction(() => window.paReady === true, null, { timeout: 15000 });
  return { page, context };
}

const rect = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].map((el) => { const r = el.getBoundingClientRect(); return { top: r.top, left: r.left, bottom: r.bottom, height: r.height }; }), sel);

for (const theme of [undefined, 'mono']) {
  test(`two half cards in a row start their charts at the same height, whatever their titles and tools (1280px, ${theme ?? 'paper'})`, async (t) => {
    if (!(await haveBrowser())) return t.skip('no browser');
    const { page, context } = await open(SPEC, 1280, theme);
    try {
      const [a, b] = await rect(page, '.card .panes');
      const titles = await rect(page, '.card h2');
      assert.ok(Math.abs(titles[0].top - titles[1].top) < 1, 'the premise: the two cards share a row');
      assert.ok(Math.abs(a.top - b.top) <= 1, `chart tops ${Math.round(a.top)} and ${Math.round(b.top)}`);
    } finally {
      await context.close();
    }
  });

  test(`at 390px a card's tools sit flush left under its title (${theme ?? 'paper'})`, async (t) => {
    if (!(await haveBrowser())) return t.skip('no browser');
    const { page, context } = await open(SPEC, 390, theme);
    try {
      const titles = await rect(page, '.card h2');
      const tools = await rect(page, '.card .card-tools');
      tools.forEach((tool, i) => {
        assert.ok(Math.abs(tool.left - titles[i].left) <= 1, `card ${i}: tools start at ${Math.round(tool.left)}, title at ${Math.round(titles[i].left)}`);
        assert.ok(tool.top >= titles[i].bottom - 1, `card ${i}: tools under the title`);
      });
    } finally {
      await context.close();
    }
  });
}

for (const [name, spec] of [['grid', SPEC], ['wrapping rows', WIDE]]) {
  test(`KPI tiles in one row share a height and their Query lines, sparkline or not (${name}, 1280px)`, async (t) => {
    if (!(await haveBrowser())) return t.skip('no browser');
    const { page, context } = await open(spec, 1280);
    try {
      const tiles = await rect(page, '.kpi');
      const queries = await rect(page, '.kpi .kpi-sql summary');
      const row = tiles.filter((r) => Math.abs(r.top - tiles[0].top) < 1).length;
      assert.ok(row >= 3, `the premise: at least three tiles share the first row (${row})`);
      const first = tiles.slice(0, row);
      assert.ok(first.every((r) => Math.abs(r.height - first[0].height) <= 1), `heights ${first.map((r) => Math.round(r.height))}`);
      const tops = queries.slice(0, row).map((q) => Math.round(q.top));
      assert.ok(tops.every((top) => Math.abs(top - tops[0]) <= 1), `Query tops ${tops}`);
    } finally {
      await context.close();
    }
  });
}

// The sparkline shares the Query row (at its right), so a tile without one has no empty strip between its value and
// its Query line; the tiles stay one height.
const MAX_VALUE_TO_QUERY = 24; // px: the 10 px margin plus the value's line box and the summary's own spacing (the band was 51 to 55)
for (const width of [1280, 390]) {
  test(`no KPI tile shows an empty band between its value and its Query line, sparkline or not (${width}px)`, async (t) => {
    if (!(await haveBrowser())) return t.skip('no browser');
    const { page, context } = await open(SPEC, width);
    try {
      const values = await rect(page, '.kpi .kpi-value');
      const queries = await rect(page, '.kpi .kpi-sql summary');
      const gaps = values.map((v, i) => Math.round(queries[i].top - v.bottom));
      assert.ok(gaps.every((g) => g <= MAX_VALUE_TO_QUERY), `value-to-Query gaps ${gaps}`);
      const trend = await rect(page, '.kpi .kpi-trend');
      assert.equal(trend.length, 1, 'the premise: one tile has a sparkline');
    } finally {
      await context.close();
    }
  });
}

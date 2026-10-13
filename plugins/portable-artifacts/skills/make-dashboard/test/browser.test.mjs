import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser, haveBrowser, buildProject } from './helpers/browser.mjs';
import { serve } from './helpers/live-harness.mjs';

const SPEC = {
  title: 'Browser',
  sources: { sales: { type: 'csv', path: 'data/sales.csv' } },
  queries: { rev: 'SELECT region, SUM(amount) AS revenue FROM sales GROUP BY 1 ORDER BY 2 DESC' },
  charts: [{ id: 'c1', title: 'Revenue', query: 'rev', vegaLite: { mark: 'bar', encoding: { x: { field: 'region', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative' } } } }],
};

let browser;
// A browser that will not close must not keep the file alive.
after(() => Promise.race([browser?.close().catch(() => {}), new Promise((r) => setTimeout(r, 15000).unref())]));

// Opens a built page; collects console errors and warnings (Vega-Lite warns on bad bindings) and page errors.
async function open(out, { width = 1280, blockStorage = false, colorScheme = 'light' } = {}) {
  browser ??= await launchBrowser();
  const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme, acceptDownloads: true });
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  if (blockStorage) {
    await page.addInitScript(() => {
      for (const name of ['localStorage', 'sessionStorage']) {
        Object.defineProperty(window, name, { get() { throw new DOMException('denied', 'SecurityError'); } });
      }
    });
  }
  await page.goto(pathToFileURL(path.join(out, 'index.html')).href);
  await page.waitForFunction(() => window.paReady === true, null, { timeout: 15000 });
  return { page, problems };
}

const token = (page, name) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

test('theme toggle cycles auto -> light -> dark and survives a reload', async (t) => {
  if (!(await haveBrowser())) return t.skip('no browser');
  const { out } = buildProject(SPEC);
  const { page, problems } = await open(out);
  assert.equal(await token(page, '--page'), '#f7f6f3');
  await page.click('[data-theme-toggle]'); // auto -> light
  await page.click('[data-theme-toggle]'); // light -> dark
  assert.equal(await page.getAttribute('html', 'data-theme'), 'dark');
  assert.equal(await token(page, '--page'), '#0f1110');
  await page.reload();
  await page.waitForFunction(() => window.paReady === true);
  assert.equal(await token(page, '--page'), '#0f1110', 'choice persisted');
  assert.deepEqual(problems, []);
});

test('blocked storage: the page renders and the toggle still works for the visit', async (t) => {
  if (!(await haveBrowser())) return t.skip('no browser');
  const { out } = buildProject(SPEC);
  const { page, problems } = await open(out, { blockStorage: true });
  assert.equal(await page.locator('.chart svg').count(), 1);
  await page.click('[data-theme-toggle]');
  await page.click('[data-theme-toggle]');
  assert.equal(await token(page, '--page'), '#0f1110');
  assert.deepEqual(problems, []);
});

test('no horizontal overflow at 390 px; screenshot for review', async (t) => {
  if (!(await haveBrowser())) return t.skip('no browser');
  const { out } = buildProject(SPEC);
  const { page, problems } = await open(out, { width: 390 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: path.join(out, 'mobile.png'), fullPage: true });
  assert.deepEqual(problems, []);
});

const KINDS_SPEC = {
  title: 'Kinds',
  sources: { sales: { type: 'csv', path: 'data/sales.csv' } },
  queries: {
    rev: 'SELECT region, SUM(amount) AS "Total Revenue" FROM sales GROUP BY 1 ORDER BY 2 DESC',
    q_region: "SELECT 'Q' || quarter(date) AS quarter, region, SUM(amount) AS revenue FROM sales GROUP BY 1, 2 ORDER BY 1, 2",
    monthly: "SELECT date_trunc('month', date)::DATE AS month, region, SUM(amount) AS revenue FROM sales GROUP BY 1, 2 ORDER BY 1",
    pts: 'SELECT amount, units, region FROM sales WHERE region IN (\'North\', \'South\', \'West\')',
  },
  charts: [
    { id: 'bar', title: 'Bar', query: 'rev', kind: 'bar', x: 'region', y: 'Total Revenue', format: 'currency' },
    { id: 'stack', title: 'Stack', query: 'q_region', kind: 'stacked-bar', x: 'quarter', y: 'revenue', color: 'region' },
    { id: 'line', title: 'Line', query: 'monthly', kind: 'line', x: 'month', y: 'revenue', color: 'region' },
    { id: 'pts', title: 'Points', query: 'pts', kind: 'scatter', x: 'amount', y: 'units', color: 'region' },
  ],
};

test('every kind chart renders; hover dims bars, legend filters, wheel zooms scatter', async (t) => {
  if (!(await haveBrowser())) return t.skip('no browser');
  const { out } = buildProject(KINDS_SPEC);
  const { page, problems } = await open(out);
  assert.equal(await page.locator('.chart svg').count(), 4);
  // Column name with a space renders under its raw title.
  assert.ok((await page.locator('#chart-bar').textContent()).includes('Total Revenue'));
  const opacities = (sel) => page.evaluate((s) => [...document.querySelectorAll(`${s} .mark-rect path`)].map((p) => p.getAttribute('opacity') ?? '1'), sel);
  const bar = page.locator('#chart-bar .mark-rect path').first();
  await bar.hover();
  assert.ok((await opacities('#chart-bar')).includes('0.55'), 'other bars dimmed on hover');
  await page.locator('#chart-stack .role-legend-symbol path').first().click();
  assert.ok((await opacities('#chart-stack')).includes('0.2'), 'legend click filters');
  const domain = () => page.evaluate(() => {
    const svg = document.querySelector('#chart-pts svg');
    return [...svg.querySelectorAll('.role-axis-label text')].map((t) => t.textContent).join('|');
  });
  await page.locator('#chart-pts').scrollIntoViewIfNeeded(); // wheel needs the pointer over the chart, inside the viewport
  const before = await domain();
  const box = await page.locator('#chart-pts svg').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(300);
  assert.notEqual(await domain(), before, 'scatter axis labels change after wheel zoom');
  assert.deepEqual(problems, []);
  await page.screenshot({ path: path.join(out, 'kinds.png'), fullPage: true });
});

test('theme toggle text reads "Theme: <mode>" and follows the cycle', async (t) => {
  if (!(await haveBrowser())) return t.skip('no browser');
  const { out } = buildProject(SPEC);
  const { page, problems } = await open(out);
  const text = () => page.locator('[data-theme-toggle]').textContent();
  assert.equal(await text(), 'Theme: Auto');
  await page.click('[data-theme-toggle]');
  assert.equal(await text(), 'Theme: Light');
  await page.click('[data-theme-toggle]');
  assert.equal(await text(), 'Theme: Dark');
  assert.deepEqual(problems, []);
});

test('view switcher swaps the chart, Table view sorts, pair shows two, state survives reload', async (t) => {
  if (!(await haveBrowser())) return t.skip('no browser');
  const spec = { ...KINDS_SPEC, charts: [
    { ...KINDS_SPEC.charts[0] },
    { id: 'pair', title: 'Pair', query: 'rev', kind: 'bar', x: 'region', y: 'Total Revenue', pair: true, views: ['share'] },
    { id: 'pair3', title: 'Pair3', query: 'q_region', kind: 'stacked-bar', x: 'quarter', y: 'revenue', color: 'region', pair: true },
  ] };
  const { out } = buildProject(spec);
  const { page, problems } = await open(out);
  const tabs = page.locator('#card-bar [role=tab]');
  assert.deepEqual(await tabs.allTextContents(), ['Bar', 'Sorted', 'Share', 'Table']);
  await page.click('#card-bar [data-view=table]');
  assert.equal(await page.locator('#card-bar .table-view tbody tr').count(), 4);
  await page.click('#card-bar .table-view th:nth-child(2) button');  // sort by revenue
  const first = await page.locator('#card-bar .table-view tbody tr:first-child td:nth-child(2)').textContent();
  await page.click('#card-bar .table-view th:nth-child(2) button');  // reverse
  assert.notEqual(await page.locator('#card-bar .table-view tbody tr:first-child td:nth-child(2)').textContent(), first);
  await page.focus('#card-bar [data-view=table]');
  await page.keyboard.press('ArrowLeft');  // keyboard moves between tabs: Table -> Share
  assert.equal(await page.getAttribute('#card-bar [data-view=share]', 'aria-selected'), 'true');
  assert.equal(await page.locator('#card-pair .chart svg').count(), 2, 'pair renders both views');
  // A paired card: pane 1 is fixed on the primary view, pane 2 has tabs over views[1..], Table included.
  assert.deepEqual(await page.locator('#card-pair [role=tab]').allTextContents(), ['Share', 'Table']);
  assert.deepEqual(await page.locator('#card-pair3 [role=tab]').allTextContents(), ['Grouped', '100%', 'Table']);
  assert.equal(await page.getAttribute('#card-pair [data-view=share]', 'aria-selected'), 'true', 'pane 2 starts on views[1]');
  await page.click('#card-pair [data-view=table]');
  await page.waitForFunction(() => document.querySelectorAll('#chart-pair-2 .table-view').length === 1);
  assert.equal(await page.locator('#chart-pair-2 svg').count(), 0, 'pane 2 shows the table alone');
  assert.equal(await page.locator('#chart-pair svg').count(), 1, 'pane 1 still shows the primary chart');
  assert.equal(await page.locator('#chart-pair .table-view').count(), 0);
  assert.equal(await page.locator('#card-pair [data-export=png]').evaluate((b) => b.hidden), false, 'export uses pane 1, which is still a chart');
  await page.focus('#card-pair3 [data-view=grouped]');
  await page.keyboard.press('ArrowRight'); // keyboard works on pane 2 tabs: Grouped -> 100%
  assert.equal(await page.getAttribute('#card-pair3 [data-view=normalized]', 'aria-selected'), 'true');
  await page.reload();
  await page.waitForFunction(() => window.paReady === true);
  assert.equal(await page.getAttribute('#card-bar [data-view=share]', 'aria-selected'), 'true', 'active view restored');
  assert.equal(await page.getAttribute('#card-pair [data-view=table]', 'aria-selected'), 'true', 'pane 2 view restored');
  assert.equal(await page.locator('#chart-pair-2 .table-view').count(), 1);
  assert.deepEqual(problems, []);
});

test('blocked storage: switching views still works', async (t) => {
  if (!(await haveBrowser())) return t.skip('no browser');
  const { out } = buildProject(KINDS_SPEC);
  const { page, problems } = await open(out, { blockStorage: true });
  await page.click('#card-bar [data-view=sorted]');
  assert.equal(await page.getAttribute('#card-bar [data-view=sorted]', 'aria-selected'), 'true');
  assert.deepEqual(problems, []);
});

// A pane must show what its selected tab says, however fast the user switches:
// vegaEmbed resolves late while the Table view paints at once.
const paneMatchesTab = (page, id) => page.evaluate((cid) => {
  const card = document.getElementById(`card-${cid}`);
  const selected = card.querySelector('[role=tab][aria-selected=true]').getAttribute('data-view');
  const pane = card.querySelector('.chart');
  return { selected, tables: pane.querySelectorAll('.table-view').length, svgs: pane.querySelectorAll('svg').length };
}, id);

test('rapid ArrowRight presses end on Table with the table alone in the pane', async (t) => {
  if (!(await haveBrowser())) return t.skip('no browser');
  const { out } = buildProject(KINDS_SPEC);
  const { page, problems } = await open(out);
  await page.focus('#card-bar [data-view=bar]');
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('ArrowRight'); // Sorted, Share, Table; no waits
  await page.waitForTimeout(500);
  assert.deepEqual(await paneMatchesTab(page, 'bar'), { selected: 'table', tables: 1, svgs: 0 });
  assert.deepEqual(problems, []);
});

test('clicking a chart view and then Table in the same tick leaves only the table', async (t) => {
  if (!(await haveBrowser())) return t.skip('no browser');
  const { out } = buildProject(KINDS_SPEC);
  const { page, problems } = await open(out);
  await page.evaluate(() => {
    for (const v of ['sorted', 'share', 'table']) document.querySelector(`#card-bar [data-view=${v}]`).click();
  });
  await page.waitForTimeout(500);
  assert.deepEqual(await paneMatchesTab(page, 'bar'), { selected: 'table', tables: 1, svgs: 0 });
  await page.evaluate(() => { // and back to a chart view: exactly one svg, no table
    document.querySelector('#card-bar [data-view=table]').click();
    document.querySelector('#card-bar [data-view=sorted]').click();
    document.querySelector('#card-bar [data-view=share]').click();
  });
  await page.waitForTimeout(500);
  assert.deepEqual(await paneMatchesTab(page, 'bar'), { selected: 'share', tables: 0, svgs: 1 });
  assert.deepEqual(problems, []);
});

test('PNG, SVG and CSV export download under the strict CSP', async (t) => {
  if (!(await haveBrowser())) return t.skip('no browser');
  const { out } = buildProject(KINDS_SPEC);
  const { page, problems } = await open(out);
  for (const [kind, name] of [['png', 'bar.png'], ['svg', 'bar.svg'], ['csv', 'bar.csv']]) {
    await page.click('#card-bar details.export summary');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click(`#card-bar [data-export=${kind}]`)]);
    assert.equal(download.suggestedFilename(), name);
    const file = await download.path();
    const head = fs.readFileSync(file).subarray(0, 8);
    if (kind === 'png') assert.deepEqual([...head.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
    if (kind === 'svg') assert.match(head.toString(), /^<svg/);
    if (kind === 'svg') assert.match(fs.readFileSync(file, 'utf8'), /<rect width="100%" height="100%" fill="[^"]+"\/>/, 'filled with the page surface');
    if (kind === 'csv') assert.match(fs.readFileSync(file, 'utf8'), /^region,Total Revenue\r\n/);
  }
  await page.click('#card-bar [data-view=table]');
  await page.click('#card-bar details.export summary');
  assert.equal(await page.isVisible('#card-bar [data-export=png]'), false, 'image export hidden on the Table view');
  assert.equal(await page.isVisible('#card-bar [data-export=csv]'), true, 'CSV stays on the Table view');
  assert.deepEqual(problems, []);
});

test('live page: CSV edit updates the KPI, broken data shows the banner, Rebuild works', async (t) => {
  if (!(await haveBrowser())) return t.skip('no browser');
  const { dir, file } = buildProject({ ...KINDS_SPEC, kpis: [{ id: 'k1', title: 'Rows', query: 'rev', field: 'Total Revenue' }] });
  const { port } = await serve(t, path.resolve('scripts/serve.mjs'), ['--watch', file]); // torn down by t.after
  const url = `http://127.0.0.1:${port}/`;
  browser ??= await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(url);
    await page.waitForFunction(() => window.paReady === true);
    const csv = path.join(dir, 'data/sales.csv');
    fs.appendFileSync(csv, '2025-06-01,North,Widget,100000.00,1\n');
    await page.waitForFunction(() => /\$?1\d\d,\d{3}/.test(document.querySelector('#kpi-k1 .kpi-value').textContent), null, { timeout: 30000 });
    fs.appendFileSync(csv, '"broken\n');
    await page.waitForSelector('#pa-live-banner:not([hidden])', { timeout: 30000 });
    assert.match(await page.textContent('#pa-live-banner'), /queries\.rev|sources/);
    const lines = fs.readFileSync(csv, 'utf8').split('\n');
    fs.writeFileSync(csv, lines.slice(0, -2).join('\n') + '\n');
    await page.waitForSelector('#pa-live-banner[hidden]', { state: 'attached', timeout: 30000 });
    await Promise.all([page.waitForEvent('load', { timeout: 30000 }), page.click('#pa-live-rebuild')]);
  } finally {
    await page.close();
  }
});

test('line and area with a nominal x render without Vega warnings (no zoom binding on a categorical axis)', async (t) => {
  if (!(await haveBrowser())) return t.skip('no browser');
  const spec = { ...KINDS_SPEC, charts: [
    { id: 'ln', title: 'Line', query: 'q_region', kind: 'line', x: 'quarter', y: 'revenue', color: 'region' },
    { id: 'ar', title: 'Area', query: 'q_region', kind: 'area', x: 'quarter', y: 'revenue', color: 'region' },
  ] };
  const { out } = buildProject(spec);
  const { page, problems } = await open(out);
  assert.equal(await page.locator('.chart svg').count(), 2);
  assert.deepEqual(problems, []);
});

// One dashboard with all 11 kinds, built from the fixture CSV.
const ALL_KINDS_SPEC = {
  title: 'All kinds',
  sources: { sales: { type: 'csv', path: 'data/sales.csv' } },
  queries: {
    rev: 'SELECT region, SUM(amount) AS "Total Revenue" FROM sales GROUP BY 1 ORDER BY 2 DESC',
    q_region: "SELECT 'Q' || quarter(date) AS quarter, region, SUM(amount) AS revenue FROM sales GROUP BY 1, 2 ORDER BY 1, 2",
    monthly: "SELECT date_trunc('month', date)::DATE AS month, region, SUM(amount) AS revenue FROM sales GROUP BY 1, 2 ORDER BY 1",
    monthly_total: "SELECT date_trunc('month', date)::DATE AS month, SUM(units) AS units FROM sales GROUP BY 1 ORDER BY 1",
    pts: "SELECT amount, units, amount / units AS price, region FROM sales WHERE region IN ('North', 'South', 'West')",
    grid: 'SELECT product, region, SUM(amount) AS revenue FROM sales GROUP BY 1, 2 ORDER BY 1, 2',
    deals: 'SELECT amount, region FROM sales',
    by_product: 'SELECT product, SUM(units) AS units FROM sales GROUP BY 1 ORDER BY 2 DESC',
  },
  charts: [
    { id: 'k-bar', title: 'Bar', query: 'rev', kind: 'bar', x: 'region', y: 'Total Revenue', format: 'currency', width: 'half' },
    { id: 'k-stacked', title: 'Stacked', query: 'q_region', kind: 'stacked-bar', x: 'quarter', y: 'revenue', color: 'region', format: 'compact', width: 'half' },
    { id: 'k-grouped', title: 'Grouped', query: 'q_region', kind: 'grouped-bar', x: 'quarter', y: 'revenue', color: 'region', width: 'half' },
    { id: 'k-line', title: 'Line', query: 'monthly', kind: 'line', x: 'month', y: 'revenue', color: 'region', format: 'currency', width: 'half' },
    { id: 'k-area', title: 'Area', query: 'monthly_total', kind: 'area', x: 'month', y: 'units', width: 'half' },
    { id: 'k-scatter', title: 'Scatter', query: 'pts', kind: 'scatter', x: 'amount', y: 'units', color: 'region', width: 'half' },
    { id: 'k-bubble', title: 'Bubble', query: 'pts', kind: 'bubble', x: 'amount', y: 'units', size: 'price', format: 'number', width: 'half' },
    { id: 'k-heat', title: 'Heatmap', query: 'grid', kind: 'heatmap', x: 'product', y: 'region', value: 'revenue', format: 'currency', width: 'half' },
    { id: 'k-hist', title: 'Histogram', query: 'deals', kind: 'histogram', value: 'amount', width: 'half' },
    { id: 'k-box', title: 'Box plot', query: 'deals', kind: 'boxplot', value: 'amount', x: 'region', format: 'currency', width: 'half' },
    { id: 'k-donut', title: 'Donut', query: 'by_product', kind: 'donut', x: 'product', y: 'units', width: 'half' },
  ],
};

test('all 11 kinds render with no console errors or warnings, no horizontal overflow at 1280 and 390 px', async (t) => {
  if (!(await haveBrowser())) return t.skip('no browser');
  const { out } = buildProject(ALL_KINDS_SPEC);
  for (const width of [1280, 390]) {
    const { page, problems } = await open(out, { width });
    assert.equal(await page.locator('.chart svg').count(), 11, `11 charts at ${width}`);
    assert.equal(await page.locator('.chart-error').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `no overflow at ${width}`);
    assert.deepEqual(problems, [], `console clean at ${width}`);
    await page.screenshot({ path: path.join(out, `all-kinds-${width}.png`), fullPage: true });
    if (process.env.PA_SHOTS) fs.copyFileSync(path.join(out, `all-kinds-${width}.png`), path.join(process.env.PA_SHOTS, `all-kinds-${width}.png`));
    await page.close();
  }
});

test('tooltips use the chart format and the raw column names; share shows "Share of <y>" as a percent', async (t) => {
  if (!(await haveBrowser())) return t.skip('no browser');
  const { out } = buildProject(ALL_KINDS_SPEC);
  const { page, problems } = await open(out);
  const tooltip = async (sel) => {
    const mark = page.locator(sel).first();
    await mark.scrollIntoViewIfNeeded();
    await mark.hover({ force: true });
    await page.waitForSelector('#vg-tooltip-element.visible', { timeout: 3000 });
    return page.locator('#vg-tooltip-element').innerText();
  };
  const bar = await tooltip('#chart-k-bar .mark-rect path');
  assert.match(bar, /region/);
  assert.match(bar, /Total Revenue\s*\$[\d,]+\.?\d*/, 'currency format in the tooltip');
  await page.mouse.move(0, 0);
  await page.click('#card-k-bar [data-view=share]');
  await page.waitForFunction(() => document.querySelectorAll('#chart-k-bar svg').length === 1);
  const share = await tooltip('#chart-k-bar .mark-rect path');
  assert.match(share, /Share of Total Revenue\s*\d+(\.\d)?%/);
  assert.doesNotMatch(share, /pa_share/);
  const heat = await tooltip('#chart-k-heat .mark-rect path');
  assert.match(heat, /revenue\s*\$[\d,]+/);
  // The first arc's bounding-box centre can sit in the donut hole: aim just inside its outer edge instead.
  await page.locator('#chart-k-donut').scrollIntoViewIfNeeded();
  const ring = await page.evaluate(() => {
    const paths = [...document.querySelectorAll('#chart-k-donut .mark-arc path')];
    const boxes = paths.map((el) => el.getBoundingClientRect());
    const cx = (Math.min(...boxes.map((b) => b.left)) + Math.max(...boxes.map((b) => b.right))) / 2;
    const cy = (Math.min(...boxes.map((b) => b.top)) + Math.max(...boxes.map((b) => b.bottom))) / 2;
    const el = paths[0];
    const pt = el.getPointAtLength(el.getTotalLength() * 0.05).matrixTransform(el.getScreenCTM());
    const d = Math.hypot(cx - pt.x, cy - pt.y);
    return { x: pt.x + ((cx - pt.x) / d) * 8, y: pt.y + ((cy - pt.y) / d) * 8 };
  });
  await page.mouse.move(ring.x, ring.y, { steps: 4 });
  await page.waitForSelector('#vg-tooltip-element.visible', { timeout: 3000 });
  const donut = await page.locator('#vg-tooltip-element').innerText();
  assert.match(donut, /product/);
  assert.match(donut, /units/);
  const box = await tooltip('#chart-k-box .mark-rect path');
  assert.match(box, /Median of amount\s*\$[\d,]+/, 'boxplot statistics follow the chart format');
  const line = await tooltip('#chart-k-line .mark-symbol path');
  assert.match(line, /revenue\s*\$[\d,]+/);
  assert.deepEqual(problems, []);
});

test('a failing image export shows "Export failed: ..." in the card and clears on the next try', async (t) => {
  if (!(await haveBrowser())) return t.skip('no browser');
  const { out } = buildProject(KINDS_SPEC);
  const { page, problems } = await open(out);
  await page.evaluate(() => {
    window.realExport = { toDataURL: HTMLCanvasElement.prototype.toDataURL, createObjectURL: URL.createObjectURL };
    HTMLCanvasElement.prototype.toDataURL = () => { throw new Error('canvas tainted'); };
    URL.createObjectURL = () => { throw new Error('blob refused'); };
  });
  const exportAs = async (kind) => {
    await page.click('#card-bar details.export summary');
    await page.click(`#card-bar [data-export=${kind}]`);
  };
  await exportAs('png');
  await page.waitForSelector('#card-bar .export-error');
  assert.equal(await page.textContent('#card-bar .export-error'), 'Export failed: canvas tainted');
  assert.equal(await page.getAttribute('#card-bar .export-error', 'class'), 'chart-error export-error');
  await exportAs('svg');
  await page.waitForFunction(() => document.querySelector('#card-bar .export-error')?.textContent === 'Export failed: blob refused');
  assert.equal(await page.locator('#card-bar .export-error').count(), 1, 'one line, replaced');
  await page.evaluate(() => {
    HTMLCanvasElement.prototype.toDataURL = window.realExport.toDataURL;
    URL.createObjectURL = window.realExport.createObjectURL;
  });
  await exportAs('csv');
  await page.waitForFunction(() => !document.querySelector('#card-bar .export-error'));
  assert.deepEqual(problems, []);
});

test('live page: a paused watcher is a non-error badge note; the page does not show "build failed"', async (t) => {
  if (!(await haveBrowser())) return t.skip('no browser');
  const { startLiveServer, watchFiles } = await import('../scripts/lib/live.mjs');
  const { file } = buildProject(KINDS_SPEC);
  let armed = 0;
  const watch = (paths, onChange, opts) => {
    armed += 1;
    if (armed > 1) throw Object.assign(new Error('gone'), { code: 'EMFILE' });
    return watchFiles(paths, onChange, opts);
  };
  const live = await startLiveServer({ specFile: file, watch });
  try {
    browser ??= await launchBrowser();
    const page = await browser.newPage();
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text()); });
    await page.goto(live.url);
    await page.waitForFunction(() => window.paReady === true);
    await Promise.all([page.waitForEvent('load', { timeout: 30000 }), page.click('#pa-live-rebuild')]); // good rebuild, arming fails
    await page.waitForFunction(() => window.paReady === true);
    await page.waitForFunction(() => document.getElementById('pa-live-badge').textContent === 'Live (watching paused: EMFILE)', null, { timeout: 15000 });
    assert.equal(await page.locator('#pa-live-banner').isHidden(), true, 'no error banner');
    assert.deepEqual(problems, []);
    await page.close();
  } finally {
    await live.close();
  }
});

test('a stored theme labels the toggle before the vendor scripts parse (no "Theme: Auto" flash)', async (t) => {
  if (!(await haveBrowser())) return t.skip('no browser');
  const { out } = buildProject(SPEC);
  browser ??= await launchBrowser();
  const page = await browser.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('pa-theme', 'dark');
    let vega;
    // Records what the toggle says at the moment the (first) vendor script assigns window.vega.
    Object.defineProperty(window, 'vega', { configurable: true, get: () => vega, set(v) {
      window.labelAtVendor = document.querySelector('[data-theme-toggle]').textContent;
      window.ariaAtVendor = document.querySelector('[data-theme-toggle]').getAttribute('aria-label');
      vega = v;
    } });
  });
  await page.goto(pathToFileURL(path.join(out, 'index.html')).href);
  await page.waitForFunction(() => window.paReady === true, null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => window.labelAtVendor), 'Theme: Dark');
  assert.equal(await page.evaluate(() => window.ariaAtVendor), 'Theme: Dark. Change theme');
  await page.close();
});

test('live page: a stopped server shows "disconnected" and a dead Rebuild click shows "server unreachable"', async (t) => {
  if (!(await haveBrowser())) return t.skip('no browser');
  const { startLiveServer } = await import('../scripts/lib/live.mjs');
  const { file } = buildProject(KINDS_SPEC);
  const live = await startLiveServer({ specFile: file });
  browser ??= await launchBrowser();
  const page = await browser.newPage();
  const pageErrors = []; // the browser logs refused connections itself; only our own script errors count here
  page.on('pageerror', (e) => pageErrors.push(e.message));
  try {
    await page.goto(live.url);
    await page.waitForFunction(() => window.paReady === true);
    const badge = () => page.textContent('#pa-live-badge');
    assert.match(await badge(), /^Live · loaded/);
    await live.close();
    await page.waitForFunction(() => document.getElementById('pa-live-badge').textContent === 'Live · disconnected', null, { timeout: 8000 });
    await page.click('#pa-live-rebuild');
    await page.waitForFunction(() => document.getElementById('pa-live-badge').textContent === 'Live · server unreachable', null, { timeout: 4000 });
    assert.deepEqual(pageErrors, []);
  } finally {
    await live.close();
    await page.close();
  }
});

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser, haveBrowser, buildProject } from './helpers/browser.mjs';

const SPEC = {
  title: 'Browser',
  sources: { sales: { type: 'csv', path: 'data/sales.csv' } },
  queries: { rev: 'SELECT region, SUM(amount) AS revenue FROM sales GROUP BY 1 ORDER BY 2 DESC' },
  charts: [{ id: 'c1', title: 'Revenue', query: 'rev', vegaLite: { mark: 'bar', encoding: { x: { field: 'region', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative' } } } }],
};

let browser;
after(() => browser?.close());

// Opens a built page; collects console errors and page errors.
async function open(out, { width = 1280, blockStorage = false, colorScheme = 'light' } = {}) {
  browser ??= await launchBrowser();
  const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme, acceptDownloads: true });
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
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
  await page.reload();
  await page.waitForFunction(() => window.paReady === true);
  assert.equal(await page.getAttribute('#card-bar [data-view=share]', 'aria-selected'), 'true', 'active view restored');
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
  const { spawn } = await import('node:child_process');
  const { dir, file } = buildProject({ ...KINDS_SPEC, kpis: [{ id: 'k1', title: 'Rows', query: 'rev', field: 'Total Revenue' }] });
  const child = spawn(process.execPath, [path.resolve('scripts/serve.mjs'), '--watch', file], { stdio: ['ignore', 'pipe', 'pipe'] });
  const url = await new Promise((resolve) => { let o = ''; child.stdout.on('data', (d) => { o += d; const m = o.match(/(http:\/\/127\.0\.0\.1:\d+\/)/); if (m && /token:/.test(o)) resolve(m[1]); }); });
  try {
    browser ??= await launchBrowser();
    const page = await browser.newPage();
    await page.goto(url);
    await page.waitForFunction(() => window.paReady === true);
    const csv = path.join(dir, 'data/sales.csv');
    fs.appendFileSync(csv, '2025-06-01,North,Widget,100000.00,1\n');
    await page.waitForFunction(() => /\$?1\d\d,\d{3}/.test(document.querySelector('#kpi-k1 .kpi-value').textContent), null, { timeout: 10000 });
    fs.appendFileSync(csv, '"broken\n');
    await page.waitForSelector('#pa-live-banner:not([hidden])', { timeout: 10000 });
    assert.match(await page.textContent('#pa-live-banner'), /queries\.rev|sources/);
    const lines = fs.readFileSync(csv, 'utf8').split('\n');
    fs.writeFileSync(csv, lines.slice(0, -2).join('\n') + '\n');
    await page.waitForSelector('#pa-live-banner[hidden]', { state: 'attached', timeout: 10000 });
    await Promise.all([page.waitForEvent('load', { timeout: 10000 }), page.click('#pa-live-rebuild')]);
  } finally {
    child.kill();
  }
});

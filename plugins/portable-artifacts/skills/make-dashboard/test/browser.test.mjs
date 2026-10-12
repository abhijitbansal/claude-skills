import { test, after } from 'node:test';
import assert from 'node:assert/strict';
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

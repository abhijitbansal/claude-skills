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

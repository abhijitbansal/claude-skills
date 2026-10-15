import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { haveBrowser, launchBrowser, buildProject } from './helpers/browser.mjs';

const SPEC = {
  title: 'Chrome',
  sources: { sales: { type: 'csv', path: 'data/sales.csv' } },
  queries: { rev: 'SELECT region, SUM(amount) AS revenue FROM sales GROUP BY 1 ORDER BY 2 DESC' },
  charts: [{ id: 'c1', title: 'Revenue', query: 'rev', vegaLite: { mark: 'bar', encoding: { x: { field: 'region', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative' } } } }],
};

let browser;
after(() => Promise.race([browser?.close().catch(() => {}), new Promise((r) => setTimeout(r, 15000).unref())]));

test('toggle cycles icons, repaints the charts and keeps the stamp visible', { skip: !(await haveBrowser()) }, async () => {
  const { out } = buildProject(SPEC);
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
  const problems = [];
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text()); });
  await page.goto(pathToFileURL(path.join(out, 'index.html')).href);
  await page.waitForFunction(() => window.paReady === true, null, { timeout: 15000 });
  const state = () => page.evaluate(() => [document.documentElement.getAttribute('data-theme'), document.querySelector('[data-theme-toggle]').getAttribute('data-mode')]);
  // fill of the first axis label; the chart is re-rendered from the CSS tokens on every theme event
  const labelFill = () => page.evaluate(() => getComputedStyle(document.querySelector('.chart svg text')).fill);
  assert.deepEqual(await state(), [null, 'auto']);
  const seen = {};
  for (const want of ['light', 'dark']) {
    await page.click('[data-theme-toggle]');
    assert.deepEqual(await state(), [want, want]);
    assert.equal(await page.isVisible(`[data-theme-toggle] .pa-ti-${want}`), true);
    const before = seen.light;
    if (before) await page.waitForFunction(([sel, old]) => getComputedStyle(document.querySelector(sel)).fill !== old, ['.chart svg text', before], { timeout: 5000 });
    seen[want] = await labelFill();
  }
  assert.notEqual(seen.light, seen.dark, 'chart label colour follows the theme');
  await page.click('[data-theme-toggle]');
  assert.deepEqual(await state(), [null, 'auto']);
  assert.equal(await page.isVisible('footer.pa-footer .pa-provenance'), true);
  assert.deepEqual(problems, []);
});

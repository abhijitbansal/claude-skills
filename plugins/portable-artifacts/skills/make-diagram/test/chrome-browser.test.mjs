import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { haveBrowser, launchBrowser, buildPage, example } from './helpers/browser.mjs';

let browser;
after(async () => { await browser?.close(); });

test('toggle click cycles data-theme and data-mode; both chrome bits hide in full screen', { skip: !(await haveBrowser()) }, async () => {
  const { url } = buildPage(example('flow'), { name: 'flow' });
  browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => window.paReady === true);
  const mode = () => page.evaluate(() => [document.documentElement.getAttribute('data-theme'), document.querySelector('[data-theme-toggle]').getAttribute('data-mode')]);
  assert.deepEqual(await mode(), [null, 'auto']);
  for (const want of ['light', 'dark', 'auto']) {
    await page.click('[data-theme-toggle]');
    const [theme, m] = await mode();
    assert.equal(m, want);
    assert.equal(theme, want === 'auto' ? null : want);
    assert.equal(await page.isVisible(`[data-theme-toggle] .pa-ti-${want}`), true);
  }
  assert.equal(await page.isVisible('.pa-provenance'), true);
  await page.keyboard.press('f');
  await page.waitForFunction(() => document.documentElement.classList.contains('pa-fill') || document.fullscreenElement);
  assert.equal(await page.isVisible('[data-theme-toggle]'), false);
  assert.equal(await page.isVisible('.pa-provenance'), false);
  assert.deepEqual(problems, []);
  await context.close();
});

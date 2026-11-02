// Task 24: in the preview, clicking an element copies its spec path and id; the render page has no such handler.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { requireRender, BROWSER_ONLY } from './helpers/render.mjs';
import { launchBrowser, guardNetwork } from '../scripts/lib/browser.mjs';
import { startServer } from '../scripts/lib/server.mjs';

const TOAST = '#pick-toast';
const TOAST_MS = 2000;
const SPEC = {
  size: [640, 360], fps: 10, scenes: [
    { id: 'a', duration: 2, elements: [
      { id: 'title', type: 'text', text: 'Pick me', x: 320, y: 60, fontSize: 32, fontWeight: 700 },
      { id: 'grp', type: 'group', x: 320, y: 160, children: [
        { id: 'sub', type: 'text', text: 'Nested child', x: 0, y: 0, fontSize: 24 },
      ] },
    ] },
  ],
};

// `fn({ page, click })`: `click(selector)` clicks the middle of the node and returns after the event has been handled.
async function withPage(mode, fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'pick-'));
  const specPath = path.join(dir, 'm.json');
  writeFileSync(specPath, JSON.stringify(SPEC));
  const server = await startServer({ specPath, mode });
  const browser = await launchBrowser({ quiet: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(server.url).origin });
    const page = await context.newPage();
    await guardNetwork(page, new URL(server.url).origin, () => {});
    await page.goto(server.url);
    await page.waitForFunction(() => window.__motion);
    await page.evaluate(() => window.__motion.ready);
    await page.evaluate(() => window.__motion.seek(0.5));
    return await fn({ page, click: (selector) => page.locator(selector).click() });
  } finally {
    await browser.close();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const toastText = (page) => page.locator(TOAST).textContent();

test('preview: clicking a nested child copies its nested path and id, and shows the toast', async (t) => {
  if (!await requireRender(t, BROWSER_ONLY)) return;
  await withPage('preview', async ({ page, click }) => {
    await click('[data-path="scenes[0].elements[1].children[0]"]');
    await page.waitForSelector(TOAST, { state: 'visible' });
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'scenes[0].elements[1].children[0]  id=sub');
    assert.equal(await toastText(page), 'copied scenes[0].elements[1].children[0] (id "sub")');
  });
});

test('preview: clicking a top-level element copies its path and id', async (t) => {
  if (!await requireRender(t, BROWSER_ONLY)) return;
  await withPage('preview', async ({ page, click }) => {
    await click('[data-path="scenes[0].elements[0]"]');
    await page.waitForSelector(TOAST, { state: 'visible' });
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'scenes[0].elements[0]  id=title');
    assert.equal(await toastText(page), 'copied scenes[0].elements[0] (id "title")');
  });
});

test('preview: the toast goes away after about 2 seconds', async (t) => {
  if (!await requireRender(t, BROWSER_ONLY)) return;
  await withPage('preview', async ({ page, click }) => {
    await click('[data-path="scenes[0].elements[0]"]');
    await page.waitForSelector(TOAST, { state: 'visible' });
    const shown = Date.now();
    await page.waitForSelector(TOAST, { state: 'hidden', timeout: TOAST_MS + 1500 });
    const elapsed = Date.now() - shown;
    assert.ok(elapsed >= TOAST_MS - 400 && elapsed <= TOAST_MS + 1000, `toast hid after ${elapsed} ms`);
  });
});

test('preview: a click on empty stage copies nothing and shows no toast', async (t) => {
  if (!await requireRender(t, BROWSER_ONLY)) return;
  await withPage('preview', async ({ page }) => {
    await page.evaluate(() => navigator.clipboard.writeText('untouched'));
    const box = await page.locator('#stage').boundingBox();
    await page.mouse.click(box.x + 4, box.y + box.height - 4); // bottom-left corner: no element there
    await page.waitForTimeout(150);
    assert.equal(await page.locator(TOAST).count() === 0 || !(await page.locator(TOAST).isVisible()), true, 'no toast');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'untouched');
  });
});

test('render mode has no handler: a click shows no toast and copies nothing', async (t) => {
  if (!await requireRender(t, BROWSER_ONLY)) return;
  await withPage('render', async ({ page, click }) => {
    await page.evaluate(() => navigator.clipboard.writeText('untouched'));
    await click('[data-path="scenes[0].elements[0]"]');
    await page.waitForTimeout(150);
    assert.equal(await page.locator(TOAST).count(), 0, 'no toast element in render mode');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'untouched');
  });
});

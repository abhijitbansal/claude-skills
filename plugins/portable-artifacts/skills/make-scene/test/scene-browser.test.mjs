// Full-page browser tests on built pages: every world draws, the theme re-tints, hover reads exact values as text,
// the tour plays, no WebGL shows the table, reduced motion holds still. Each skips without Chromium (or without WebGL).
// Already covered elsewhere, not repeated here:
//   context loss shows fallback -> runtime-mount.test.mjs "context loss hides canvas, wrapper and controls and shows the fallback"
// Canvas pixels are read from a Playwright element screenshot decoded in Node: the canvas has no preserveDrawingBuffer.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { GRID, MIN_COLOURS } from '../scripts/lib/canvas-shot.mjs';
import { distinctColours } from '../scripts/lib/png.mjs';
import {
  HOSTILE, WORLDS, buildWorldPage, canvasHash, canvasPng, demoRows, launchBrowser,
} from './helpers/browser.mjs';

const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 390, height: 780 }];
const NO_WEBGL_ARGS = ['--disable-webgl', '--disable-gpu'];

let browser = null;
let skipReason = null;
before(async () => {
  try {
    browser = await launchBrowser();
  } catch (err) {
    skipReason = `no browser (${String(err.message).split('\n')[0]})`;
  }
});
after(async () => {
  await browser?.close();
});

// Opens a built page with the test hook (?test); null (after skipping) when there is no browser or WebGL does not run.
async function open(t, world, { viewport = VIEWPORTS[0], build = {}, ...contextOptions } = {}) {
  if (!browser) return t.skip(skipReason) ?? null;
  const { file } = await buildWorldPage(t, world, build);
  const context = await browser.newContext({ viewport, ...contextOptions });
  t.after(() => context.close());
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(`${pathToFileURL(file).href}?test`);
  await page.waitForFunction(() => document.querySelector('[data-pa-scene]').dataset.sceneState !== 'loading', null, { timeout: 10000 });
  if ((await page.evaluate(() => document.querySelector('[data-pa-scene]').dataset.sceneState)) !== 'ready') {
    t.skip('WebGL unavailable in this Chromium');
    return null;
  }
  return { page, problems };
}

const items = (page) => page.evaluate(() => JSON.parse(document.querySelector('script[type="application/json"]').textContent).items);
const tip = (page) => page.evaluate(() => {
  const el = document.querySelector('.sc-tip');
  return el.hidden ? null : { label: el.querySelector('.sc-tip-label').textContent, display: el.querySelector('.sc-tip-value').textContent };
});

// Moves the real pointer onto the top of an item's first building and waits for its tooltip.
async function hoverItem(page, index) {
  const at = await page.evaluate((i) => window.PAScene.__project(i), index);
  assert.ok(at, `item ${index} is on screen`);
  await page.mouse.move(at.x - 3, at.y - 3);
  await page.mouse.move(at.x, at.y);
  await page.waitForFunction(() => !document.querySelector('.sc-tip').hidden, null, { timeout: 2000 });
  return tip(page);
}

for (const world of WORLDS) {
  test(`${world} renders non-blank at both widths`, async (t) => {
    for (const viewport of VIEWPORTS) {
      const ctx = await open(t, world, { viewport });
      if (!ctx) return;
      const colours = distinctColours(await canvasPng(ctx.page), GRID);
      assert.ok(colours >= MIN_COLOURS, `${world} at ${viewport.width}px: ${colours} distinct colours, need ${MIN_COLOURS}`);
      assert.deepEqual(ctx.problems, []);
    }
  });
}

test('theme toggle re-tints the canvas', async (t) => {
  const ctx = await open(t, 'city', { colorScheme: 'dark' });
  if (!ctx) return;
  const { page } = ctx;
  const before_ = await canvasHash(page);
  await page.locator('[data-theme-toggle]').click(); // auto (dark by the OS) -> light
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'light');
  await page.waitForTimeout(400);
  assert.notEqual(await canvasHash(page), before_, 'the sampled pixels changed');
  assert.deepEqual(ctx.problems, []);
});

test('hover shows exact value: the tooltip reads the item display as text', async (t) => {
  const ctx = await open(t, 'city');
  if (!ctx) return;
  const { page } = ctx;
  const all = await items(page);
  // The tallest buildings stand clear of their neighbours, so their tops are not hidden from the camera.
  const tallest = all.map((item, i) => [item.value, i]).sort((a, b) => b[0] - a[0]).slice(0, 3).map(([, i]) => i);
  for (const index of tallest) {
    const text = await hoverItem(page, index);
    assert.deepEqual(text, { label: all[index].label, display: all[index].display }, `item ${index}`);
  }
  assert.deepEqual(ctx.problems, []);
});

test('tour plays to last beat', async (t) => {
  const tour = [{ title: 'First', focus: ['api'], caption: 'one' }, { title: 'Second', focus: ['web'], caption: 'two' }];
  const ctx = await open(t, 'city', { reducedMotion: 'reduce', build: { spec: { tour } } });
  if (!ctx) return;
  const { page } = ctx;
  await page.keyboard.press('p');
  assert.equal(await page.locator('.sc-cap-count').textContent(), '1 / 2');
  await page.keyboard.press(' ');
  assert.equal(await page.getByRole('button', { name: 'Pause' }).count(), 1, 'playing');
  await page.waitForFunction(() => document.querySelector('.sc-cap-count').textContent === '2 / 2', null, { timeout: 12000 });
  assert.deepEqual(ctx.problems, []);
});

test('no webgl shows fallback: the table is visible, the controls are hidden, nothing throws', async (t) => {
  let blind;
  try {
    blind = await launchBrowser(process.env, { args: NO_WEBGL_ARGS });
  } catch (err) {
    return t.skip(`no browser (${String(err.message).split('\n')[0]})`);
  }
  t.after(() => blind.close());
  const { file } = await buildWorldPage(t, 'city');
  const page = await (await blind.newContext({ viewport: VIEWPORTS[0] })).newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(pathToFileURL(file).href);
  await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => document.querySelector('[data-pa-scene]').dataset.sceneState), 'fallback');
  assert.equal(await page.locator('.sc-table table').isVisible(), true, 'the fallback table is visible');
  assert.ok((await page.locator('.sc-table tbody tr').count()) > 0, 'with its rows');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('canvas')).display), 'none');
  assert.equal(await page.locator('[data-scene-controls]').first().isVisible(), false, 'the controls are hidden');
  assert.deepEqual(problems, []);
});

test('hostile label stays text: the tooltip shows the raw string and no element is created from it', async (t) => {
  const rows = demoRows().map((row, i) => (i === 0 ? { ...row, label: HOSTILE, value: 99 } : row)); // the tallest building: its top is never hidden
  const ctx = await open(t, 'city', { build: { rows } });
  if (!ctx) return;
  const { page } = ctx;
  const all = await items(page);
  const index = all.findIndex((item) => item.label === HOSTILE);
  assert.ok(index >= 0, 'the hostile label reached the graph');
  const text = await hoverItem(page, index);
  assert.equal(text.label, HOSTILE);
  assert.equal(await page.evaluate(() => document.querySelector('.sc-tip-label').textContent), HOSTILE);
  assert.equal(await page.locator('.sc-tip img').count(), 0);
  assert.equal(await page.locator('img').count(), 0, 'no <img> anywhere');
  assert.equal(await page.evaluate(() => window.PWNED), undefined);
  assert.deepEqual(ctx.problems, []);
});

test('reduced motion stays still: two screenshots 500 ms apart are identical, and motion would have shown', async (t) => {
  const still = await open(t, 'galaxy', { reducedMotion: 'reduce' });
  if (!still) return;
  const first = await canvasHash(still.page);
  await still.page.waitForTimeout(500);
  assert.equal(await canvasHash(still.page), first, 'reduced motion: nothing moved');
  // The guard fires: the same page with motion allowed does move between the same two screenshots.
  const moving = await open(t, 'galaxy', { reducedMotion: 'no-preference' });
  const a = await canvasHash(moving.page);
  await moving.page.waitForTimeout(500);
  assert.notEqual(await canvasHash(moving.page), a, 'with motion allowed the scene moves');
});

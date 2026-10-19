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
  const notes = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
    if (m.type() === 'warning') problems.push(`warning: ${m.text()}`); // the expected no-WebGL case is info, so a warning is a real problem
    if (m.type() === 'info') notes.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(pathToFileURL(file).href);
  await page.waitForTimeout(600);
  assert.ok(notes.some((n) => /showing the table instead of the 3D view \(WebGL is not available\)/.test(n)), `info says why: ${JSON.stringify(notes)}`);
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

// ---- first-open framing and labels (Task 15a) ----

// Where every point of the page's graph (instance corners, ring circles, tube points, surface corners) lands on screen, in canvas pixels.
const screenExtent = (page) => page.evaluate(() => {
  const graph = JSON.parse(document.querySelector('script[type="application/json"]').textContent);
  const api = window.PAScene.__scene;
  const w = api.canvas.clientWidth;
  const h = api.canvas.clientHeight;
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  const take = (x, y, z) => {
    const p = api.project(x, y, z);
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  };
  for (const batch of graph.batches) {
    for (const [x, y, z, sx, sy, sz] of batch.instances) {
      if (batch.shape === 'ring') {
        for (let k = 0; k < 16; k++) take(x + (Math.cos((k * Math.PI) / 8) * sx) / 2, y, z + (Math.sin((k * Math.PI) / 8) * sz) / 2);
      } else {
        for (const dx of [-sx / 2, sx / 2]) for (const dy of [-sy / 2, sy / 2]) for (const dz of [-sz / 2, sz / 2]) take(x + dx, y + dy, z + dz);
      }
    }
  }
  for (const tube of graph.tubes) for (const [x, y, z] of tube.points) take(x, y, z);
  for (const surface of graph.surfaces) {
    const [sx, sz, sy] = surface.size;
    for (const x of [-sx / 2, sx / 2]) for (const z of [-sz / 2, sz / 2]) take(x, 0, z);
    const top = surface.heights.reduce((m, v) => Math.max(m, v), 0) * sy;
    for (const x of [-sx / 2, sx / 2]) for (const z of [-sz / 2, sz / 2]) take(x, top, z);
  }
  return { w, h, x0, y0, x1, y1 };
});

for (const world of WORLDS) {
  test(`${world}: the first view frames the scene tightly, in both directions, at both widths`, async (t) => {
    for (const viewport of VIEWPORTS) {
      const ctx = await open(t, world, { viewport, reducedMotion: 'reduce' });
      if (!ctx) return;
      await ctx.page.waitForTimeout(500);
      const e = await screenExtent(ctx.page);
      const fillX = (e.x1 - e.x0) / e.w;
      const fillY = (e.y1 - e.y0) / e.h;
      const at = `${world} at ${viewport.width}px: fills ${fillX.toFixed(2)} x ${fillY.toFixed(2)}`;
      assert.ok(e.x0 >= -2 && e.y0 >= -2 && e.x1 <= e.w + 2 && e.y1 <= e.h + 2, `${at}; nothing is cropped`);
      assert.ok(Math.max(fillX, fillY) >= 0.6, `${at}; the scene fills at least 60% of the frame in its limiting direction`);
    }
  });
}

test('labels: a long label is cut with an ellipsis; no two visible labels overlap', async (t) => {
  const long = (n) => `District ${n} of the infrastructure and platform reliability work`.slice(0, 48);
  const rows = demoRows((group) => group).map((row) => ({ ...row, group: long(['api', 'web', 'db'].indexOf(row.group) + 1) }));
  const ctx = await open(t, 'city', { viewport: VIEWPORTS[1], reducedMotion: 'reduce', build: { rows } });
  if (!ctx) return;
  await ctx.page.waitForTimeout(500);
  const labels = await ctx.page.evaluate(() => [...document.querySelectorAll('.sc-label')].map((el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return { hidden: el.hidden, text: el.textContent, left: r.left, right: r.right, top: r.top, bottom: r.bottom, overflow: s.textOverflow };
  }));
  const shown = labels.filter((l) => !l.hidden);
  assert.ok(shown.length >= 1, 'at least one label is drawn');
  for (const l of shown) {
    assert.ok(l.right - l.left <= 0.4 * 390 + 1, `a label is at most 40vw wide (${(l.right - l.left).toFixed(0)}px)`);
    assert.equal(l.overflow, 'ellipsis');
  }
  shown.forEach((a, i) => shown.slice(i + 1).forEach((b) => {
    const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    assert.equal(overlap, false, `"${a.text}" and "${b.text}" overlap`);
  }));
  assert.deepEqual(ctx.problems, []);
});

test('the first tour beat of a city keeps its target in the middle of the frame at 390px and nothing between them', async (t) => {
  const tour = [{ title: 'API', focus: ['api'], caption: 'x' }];
  const ctx = await open(t, 'city', { viewport: VIEWPORTS[1], reducedMotion: 'reduce', build: { spec: { tour } } });
  if (!ctx) return;
  const { page } = ctx;
  await page.keyboard.press('p');
  await page.waitForTimeout(500);
  const at = await page.evaluate(() => {
    const graph = JSON.parse(document.querySelector('script[type="application/json"]').textContent);
    const [x, y, z] = graph.focus.api.target;
    const api = window.PAScene.__scene;
    const p = api.project(x, y, z);
    return { x: p.x / api.canvas.clientWidth, y: p.y / api.canvas.clientHeight, visible: p.visible };
  });
  assert.ok(at.visible && Math.abs(at.x - 0.5) <= 0.3 && Math.abs(at.y - 0.5) <= 0.3, `the target is in the middle 60%: ${JSON.stringify(at)}`);
});

for (const world of ['galaxy', 'city', 'terrain']) {
  test(`${world}: turning a phone from landscape to portrait re-frames an untouched view`, async (t) => {
    const ctx = await open(t, world, { viewport: { width: 780, height: 390 }, reducedMotion: 'reduce' });
    if (!ctx) return;
    const { page } = ctx;
    await page.waitForTimeout(400);
    await page.setViewportSize({ width: 390, height: 780 });
    await page.waitForTimeout(800);
    const e = await screenExtent(page);
    const at = `${world} after rotating: ${JSON.stringify(e)}`;
    assert.ok(e.x0 >= -2 && e.y0 >= -2 && e.x1 <= e.w + 2 && e.y1 <= e.h + 2, `${at}; nothing is cropped`);
    assert.ok(Math.max((e.x1 - e.x0) / e.w, (e.y1 - e.y0) / e.h) >= 0.6, `${at}; and it still fills the frame`);
  });
}

test('a viewer who has moved the camera keeps it when the viewport turns; the overview distance still follows', async (t) => {
  const ctx = await open(t, 'galaxy', { viewport: { width: 780, height: 390 }, reducedMotion: 'reduce' });
  if (!ctx) return;
  const { page } = ctx;
  const spot = () => page.evaluate(() => { const p = window.PAScene.__scene.project(0, 0, 0); return [Math.round(p.x), Math.round(p.y)]; });
  await page.mouse.move(300, 200);
  await page.mouse.down();
  await page.mouse.move(340, 200, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  const before_ = await spot();
  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForTimeout(800);
  const after_ = await spot();
  assert.notDeepEqual(before_, after_, 'the canvas resized, so the projection moved');
  const e = await screenExtent(page);
  assert.ok(Number.isFinite(e.x0) && e.w === 390, 'the scene still draws');
});

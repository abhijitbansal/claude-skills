// Browser checks for the diagram lift: the lifted page draws, its tour sends a light along each edge (reversed for
// replies, at the end at once under reduced motion). Skips without Chromium or WebGL.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from '../scripts/build.mjs';
import { GRID, MIN_COLOURS } from '../scripts/lib/canvas-shot.mjs';
import { distinctColours } from '../scripts/lib/png.mjs';
import { canvasPng, launchBrowser } from './helpers/browser.mjs';
import { PINNED_ENV, tempDir } from './helpers/scene-fixtures.mjs';

const FIX = new URL('./fixtures/', import.meta.url);

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

// Builds a lift of one fixture diagram into a temp folder and opens it; null (after skipping) without WebGL.
async function open(t, diagram, { reducedMotion = 'no-preference', viewport = { width: 1440, height: 900 }, spec = {} } = {}) {
  if (!browser) return t.skip(skipReason) ?? null;
  const dir = tempDir(t, 'scene-lift-');
  fs.copyFileSync(new URL(diagram, FIX), path.join(dir, diagram));
  fs.writeFileSync(path.join(dir, 'scene.json'), JSON.stringify({ title: 'Lifted', lift: { diagram }, ...spec }));
  const built = await build(path.join(dir, 'scene.json'), { out: path.join(dir, 'page.html'), env: { ...PINNED_ENV, PA_OUTPUT_DIR: dir } });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  const context = await browser.newContext({ viewport, reducedMotion });
  t.after(() => context.close());
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(`${pathToFileURL(built.out).href}?test`);
  await page.waitForFunction(() => document.querySelector('[data-pa-scene]').dataset.sceneState !== 'loading', null, { timeout: 10000 });
  if ((await page.evaluate(() => document.querySelector('[data-pa-scene]').dataset.sceneState)) !== 'ready') {
    t.skip('WebGL unavailable in this Chromium');
    return null;
  }
  return { page, problems };
}

const light = (page) => page.evaluate(() => window.PAScene.__scene.traveller());

test('a lifted architecture and a lifted sequence draw something', async (t) => {
  for (const diagram of ['architecture.diagram.json', 'sequence.diagram.json']) {
    const ctx = await open(t, diagram);
    if (!ctx) return;
    const colours = distinctColours(await canvasPng(ctx.page), GRID);
    assert.ok(colours >= MIN_COLOURS, `${diagram}: ${colours} distinct colours, need ${MIN_COLOURS}`);
    assert.deepEqual(ctx.problems, []);
  }
});

test('the tour sends a light along the beat edge and it arrives', async (t) => {
  const ctx = await open(t, 'story.diagram.json');
  if (!ctx) return;
  const { page } = ctx;
  assert.equal(await light(page), null, 'no light before the tour');
  await page.keyboard.press('p'); // beat 1: shopper -> app (edge-0)
  await page.waitForFunction(() => window.PAScene.__scene.traveller()?.id === 'edge-0', null, { timeout: 3000 });
  const start = await light(page);
  assert.equal(start.done, false, 'it is travelling');
  await page.waitForFunction(() => window.PAScene.__scene.traveller().done === true, null, { timeout: 5000 });
  const end = await light(page);
  assert.equal(end.at, 1);
  assert.notDeepEqual(end.position, start.position, 'it moved along the tube');
  await page.keyboard.press('ArrowRight'); // beat 2: place
  await page.waitForFunction(() => window.PAScene.__scene.traveller()?.id === 'place', null, { timeout: 3000 });
  assert.deepEqual(ctx.problems, []);
});

test('a reply beat sends the light back along the edge', async (t) => {
  const ctx = await open(t, 'story.diagram.json');
  if (!ctx) return;
  const { page } = ctx;
  await page.keyboard.press('p');
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight'); // beat 6: "The shopper sees a receipt", reversed
  await page.waitForFunction(() => window.PAScene.__scene.traveller()?.id === 'edge-0', null, { timeout: 3000 });
  const first = await light(page);
  await page.waitForFunction(() => window.PAScene.__scene.traveller().done === true, null, { timeout: 5000 });
  const last = await light(page);
  assert.ok(first.at > 0.5 && last.at === 0, `it runs from the far end (${first.at}) back to the start (${last.at})`);
});

test('under reduced motion the light jumps to the end', async (t) => {
  const ctx = await open(t, 'story.diagram.json', { reducedMotion: 'reduce' });
  if (!ctx) return;
  const { page } = ctx;
  await page.keyboard.press('p');
  const seen = await light(page);
  assert.deepEqual({ id: seen.id, at: seen.at, done: seen.done }, { id: 'edge-0', at: 1, done: true });
  await page.getByRole('button', { name: 'Close' }).click();
  assert.equal(await light(page), null, 'a closed tour hides the light');
  assert.deepEqual(ctx.problems, []);
});

test('a focus beat has no light', async (t) => {
  const ctx = await open(t, 'story.diagram.json', { reducedMotion: 'reduce' });
  if (!ctx) return;
  const { page } = ctx;
  await page.keyboard.press('p');
  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight'); // beat 9: focus on the core group
  assert.equal(await page.locator('.sc-cap-count').textContent(), '9 / 9');
  assert.equal(await light(page), null);
});

test('hovering an edge reads its label and its ends; hovering a node reads its detail or kind', async (t) => {
  const ctx = await open(t, 'architecture.diagram.json', { reducedMotion: 'reduce' });
  if (!ctx) return;
  const { page } = ctx;
  const graph = await page.evaluate(() => JSON.parse(document.querySelector('script[type="application/json"]').textContent));
  const tooltip = () => page.evaluate(() => {
    const el = document.querySelector('.sc-tip');
    return el.hidden ? null : { label: el.querySelector('.sc-tip-label').textContent, display: el.querySelector('.sc-tip-value').textContent };
  });
  const hoverAt = async (world) => {
    const at = await page.evaluate(([x, y, z]) => {
      const p = window.PAScene.__scene.project(x, y, z);
      const r = window.PAScene.__scene.canvas.getBoundingClientRect();
      return { x: r.left + p.x, y: r.top + p.y };
    }, world);
    await page.mouse.move(at.x - 4, at.y - 4);
    await page.mouse.move(at.x, at.y);
    await page.waitForFunction(() => !document.querySelector('.sc-tip').hidden, null, { timeout: 2000 });
    return tooltip();
  };
  const edge = graph.tubes.find((x) => x.id === 'edge-0');
  const [a, b] = [edge.points[0], edge.points.at(-1)];
  const mid = a.map((v, i) => (v + b[i]) / 2); // halfway along a straight edge, clear of both nodes
  assert.deepEqual(await hoverAt(mid), { label: 'POST /checkout', display: 'Web app → Checkout API' });
  const db = graph.batches.find((b) => b.shape === 'cylinder').instances[0];
  assert.deepEqual(await hoverAt([db[0], db[1] + db[4] / 2, db[2]]), { label: 'Orders DB', display: 'database' });
  assert.deepEqual(ctx.problems, []);
});

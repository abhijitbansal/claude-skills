// Smoke tests for the page chrome in a real page: tooltip, Explore, tour keys, text-only labels, PNG export.
// Skips itself without Chromium or WebGL (the full browser matrix is Task 9's).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { build } from '../scripts/build.mjs';
import { loadTheme, themeCss } from '../shared/theme.mjs';
import { PINNED_ENV, tempDir, writeScene } from './helpers/scene-fixtures.mjs';

const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const HOSTILE = '<img src=x onerror=window.PWNED=1>';
const ROWS = [
  { group: HOSTILE, t: '2026-W30', value: 12, label: HOSTILE },
  { group: 'web', t: '2026-W30', value: 5 },
  { group: HOSTILE, t: '2026-W31', value: 7 },
  { group: 'web', t: '2026-W31', value: 9 },
];
const TOUR = [{ title: 'First', focus: ['web'], caption: 'one' }, { title: 'Second', focus: [HOSTILE], caption: 'two' }];

let browser = null;
let skipReason = null;
before(async () => {
  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ args: ARGS });
  } catch (err) {
    skipReason = `no Chromium (${err.message.split('\n')[0]})`;
  }
});
after(async () => {
  await browser?.close();
});

async function open(t, { reducedMotion = 'no-preference' } = {}) {
  if (!browser) return t.skip(skipReason) ?? null;
  const dir = tempDir(t);
  const file = writeScene(t, { title: 'Chrome smoke', world: 'city', units: 'commits', data: { file: 'rows.json' }, tour: TOUR }, { rows: ROWS });
  const built = await build(file, { out: `${dir}/page.html`, env: { ...PINNED_ENV, PA_OUTPUT_DIR: dir } });
  assert.equal(built.ok, true);
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 }, acceptDownloads: true, reducedMotion });
  t.after(() => context.close());
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(`file://${built.out}`);
  await page.waitForTimeout(600);
  if ((await page.evaluate(() => document.querySelector('[data-pa-scene]').dataset.sceneState)) !== 'ready') {
    t.skip('WebGL unavailable in this Chromium');
    return null;
  }
  return { page, problems };
}

const tipText = (page) => page.evaluate(() => { const tip = document.querySelector('.sc-tip'); return tip.hidden ? null : tip.textContent; });

test('hovering a building shows its exact label and value as text; hostile labels never become markup', async (t) => {
  const ctx = await open(t);
  if (!ctx) return;
  const { page, problems } = ctx;
  const box = await page.locator('canvas').boundingBox();
  let tip = null;
  for (let fy = 0.2; fy < 0.95 && !tip; fy += 0.04) {
    for (let fx = 0.1; fx < 0.9 && !tip; fx += 0.04) {
      await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
      await page.waitForTimeout(25);
      tip = await tipText(page);
    }
  }
  assert.ok(tip, 'some pixel of the city shows a tooltip');
  assert.match(tip, /\d+ commits$/);
  assert.equal(await page.locator('img').count(), 0, 'no <img> element was created from a label');
  assert.equal(await page.evaluate(() => window.PWNED), undefined);
  assert.deepEqual(problems, []);
});

test('Explore lists groups and items as text and flies on click; E and Escape toggle it', async (t) => {
  const ctx = await open(t);
  if (!ctx) return;
  const { page } = ctx;
  await page.keyboard.press('e');
  assert.equal(await page.locator('.sc-explore').isVisible(), true);
  const names = await page.locator('.sc-group-toggle .sc-row-label').allTextContents();
  assert.ok(names.includes(HOSTILE), 'the hostile name is listed as literal text');
  await page.locator('.sc-view').first().click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.sc-explore').isVisible(), false);
  assert.equal(await page.evaluate(() => window.PWNED), undefined);
});

test('P opens beat 1, Space plays and pauses, arrows step, Close leaves the tour', async (t) => {
  const ctx = await open(t, { reducedMotion: 'reduce' });
  if (!ctx) return;
  const { page } = ctx;
  const count = () => page.locator('.sc-cap-count').textContent();
  await page.keyboard.press('p');
  assert.equal(await count(), '1 / 2');
  await page.keyboard.press('ArrowRight');
  assert.equal(await count(), '2 / 2');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await count(), '1 / 2');
  await page.keyboard.press(' ');
  assert.equal(await page.getByRole('button', { name: 'Pause' }).count(), 1, 'Space plays');
  await page.keyboard.press(' ');
  assert.equal(await page.getByRole('button', { name: 'Play' }).count(), 1, 'Space pauses');
  await page.getByRole('button', { name: 'Close' }).last().click();
  assert.equal(await page.locator('.sc-tour').isVisible(), false);
});

test('PNG export downloads a real image of the current frame, even when the loop has gone idle', async (t) => {
  const ctx = await open(t, { reducedMotion: 'reduce' });
  if (!ctx) return;
  const { page } = ctx;
  await page.waitForTimeout(2200); // reduced motion: nothing moves, so the render loop stops after its idle time
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save a PNG of this view' }).click();
  const file = await download;
  assert.equal(file.suggestedFilename(), 'chrome-smoke.png');
  const stream = await file.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const bytes = Buffer.concat(chunks);
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  assert.ok(bytes.length > 5000, `a rendered frame, not a blank canvas (${bytes.length} bytes)`);
});

test('hovering a planet shows that planet, never the link whose hover tube encloses it', async (t) => {
  if (!browser) return t.skip(skipReason);
  // Seven systems, every pair linked: links cross over many planets, so a hit tube is often nearer than the planet behind it.
  const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const rows = names.flatMap((group, g) => [1, 2, 3, 4, 5].map((step) => ({ group, t: step, value: 3 + ((g * 5 + step * 3) % 9) })));
  const links = names.flatMap((from, i) => names.slice(i + 1).map((to) => ({ from, to, value: i + 2 })));
  const dir = tempDir(t);
  const file = writeScene(t, { title: 'Hover planets', world: 'galaxy', units: 'calls', data: { file: 'rows.json' } }, { rows, links });
  const built = await build(file, { out: `${dir}/page.html`, env: { ...PINNED_ENV, PA_OUTPUT_DIR: dir } });
  assert.equal(built.ok, true);
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(`file://${built.out}`);
  await page.waitForTimeout(600);
  const result = await page.evaluate(async () => {
    // A second, static mount of the same graph (reduced motion: planets sit at their time-0 pose) to read the api.
    const graph = JSON.parse(document.querySelector('script[type="application/json"]').textContent);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:0;top:0;width:1000px;height:700px;z-index:99';
    host.innerHTML = '<div data-scene-canvas style="position:absolute;inset:0"></div><div data-scene-fallback></div>';
    document.body.append(host);
    const api = PAScene.mountScene(host, graph, { reducedMotion: true });
    await new Promise((r) => setTimeout(r, 400));
    const rect = api.canvas.getBoundingClientRect();
    const planets = graph.anim.orbits.flatMap((o) => graph.batches.find((b) => b.id === o.batch).instances);
    const seen = planets.map((p) => {
      const at = api.project(p[0], p[1], p[2]);
      if (!at.visible) return null;
      const hit = api.pickHit(rect.left + at.x, rect.top + at.y);
      return { want: p[6], item: hit.item, tube: hit.tube };
    }).filter(Boolean);
    return { total: planets.length, seen, state: host.dataset.sceneState };
  });
  if (result.state !== 'ready') return t.skip('WebGL unavailable in this Chromium');
  assert.ok(result.seen.length >= 25, `most of the ${result.total} planets are on screen (${result.seen.length})`);
  const links_ = result.seen.filter((s) => s.tube >= 0);
  assert.deepEqual(links_, [], 'no planet reads as a link');
  assert.ok(result.seen.every((s) => s.item >= 0), 'every planet reads as an item');
  // Planets are drawn large enough to read (diameter 0.1 to 0.5 on orbits 0.32 apart), so now and then one hides another
  // in the line of sight; the nearer planet is what the pointer finds, never a link or something unrelated.
  const exact = result.seen.filter((s) => s.item === s.want).length;
  assert.ok(exact >= Math.floor(result.seen.length * 0.85), `the planet itself (not a neighbour) is hit: ${exact}/${result.seen.length}`);
});

test('decoration in front hides the data behind it; unobstructed data still reads', async (t) => {
  if (!browser) return t.skip(skipReason);
  const golden = JSON.parse(fs.readFileSync(new URL('./golden/city.json', import.meta.url), 'utf8'));
  // Camera on +z looking at the origin. A decoration box (item -1) stands in front of a data box (item 0);
  // a second data box stands clear to one side.
  const graph = {
    ...golden,
    bounds: { min: [-8, -2, -4], max: [8, 2, 4] },
    camera: { position: [0, 0, 30], target: [0, 0, 0] },
    items: [{ id: 'i0', label: 'behind', group: 0, value: 1, display: '1' }, { id: 'i1', label: 'clear', group: 0, value: 2, display: '2' }],
    batches: [
      { id: 'front', shape: 'box', colour: 'cat1', emissive: null, flat: false, instances: [[0, 0, 2, 3, 3, 1, -1]] },
      { id: 'data', shape: 'box', colour: 'cat2', emissive: null, flat: false, instances: [[0, 0, -2, 2, 2, 2, 0], [6, 0, 0, 2, 2, 2, 1]] },
    ],
    tubes: [], surfaces: [], labels: [], anim: { sway: [], orbits: [] }, focus: {}, tour: [],
  };
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.setContent(`<!doctype html><style>${themeCss(loadTheme('dusk'))}</style><body></body>`);
  await page.addScriptTag({ content: fs.readFileSync(new URL('../template/vendor/scene-runtime.min.js', import.meta.url), 'utf8') });
  const result = await page.evaluate(async (g) => {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:0;top:0;width:800px;height:600px';
    host.innerHTML = '<div data-scene-canvas style="position:absolute;inset:0"></div><div data-scene-fallback></div>';
    document.body.append(host);
    const api = PAScene.mount(host, g, { reducedMotion: true });
    await new Promise((r) => setTimeout(r, 400));
    const rect = api.canvas.getBoundingClientRect();
    const at = (x, y, z) => { const p = api.project(x, y, z); return api.pickHit(rect.left + p.x, rect.top + p.y); };
    return { state: host.dataset.sceneState, hidden: at(0, 0, -2), front: at(0, 0, 2), clear: at(6, 0, 0) };
  }, graph);
  if (result.state !== 'ready') return t.skip('WebGL unavailable in this Chromium');
  assert.deepEqual(result.hidden, { item: -1, tube: -1 }, 'the data box behind the decoration is not hoverable through it');
  assert.deepEqual(result.front, { item: -1, tube: -1 }, 'the decoration itself has no tooltip');
  assert.deepEqual(result.clear, { item: 1, tube: -1 }, 'unobstructed data reads');
});

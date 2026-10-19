// Browser checks for the runtime fixes F10-F15 of the second review wave: zoom floor, hover tubes, tour dwell
// while hidden, focus after a button disables, an embedded scene that lets the page scroll, and a legend that
// scrolls instead of covering the view. Each skips only without Chromium or WebGL2; with WebGL2 the scene must mount.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from '../scripts/build.mjs';
import { BUNDLE_FILE } from '../scripts/lib/bundle.mjs';
import { loadTheme, themeCss } from '../shared/theme.mjs';
import { buildWorldPage, demoRows, launchBrowser } from './helpers/browser.mjs';
import { PINNED_ENV, tempDir } from './helpers/scene-fixtures.mjs';
import { consoleProblem, skipUnlessReady } from './helpers/webgl.mjs';

const FIX = new URL('./fixtures/', import.meta.url);
const GOLDEN = new URL('./golden/city.json', import.meta.url);
const FOV_HALF = Math.PI / 8; // the runtime's 45 degree vertical field of view, halved

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

// Opens a built page (test hook on); null (after skipping) without a browser or WebGL2. With WebGL2 the scene must be ready.
async function openFile(t, file, { viewport = { width: 1200, height: 800 }, ...contextOptions } = {}) {
  const context = await browser.newContext({ viewport, ...contextOptions });
  t.after(() => context.close());
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { const problem = consoleProblem(m); if (problem) problems.push(problem); });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(`${pathToFileURL(file).href}?test=1`);
  await page.waitForFunction(() => document.querySelector('[data-pa-scene]').dataset.sceneState !== 'loading', null, { timeout: 10000 });
  if (await skipUnlessReady(t, page, assert)) return null;
  return { page, problems };
}
async function openWorld(t, world, options = {}, buildOptions = {}) {
  if (!browser) return t.skip(skipReason) ?? null;
  const { file } = await buildWorldPage(t, world, buildOptions);
  return openFile(t, file, options);
}

// Distance from the camera to a world point at the centre of the view, read from the projection scale.
const DEPTH_FROM_SCALE = `(api, target) => {
  const p = api.project(target[0], target[1], target[2]);
  return (api.canvas.clientHeight / 2) / (Math.tan(${FOV_HALF}) * p.scale);
}`;

// ---- F10: the zoom floor never keeps a focus view from landing -------------------------------------------------------

test('F10: flyTo a building in a 12 x 160 city lands at its authored distance (zoom floor follows the scene)', async (t) => {
  const rows = [];
  for (let g = 0; g < 12; g++) for (let k = 0; k < 160; k++) rows.push({ group: `grp${g}`, t: k, value: 1 + ((g * 7 + k * 5) % 11) * 3, label: `g${g}t${k}` });
  const ctx = await openWorld(t, 'city', { reducedMotion: 'reduce' }, { rows });
  if (!ctx) return;
  const landed = await ctx.page.evaluate(`(() => {
    const graph = JSON.parse(document.querySelector('script[type="application/json"]').textContent);
    const view = graph.focus.g3t80;
    const authored = Math.hypot(...view.position.map((c, i) => c - view.target[i]));
    const api = window.PAScene.__scene;
    api.flyTo('g3t80', { instant: true });
    api.renderNow();
    return { authored, depth: (${DEPTH_FROM_SCALE})(api, view.target) };
  })()`);
  assert.ok(Math.abs(landed.depth - landed.authored) / landed.authored <= 0.05, `authored ${landed.authored.toFixed(2)}, landed ${landed.depth.toFixed(2)}`);
});

// ---- F11: the hover tube hugs the drawn tube -----------------------------------------------------------------------

function donutPage(t) {
  const dir = tempDir(t, 'scene-donut-');
  fs.mkdirSync(path.join(dir, 'data'));
  fs.writeFileSync(path.join(dir, 'data/shares.csv'), 'name,v\nA,40\nB,30\nC,20\nD,10\n');
  fs.writeFileSync(path.join(dir, 'd.json'), JSON.stringify({
    title: 'T',
    sources: { shares: { type: 'csv', path: 'data/shares.csv' } },
    queries: { q: 'SELECT name, v FROM shares ORDER BY 1' },
    charts: [{ id: 'share', title: 'Share', query: 'q', kind: 'donut', x: 'name', y: 'v' }],
  }));
  fs.writeFileSync(path.join(dir, 'scene.json'), JSON.stringify({ title: 'Donut', lift: { dashboard: 'd.json', chart: 'share' } }));
  return build(path.join(dir, 'scene.json'), { out: path.join(dir, 'page.html'), env: { ...PINNED_ENV, PA_OUTPUT_DIR: dir } })
    .then((built) => {
      assert.equal(built.ok, true, JSON.stringify(built.errors));
      return built.out;
    });
}

// What the pointer finds at a world point, in item / tube indices.
const PICK_AT = `(point) => {
  const api = window.PAScene.__scene;
  const at = api.project(point[0], point[1], point[2]);
  const rect = api.canvas.getBoundingClientRect();
  return api.pickHit(rect.left + at.x, rect.top + at.y);
}`;

test('F11: a donut reports nothing over its hole or beyond its ring, and still reports a point on the ring', async (t) => {
  if (!browser) return t.skip(skipReason);
  const ctx = await openFile(t, await donutPage(t), { reducedMotion: 'reduce' });
  if (!ctx) return;
  const hits = await ctx.page.evaluate(`(() => {
    const graph = JSON.parse(document.querySelector('script[type="application/json"]').textContent);
    // Points on the side of the ring the camera is on, so the ray to them crosses nothing else.
    const [cx, , cz] = graph.camera.position;
    const [tx, , tz] = graph.camera.target;
    const len = Math.hypot(cx - tx, cz - tz);
    const dir = [(cx - tx) / len, (cz - tz) / len];
    const at = (radius, y = 0.55) => [dir[0] * radius, y, dir[1] * radius];
    const pick = ${PICK_AT};
    // The first arc starts at 12 o'clock (-z) and runs clockwise: its middle, a quarter of the way round from the start, is a
    // point of item 0 whatever the camera does.
    const a0 = -Math.PI / 2 + (0.4 * Math.PI);
    const ring = [3.2 * Math.cos(a0), 0.55, 3.2 * Math.sin(a0)];
    return { hole: pick(at(1.5)), centre: pick(at(0.2)), outside5: pick(at(5)), outside6: pick(at(6)), ring: pick(ring) };
  })()`);
  assert.deepEqual(hits.hole, { item: -1, tube: -1 }, 'the hole');
  assert.deepEqual(hits.centre, { item: -1, tube: -1 }, 'the centre');
  assert.deepEqual(hits.outside5, { item: -1, tube: -1 }, 'radius 5');
  assert.deepEqual(hits.outside6, { item: -1, tube: -1 }, 'radius 6');
  assert.equal(hits.ring.item, 0, 'the visible ring reports its segment (A)');
});

test('F11: a thin galaxy link is still hit a little off its centre line', async (t) => {
  const ctx = await openWorld(t, 'galaxy', { reducedMotion: 'reduce' });
  if (!ctx) return;
  const hit = await ctx.page.evaluate(`(() => {
    const graph = JSON.parse(document.querySelector('script[type="application/json"]').textContent);
    const tube = graph.tubes[0];
    const mid = tube.points[Math.floor(tube.points.length / 2)];
    const pick = ${PICK_AT};
    return { radius: tube.radius, on: pick(mid), off: pick([mid[0], mid[1] + 0.15, mid[2]]) };
  })()`);
  assert.ok(hit.radius <= 0.1, `the demo link is thin (${hit.radius})`);
  assert.equal(hit.on.tube, 0, 'on the link');
  assert.equal(hit.off.tube, 0, '0.15 world units off the link: inside the old tolerance (4 x radius)');
});

// ---- the tour harness: a page with the bundle, a tall spacer, and a scene below the fold ----------------------------

const TOUR = Array.from({ length: 5 }, (_, i) => ({ title: `Beat ${i + 1}`, focus: ['api'], caption: '' }));
function tourHtml({ autoplay = false, spacer = 0, embedded = false } = {}) {
  const graph = { ...JSON.parse(fs.readFileSync(GOLDEN, 'utf8')), tour: TOUR };
  const bundle = fs.readFileSync(BUNDLE_FILE, 'utf8');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${themeCss(loadTheme('dusk'))}
    body{margin:0} #spacer{height:${spacer}px} #host{position:relative;width:640px;height:400px} #after{height:3000px}</style></head>
    <body><div id="spacer"></div><div id="host" data-pa-scene${autoplay ? ' data-autoplay' : ''}><div data-scene-fallback>table</div></div><div id="after"></div>
    <script>${bundle.replaceAll('</script', '<\\/script')}</script>
    <script>window.GRAPH=${JSON.stringify(graph)};window.API=PAScene.mountScene(document.getElementById('host'),GRAPH,{embedded:${embedded},reducedMotion:false});</script></body></html>`;
}
async function openHarness(t, options = {}, contextOptions = {}) {
  if (!browser) return t.skip(skipReason) ?? null;
  const context = await browser.newContext({ viewport: { width: 800, height: 600 }, ...contextOptions });
  t.after(() => context.close());
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { const problem = consoleProblem(m); if (problem) problems.push(problem); });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.setContent(tourHtml(options));
  await page.waitForTimeout(300);
  if (await skipUnlessReady(t, page, assert, '#host')) return null;
  return { page, problems };
}
const beatText = (page) => page.locator('.sc-cap-count').textContent();

// ---- F12: the dwell timer waits for the viewer -----------------------------------------------------------------------

test('F12: a playing tour holds its beat while the document is hidden and goes on after', async (t) => {
  const ctx = await openHarness(t);
  if (!ctx) return;
  const { page } = ctx;
  await page.evaluate(() => document.querySelector('canvas').focus());
  await page.keyboard.press('p');
  assert.equal(await beatText(page), '1 / 5');
  await page.keyboard.press(' ');
  const setHidden = (hidden) => page.evaluate((h) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
  await setHidden(true);
  await page.waitForTimeout(4600); // longer than a beat's 4 s dwell
  assert.equal(await beatText(page), '1 / 5', 'no beat passed while nobody could see the scene');
  await setHidden(false);
  await page.waitForFunction(() => document.querySelector('.sc-cap-count').textContent === '2 / 5', null, { timeout: 7000 });
});

test('F12: autoplay below the fold waits until the scene is first visible', async (t) => {
  const ctx = await openHarness(t, { autoplay: true, spacer: 2000 });
  if (!ctx) return;
  const { page } = ctx;
  await page.waitForTimeout(600);
  assert.equal(await page.locator('.sc-tour').isVisible(), false, 'the tour has not opened off screen');
  await page.evaluate(() => document.getElementById('host').scrollIntoView());
  await page.waitForFunction(() => document.querySelector('.sc-tour') && !document.querySelector('.sc-tour').hidden, null, { timeout: 4000 });
  assert.equal(await beatText(page), '1 / 5', 'it starts at the first beat when it comes into view');
});

// ---- F13: focus never drops to the page ------------------------------------------------------------------------------

const focused = (page) => page.evaluate(() => {
  const el = document.activeElement;
  if (el === document.body) return 'BODY';
  return el.tagName === 'CANVAS' ? 'CANVAS' : `${el.tagName}:${el.textContent}`;
});

test('F13: Next disabled at the last beat hands focus to Prev; Prev disabled at the first hands it to Next', async (t) => {
  const tour = TOUR.slice(0, 3).map((b, i) => ({ ...b, title: `B${i}` }));
  const ctx = await openWorld(t, 'city', { reducedMotion: 'reduce' }, { spec: { tour: tour.map(({ title, caption }) => ({ title, caption, focus: ['api'] })) } });
  if (!ctx) return;
  const { page } = ctx;
  await page.getByRole('button', { name: 'Tour' }).click();
  const next = page.locator('.sc-transport button', { hasText: /^Next$/ });
  const prev = page.locator('.sc-transport button', { hasText: /^Prev$/ });
  await next.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  assert.equal(await beatText(page), '3 / 3');
  assert.equal(await focused(page), 'BUTTON:Prev', 'Next went disabled: focus moved to Prev');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  assert.equal(await beatText(page), '1 / 3');
  assert.equal(await focused(page), 'BUTTON:Next', 'Prev went disabled: focus moved to Next');
  assert.equal(await prev.isDisabled(), true);
});

test('F13: closing the Tour or Explore returns focus to the button that opened it, or to the canvas', async (t) => {
  const ctx = await openWorld(t, 'city', { reducedMotion: 'reduce' }, { spec: { tour: [{ title: 'One', focus: ['api'], caption: 'a' }, { title: 'Two', focus: ['web'], caption: 'b' }] } });
  if (!ctx) return;
  const { page } = ctx;
  // Opened with the toolbar buttons: closing returns to them.
  await page.getByRole('button', { name: 'Tour' }).click();
  await page.getByRole('button', { name: 'Close' }).last().click();
  assert.equal(await focused(page), 'BUTTON:Tour', 'Tour Close -> Tour button');
  await page.getByRole('button', { name: 'Explore', exact: true }).click();
  await page.getByRole('button', { name: 'Close Explore (E)' }).click();
  assert.equal(await focused(page), 'BUTTON:Explore', 'Explore Close -> Explore button');
  // Opened from the canvas by key: closing returns to the canvas.
  await page.focus('canvas');
  await page.keyboard.press('e');
  await page.locator('.sc-explore button').first().focus();
  await page.getByRole('button', { name: 'Close Explore (E)' }).click();
  assert.equal(await focused(page), 'CANVAS', 'no opener button: the canvas');
});

// Tab until `label` has focus (the toolbar buttons are the first stops of the scene).
async function tabTo(page, label) {
  await page.focus('canvas');
  for (let i = 0; i < 12 && (await focused(page)) !== `BUTTON:${label}`; i++) await page.keyboard.press('Tab');
  assert.equal(await focused(page), `BUTTON:${label}`, `Tab reached ${label}`);
}

test('L11: a panel opened by the E key while a toolbar button has focus gives focus back to that button, not the canvas', async (t) => {
  const ctx = await openWorld(t, 'city', { reducedMotion: 'reduce' }, { spec: { tour: [{ title: 'One', focus: ['api'], caption: 'a' }, { title: 'Two', focus: ['web'], caption: 'b' }] } });
  if (!ctx) return;
  const { page } = ctx;
  // E with focus on Full screen, then Esc: focus stays on Full screen.
  await tabTo(page, 'Full screen');
  await page.keyboard.press('e');
  await page.keyboard.press('Escape');
  assert.equal(await focused(page), 'BUTTON:Full screen', 'E then Esc -> Full screen');
  // E, move into the panel, close it with its Close button: focus goes back to Full screen (the old code said the canvas).
  await tabTo(page, 'Full screen');
  await page.keyboard.press('e');
  await page.getByRole('button', { name: 'Close Explore (E)' }).focus();
  await page.keyboard.press('Escape');
  assert.equal(await focused(page), 'BUTTON:Full screen', 'E, into the panel, Esc -> Full screen');
  // P from Full screen opens the tour; its Close button gives focus back to Full screen.
  await tabTo(page, 'Full screen');
  await page.keyboard.press('p');
  await page.getByRole('button', { name: 'Close' }).last().focus();
  await page.keyboard.press('Enter');
  assert.equal(await focused(page), 'BUTTON:Full screen', 'P, Tour Close -> Full screen');
  // No toolbar button had focus: the canvas.
  await page.focus('canvas');
  await page.keyboard.press('p');
  await page.getByRole('button', { name: 'Close' }).last().focus();
  await page.keyboard.press('Enter');
  assert.equal(await focused(page), 'CANVAS', 'P from the canvas -> the canvas');
});

// ---- F14: an embedded scene lets the page scroll --------------------------------------------------------------------

test('F14: embedded, a wheel over the scene scrolls the page; the canvas lets the browser pan vertically', async (t) => {
  const ctx = await openHarness(t, { embedded: true, spacer: 100 });
  if (!ctx) return;
  const { page } = ctx;
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('canvas')).touchAction), 'pan-y pinch-zoom');
  await page.evaluate(() => window.scrollTo(0, 100));
  const box = await page.locator('canvas').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const before = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, 300);
  await page.waitForFunction((y) => window.scrollY > y, before, { timeout: 3000 });
});

test('F14: embedded, full screen takes the wheel for zoom; leaving it gives the wheel back to the page', async (t) => {
  const ctx = await openHarness(t, { embedded: true, spacer: 100 });
  if (!ctx) return;
  const { page } = ctx;
  const depth = () => page.evaluate(`(() => {
    const api = window.API;
    const target = GRAPH.camera.target;
    return (${DEPTH_FROM_SCALE})(api, target);
  })()`);
  await page.evaluate(() => window.scrollTo(0, 100));
  await page.evaluate(() => document.querySelector('canvas').focus());
  await page.keyboard.press('f');
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('canvas')).touchAction), 'none', 'full screen owns touch');
  const [w, h] = await page.evaluate(() => [innerWidth, innerHeight]);
  await page.mouse.move(w / 2, h / 2);
  const [scrollBefore, depthBefore] = [await page.evaluate(() => window.scrollY), await depth()];
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => window.scrollY), scrollBefore, 'the page did not scroll');
  assert.ok(await depth() < depthBefore * 0.95, 'the wheel zoomed in');
  await page.keyboard.press('f'); // toggles back
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('canvas')).touchAction), 'pan-y pinch-zoom');
});

test('F14: standalone (not embedded) keeps full capture: touch-action none and the wheel zooms', async (t) => {
  const ctx = await openHarness(t, { embedded: false, spacer: 100 });
  if (!ctx) return;
  const { page } = ctx;
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('canvas')).touchAction), 'none');
  await page.evaluate(() => window.scrollTo(0, 100));
  const box = await page.locator('canvas').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const depth = () => page.evaluate(`(() => (${DEPTH_FROM_SCALE})(window.API, GRAPH.camera.target))()`);
  const [scrollBefore, depthBefore] = [await page.evaluate(() => window.scrollY), await depth()];
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => window.scrollY), scrollBefore, 'the page did not scroll');
  assert.ok(await depth() < depthBefore * 0.95, 'the wheel zoomed in');
});

// ---- F15: the legend scrolls inside the host -------------------------------------------------------------------------

test('F15: 24 long group names at 320 x 568: the legend is at most 30% of the host and scrolls; Explore does not open over it', async (t) => {
  const rows = [];
  for (let g = 0; g < 24; g++) for (let w = 0; w < 3; w++) rows.push({ group: `plugins/portable-artifacts/skills/folder-${g}`, t: `2026-W${30 + w}`, value: 3 + ((g * 5 + w) % 7) });
  const ctx = await openWorld(t, 'city', { viewport: { width: 320, height: 568 }, reducedMotion: 'reduce' }, { rows });
  if (!ctx) return;
  const { page } = ctx;
  const m = await page.evaluate(() => {
    const host = document.querySelector('[data-pa-scene]').getBoundingClientRect();
    const legend = document.querySelector('.sc-legend');
    const box = legend.getBoundingClientRect();
    return { host: host.height, legend: box.height, scrolls: legend.scrollHeight > legend.clientHeight, legendTop: box.top };
  });
  assert.ok(m.legend / m.host <= 0.3, `legend ${Math.round(m.legend)} of host ${Math.round(m.host)} px (${(m.legend / m.host).toFixed(2)})`);
  assert.equal(m.scrolls, true, 'the legend scrolls');
  await page.getByRole('button', { name: 'Explore', exact: true }).click();
  const explore = await page.locator('.sc-explore').boundingBox();
  assert.ok(explore.y + explore.height <= m.legendTop + 1, `Explore ends at ${Math.round(explore.y + explore.height)}, the legend starts at ${Math.round(m.legendTop)}`);
});

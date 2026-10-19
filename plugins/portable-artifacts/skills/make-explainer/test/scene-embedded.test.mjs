// A scene inside an explainer must not capture page scrolling: the wheel over it scrolls the page, a vertical swipe on its
// canvas scrolls the page, and only full screen hands the wheel to the camera (the diagram figures behave the same way).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildSpec, haveBrowser, openPage, closeSharedBrowser } from './helpers/browser.mjs';

after(closeSharedBrowser);

const rows = [
  { group: 'api', t: '2026-W30', value: 12 }, { group: 'web', t: '2026-W30', value: 5 },
  { group: 'api', t: '2026-W31', value: 7 }, { group: 'web', t: '2026-W31', value: 9 },
];
const filler = (n) => ({ type: 'text', title: `Section ${n}`, text: 'Words that fill the viewport. '.repeat(60) });
const doc = () => ({
  title: 'Doc',
  sections: [filler(1), { type: 'scene', title: 'The city', scene: { title: 'Commits', world: 'city', data: { rows } } }, filler(2), filler(3)],
});

// Opens the page, scrolls the scene into the middle of the viewport and waits for it to mount; null (after skipping) without WebGL2.
async function openScene(t, options) {
  if (!(await haveBrowser())) return t.skip('no browser (bundled Chromium or system Chrome)') ?? null;
  const built = buildSpec(doc());
  const ctx = await openPage(built.url, options);
  t.after(() => ctx.context.close());
  await ctx.page.evaluate(() => document.querySelector('.sc-frame').scrollIntoView({ block: 'center' }));
  await ctx.page.waitForFunction(() => document.querySelector('.sc-frame [data-pa-scene]').dataset.sceneState !== undefined && document.querySelector('.sc-frame [data-pa-scene]').dataset.sceneState !== 'loading', null, { timeout: 10000 });
  const gl = await ctx.page.evaluate(() => document.createElement('canvas').getContext('webgl2') !== null);
  if (!gl) return t.skip('WebGL2 unavailable in this Chromium') ?? null;
  const state = await ctx.page.evaluate(() => document.querySelector('.sc-frame [data-pa-scene]').dataset.sceneState);
  assert.equal(state, 'ready', 'WebGL2 is available, so the scene must mount');
  return ctx;
}

test('F14: a wheel over an embedded scene scrolls the page, and its canvas lets the browser pan vertically', async (t) => {
  const ctx = await openScene(t);
  if (!ctx) return;
  const { page } = ctx;
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.sc-frame canvas')).touchAction), 'pan-y pinch-zoom');
  const box = await page.locator('.sc-frame canvas').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const before = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, 300);
  await page.waitForFunction((y) => window.scrollY > y + 50, before, { timeout: 3000 });
});

test('F14: in full screen an embedded scene takes the wheel for zoom and the page stays put', async (t) => {
  const ctx = await openScene(t);
  if (!ctx) return;
  const { page } = ctx;
  await page.focus('.sc-frame canvas');
  await page.keyboard.press('f');
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.sc-frame canvas')).touchAction), 'none');
  const [w, h] = await page.evaluate(() => [innerWidth, innerHeight]);
  await page.mouse.move(w / 2, h / 2);
  const before = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => window.scrollY), before, 'the page did not scroll');
  await page.keyboard.press('f');
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.sc-frame canvas')).touchAction), 'pan-y pinch-zoom', 'leaving full screen hands touch back to the page');
});

test('F15: in an explainer frame at 390 x 700 a 24-group legend takes at most 30% of the scene and scrolls', async (t) => {
  if (!(await haveBrowser())) return t.skip('no browser (bundled Chromium or system Chrome)');
  const many = [];
  for (let g = 0; g < 24; g++) for (let w = 0; w < 2; w++) many.push({ group: `plugins/portable-artifacts/skills/folder-${g}`, t: `2026-W${30 + w}`, value: 3 + ((g * 5 + w) % 7) });
  const spec = { title: 'Doc', sections: [{ type: 'scene', title: 'The city', scene: { title: 'Commits', world: 'city', data: { rows: many } } }] };
  const ctx = await openPage(buildSpec(spec).url, { width: 390, height: 700 });
  t.after(() => ctx.context.close());
  const { page } = ctx;
  await page.evaluate(() => document.querySelector('.sc-frame').scrollIntoView({ block: 'center' }));
  await page.waitForFunction(() => document.querySelector('.sc-frame [data-pa-scene]').dataset.sceneState !== undefined && document.querySelector('.sc-frame [data-pa-scene]').dataset.sceneState !== 'loading', null, { timeout: 10000 });
  if (!(await page.evaluate(() => document.createElement('canvas').getContext('webgl2') !== null))) return t.skip('WebGL2 unavailable in this Chromium');
  const m = await page.evaluate(() => {
    const host = document.querySelector('.sc-frame [data-pa-scene]').getBoundingClientRect();
    const legend = document.querySelector('.sc-frame .sc-legend');
    return { host: host.height, legend: legend.getBoundingClientRect().height, scrolls: legend.scrollHeight > legend.clientHeight };
  });
  assert.ok(m.legend / m.host <= 0.3, `legend ${Math.round(m.legend)} of host ${Math.round(m.host)} px`);
  assert.equal(m.scrolls, true);
});

// Smoke tests for the page chrome in a real page: tooltip, Explore, tour keys, text-only labels, PNG export.
// Skips itself without Chromium or WebGL (the full browser matrix is Task 9's).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../scripts/build.mjs';
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

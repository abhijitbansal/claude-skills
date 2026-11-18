// Labels in a real page: kept clear of the frame's edges, and a number centred on its point (a tick on its gridline).
// Skips itself without Chromium or WebGL2.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from '../scripts/build.mjs';
import { launchBrowser } from './helpers/browser.mjs';
import { PINNED_ENV, tempDir } from './helpers/scene-fixtures.mjs';
import { skipUnlessReady } from './helpers/webgl.mjs';

const EXAMPLES = new URL('../references/examples/', import.meta.url);
const EDGE_MARGIN = 16; // chrome/label-class.js EDGE_MARGIN: the clear space between a label's text and the frame
const TOLERANCE = 1.5; // px

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

// Builds one of the shipped examples in a temp copy of the examples folder and opens it; null (after skipping) without WebGL.
async function open(t, scene, viewport) {
  if (!browser) return t.skip(skipReason) ?? null;
  const dir = tempDir(t, 'scene-labels-');
  fs.cpSync(EXAMPLES, dir, { recursive: true });
  const built = await build(path.join(dir, scene), { out: path.join(dir, 'page.html'), env: { ...PINNED_ENV, PA_OUTPUT_DIR: dir } });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(`${pathToFileURL(built.out).href}?test=1`);
  await page.waitForFunction(() => document.querySelector('[data-pa-scene]').dataset.sceneState !== 'loading', null, { timeout: 10000 });
  if (await skipUnlessReady(t, page, assert)) return null;
  await page.waitForTimeout(300);
  return page;
}

for (const width of [260, 300, 340]) {
  test(`a label in the frame keeps its text at least 16 px from every edge, on a ${width} px screen`, async (t) => {
    const page = await open(t, 'forest.scene.json', { width, height: 800 });
    if (!page) return;
    const labels = await page.evaluate(() => [...document.querySelectorAll('.sc-label:not([hidden])')].map((el) => {
      const r = el.getBoundingClientRect();
      const pad = parseFloat(getComputedStyle(el).paddingLeft);
      return { text: el.textContent, left: r.left + pad, right: r.right - pad, frame: document.documentElement.clientWidth };
    }));
    assert.ok(labels.length > 0, 'the forest shows labels');
    for (const l of labels) {
      assert.ok(l.left >= EDGE_MARGIN - TOLERANCE, `${l.text}: its text starts ${l.left.toFixed(1)} px from the left edge`);
      assert.ok(l.frame - l.right >= EDGE_MARGIN - TOLERANCE, `${l.text}: its text ends ${(l.frame - l.right).toFixed(1)} px from the right edge`);
    }
  });
}

test('caps do not make the city rows hide each other on a phone: api, web and docs all show', async (t) => {
  const page = await open(t, 'city.scene.json', { width: 390, height: 800 });
  if (!page) return;
  const shown = await page.evaluate(() => [...document.querySelectorAll('.sc-label:not([hidden])')].map((el) => el.textContent));
  assert.deepEqual(shown, ['api', 'web', 'docs']);
});

test('the tick numbers of a lifted chart sit centred on their gridlines', async (t) => {
  const page = await open(t, 'lift-dashboard.scene.json', { width: 1280, height: 800 });
  if (!page) return;
  const ticks = await page.evaluate(() => {
    const graph = JSON.parse(document.querySelector('[data-pa-scene] script[type="application/json"]').textContent);
    const canvas = document.querySelector('canvas').getBoundingClientRect();
    const els = [...document.querySelectorAll('.sc-label')];
    return graph.labels.map((l, i) => ({ l, i })).filter(({ l }) => /^\d+$/.test(l.text)).map(({ l, i }) => {
      const p = window.PAScene.__scene.project(...l.at);
      const r = els[i].getBoundingClientRect();
      return { text: l.text, shown: !els[i].hidden, off: r.top + r.height / 2 - (canvas.top + p.y) };
    });
  });
  const shown = ticks.filter((tick) => tick.shown);
  assert.ok(shown.length >= 3, `the chart shows its ticks (${shown.length})`);
  for (const tick of shown) assert.ok(Math.abs(tick.off) <= TOLERANCE, `tick ${tick.text} is ${tick.off.toFixed(1)} px off its gridline`);
});

// TEMPORARY diagnostic (delete once the make-scene 2/2 timing question is settled). Not a *.test.mjs, so the job's test
// glob does not run it; test.yml runs it in its own step. It prints `frame-probe:` lines: how long the tour light takes
// (1.8 s of animation clock, at most 0.1 s per frame) and how many frames it gets, on the lifted story diagram with
// software WebGL like the tests, first with one browser, then with three at once (node's default test concurrency on a
// 4-CPU runner runs about three test files, each with its own browser).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from '../scripts/build.mjs';
import { launchBrowser } from '../scripts/lib/browser.mjs';
import { PINNED_ENV } from './helpers/scene-fixtures.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-frame-probe-'));
fs.copyFileSync(path.join(HERE, 'fixtures/story.diagram.json'), path.join(work, 'story.diagram.json'));
fs.writeFileSync(path.join(work, 'scene.json'), JSON.stringify({ title: 'Lifted', lift: { diagram: 'story.diagram.json' } }));
const built = await build(path.join(work, 'scene.json'), { out: path.join(work, 'page.html'), env: { ...PINNED_ENV, PA_OUTPUT_DIR: work } });
if (!built.ok) throw new Error(JSON.stringify(built.errors));

async function once(label) {
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' });
    const page = await context.newPage();
    const opened = Date.now();
    await page.goto(`${pathToFileURL(built.out).href}?test=1`);
    await page.waitForFunction(() => document.querySelector('[data-pa-scene]').dataset.sceneState !== 'loading', null, { timeout: 60000 });
    const openMs = Date.now() - opened;
    await page.evaluate(() => { window.__stamps = []; window.PAScene.__scene.onFrame(() => window.__stamps.push(performance.now())); });
    await page.waitForTimeout(1000);
    await page.evaluate(() => { window.__press = performance.now(); });
    await page.keyboard.press('p');
    await page.waitForFunction(() => window.PAScene.__scene.traveller()?.id === 'edge-0', null, { timeout: 60000 });
    const t0 = Date.now();
    await page.waitForFunction(() => window.PAScene.__scene.traveller().done === true, null, { timeout: 120000, polling: 100 });
    const lightMs = Date.now() - t0;
    const stats = await page.evaluate(() => {
      const s = window.__stamps.filter((t) => t >= window.__press);
      const gaps = s.slice(1).map((t, k) => t - s[k]);
      const sorted = [...gaps].sort((a, b) => a - b);
      return { frames: s.length, medianGapMs: Math.round(sorted[Math.floor(sorted.length / 2)] ?? 0), maxGapMs: Math.round(sorted.at(-1) ?? 0) };
    });
    // check.mjs gives a canvas element screenshot 5000 ms (ACTION_MS); time three of them, the first after a style change
    const shots = [];
    for (let k = 0; k < 3; k++) {
      const s0 = Date.now();
      await page.locator('canvas').first().screenshot({ timeout: 60000 });
      shots.push(Date.now() - s0);
    }
    console.log(`frame-probe: ${label} ${JSON.stringify({ openMs, lightMs, ...stats, screenshotMs: shots })}`);
  } finally {
    await browser.close();
  }
}

console.log(`frame-probe: machine ${JSON.stringify({ cpus: os.cpus().length, parallelism: os.availableParallelism(), loadavg: os.loadavg().map((v) => Math.round(v * 100) / 100), platform: process.platform })}`);
for (let i = 1; i <= 3; i++) await once(`alone-${i}`);
if (process.env.PROBE_ALONE_ONLY !== '1') for (let i = 1; i <= 2; i++) await Promise.all([1, 2, 3].map((k) => once(`x3-${i}.${k}`)));
console.log(`frame-probe: after ${JSON.stringify({ loadavg: os.loadavg().map((v) => Math.round(v * 100) / 100) })}`);

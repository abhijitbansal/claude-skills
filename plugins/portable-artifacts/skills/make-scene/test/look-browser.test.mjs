// The rim in a dark scene is an outline of the silhouette, never of every edge: seen in a real page, the edge between two faces the
// camera sees (and the one a bar stands on) carries no rim colour, and the edges that make the outline do. Skips itself without
// Chromium or WebGL2.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from '../scripts/build.mjs';
import { launchBrowser, canvasPng } from './helpers/browser.mjs';
import { PINNED_ENV, tempDir } from './helpers/scene-fixtures.mjs';
import { skipUnlessReady } from './helpers/webgl.mjs';

const EXAMPLES = new URL('../references/examples/', import.meta.url);
const REACH = 3; // px around an edge that are looked at

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

async function openDark(t, scene) {
  if (!browser) return t.skip(skipReason) ?? null;
  const dir = tempDir(t, 'scene-look-');
  fs.cpSync(EXAMPLES, dir, { recursive: true });
  const built = await build(path.join(dir, scene), { out: path.join(dir, 'page.html'), env: { ...PINNED_ENV, PA_OUTPUT_DIR: dir } });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark', reducedMotion: 'reduce' });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(`${pathToFileURL(built.out).href}?test=1`);
  await page.waitForFunction(() => document.querySelector('[data-pa-scene]').dataset.sceneState !== 'loading', null, { timeout: 10000 });
  if (await skipUnlessReady(t, page, assert)) return null;
  await page.waitForTimeout(400);
  return page;
}

// The rim colour of the dark "dim" set is a cool blue and the first bar of the dashboard is orange: a pixel that is bright and clearly blue is rim.
const isRim = ([r, g, b]) => b >= 150 && b > r + 20;

test('the bars of a dark dashboard carry the rim on their silhouette only: none on the edge between two faces the camera sees, nor at the foot', async (t) => {
  const page = await openDark(t, 'lift-dashboard.scene.json');
  if (!page) return;
  const { bar, points, canvasWidth } = await page.evaluate(() => {
    const graph = JSON.parse(document.querySelector('[data-pa-scene] script[type="application/json"]').textContent);
    const [x, y, z, sx, sy, sz] = graph.batches[0].instances[0];
    const at = (px, py, pz) => window.PAScene.__scene.project(px, py, pz);
    return {
      bar: [x, y, z, sx, sy, sz],
      canvasWidth: document.querySelector('canvas').getBoundingClientRect().width,
      points: {
        topFront: at(x, y + sy / 2, z + sz / 2), // the top face meets the front wall: the camera sees both
        topRight: at(x + sx / 2, y + sy / 2, z), // the top face meets the right wall: both seen
        foot: at(x, y - sy / 2, z + sz / 2), // the front wall meets the floor
        topBack: at(x, y + sy / 2, z - sz / 2), // the top face meets the back wall: turned away, so the outline
        left: at(x - sx / 2, y, z + sz / 2), // the front wall meets the left wall: turned away, so the outline
      },
    };
  });
  assert.equal(bar.length, 6);
  const png = await canvasPng(page);
  const scale = png.width / canvasWidth;
  const rimPixels = (p) => {
    let n = 0;
    for (let dy = -REACH; dy <= REACH; dy++) {
      for (let dx = -REACH; dx <= REACH; dx++) {
        const x = Math.round(p.x * scale) + dx;
        const y = Math.round(p.y * scale) + dy;
        if (x >= 0 && y >= 0 && x < png.width && y < png.height && isRim(png.pixel(x, y))) n++;
      }
    }
    return n;
  };
  const seen = Object.fromEntries(Object.entries(points).map(([name, p]) => [name, rimPixels(p)]));
  assert.ok(seen.topBack >= 4, `the far edge of the top is outlined (${seen.topBack} rim pixels)`);
  assert.ok(seen.left >= 4, `the left edge of the front wall is outlined (${seen.left} rim pixels)`);
  assert.equal(seen.topFront, 0, 'the edge between the top and the front wall is not');
  assert.equal(seen.topRight, 0, 'nor the edge between the top and the right wall');
  assert.equal(seen.foot, 0, 'nor the foot of the bar');
});

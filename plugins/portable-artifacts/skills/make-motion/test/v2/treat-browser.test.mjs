// The photo treatments in the page (engine/page/treat.mjs through draw.mjs): a treated image node draws its duotone or
// halftone bitmap, sampled at known pixels. Run with --test-concurrency=1; skips without a browser.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sessionOrNull } from './helpers/session.mjs';
import { pngOf } from './helpers/png.mjs';

let specDir;
before(() => {
  specDir = mkdtempSync(path.join(tmpdir(), 'mm-v2-treat-'));
  writeFileSync(path.join(specDir, 'halves.png'), pngOf(200, 100, (x) => (x < 100 ? [0, 0, 0] : [255, 255, 255])));
  writeFileSync(path.join(specDir, 'grey.png'), pngOf(200, 100, () => [128, 128, 128]));
});
after(() => rmSync(specDir, { recursive: true, force: true }));

const filmOf = (src, treatment) => ({
  version: 2, mode: 'pro', look: 'desk', format: '16:9', fps: 30, seed: 1,
  shots: [{ id: 'p', show: 'free', hold: 1, background: '#808080', srcs: [src], nodes: [{ type: 'image', id: 'pic', props: { src, x: 100, y: 100, w: 200, h: 100, treatment } }] }],
});

async function pixelsOf(t, film, points) {
  const session = await sessionOrNull(film, { specDir });
  if (!session) { t.skip('no browser'); return null; }
  t.after(() => session.close());
  await session.page.evaluate(() => window.__seek(0));
  assert.deepEqual(session.errors, []);
  return Promise.all(points.map(([x, y]) => session.page.evaluate(([px, py]) => Array.from(window.__source.getContext('2d').getImageData(px, py, 1, 1).data).slice(0, 3), [x, y])));
}

const close = (actual, expected, msg) => assert.ok(actual.every((v, i) => Math.abs(v - expected[i]) <= 2), `${msg}: ${actual} vs ${expected}`);

test('duotone: the black half takes the dark colour and the white half the light one', async (t) => {
  const got = await pixelsOf(t, filmOf('halves.png', { type: 'duotone', dark: '#15130f', light: '#ffe14a' }), [[150, 150], [250, 150]]);
  if (!got) return;
  close(got[0], [0x15, 0x13, 0x0f], 'dark half');
  close(got[1], [0xff, 0xe1, 0x4a], 'light half');
});

test('halftone: grey 128 at cell 20 is a dot of the dark colour in each cell centre, the light colour at its corners', async (t) => {
  // r = 10 * sqrt(2) * sqrt(1 - 128/255) = 9.98 px: a cell centre is inside, a corner 13.4 px out is not
  const got = await pixelsOf(t, filmOf('grey.png', { type: 'halftone', dark: '#111111', light: '#ffffff', cell: 20 }), [[110, 110], [101, 101], [150, 150]]);
  if (!got) return;
  close(got[0], [0x11, 0x11, 0x11], 'a cell centre');
  close(got[1], [0xff, 0xff, 0xff], 'a cell corner');
  close(got[2], [0x11, 0x11, 0x11], 'another cell centre');
});

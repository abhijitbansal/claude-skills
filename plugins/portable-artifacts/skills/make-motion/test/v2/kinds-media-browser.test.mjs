// The media kind in the page: a captioned photo reviews clean (the rendered-pixel contrast check included) in both
// looks and formats, and a still bleed shot with no caption still changes between frames (its push). Run with
// --test-concurrency=1; skips without a browser.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { reviewFilm } from '../../scripts/v2/review.mjs';
import { sessionOrNull } from './helpers/session.mjs';
import { pngOf } from './helpers/png.mjs';

let specDir;
before(() => {
  specDir = mkdtempSync(path.join(tmpdir(), 'mm-v2-media-browser-'));
  // a photo-like picture: a dark sky over a light sea, with a soft gradient
  writeFileSync(path.join(specDir, 'photo.png'), pngOf(320, 200, (x, y) => (y < 90 ? [30 + x / 4, 40, 70] : [180 + y / 4, 200, 210 - x / 8])));
});
after(() => rmSync(specDir, { recursive: true, force: true }));

async function open(t, film) {
  const session = await sessionOrNull(film, { specDir });
  if (!session) { t.skip('no browser'); return null; }
  t.after(() => session.close());
  return session;
}

const COMBOS = [['pro', 'desk', '16:9'], ['pro', 'desk', '9:16'], ['viral', 'pop', '16:9'], ['viral', 'pop', '9:16']];
// no credit: whether the credit fits (the caption three times it) depends on the look and format, and when it does not
// the review rightly says so (kinds-media.test.mjs covers both cases)
const SHOT = { id: 'm', show: 'media', src: 'photo.png', say: 'Every morning the boats bring in the catch.', caption: 'The morning catch' };

for (const [mode, look, format] of COMBOS) {
  for (const fit of ['bleed', 'cutout']) {
    test(`a captioned ${fit} photo in ${look} at ${format} has no review finding`, async (t) => {
      const session = await open(t, { version: 2, mode, look, format, fps: 30, seed: 3, shots: [{ ...SHOT, fit }] });
      if (!session) return;
      const findings = await reviewFilm({ session });
      assert.deepEqual(findings.map((f) => `${f.kind}: ${f.path}: ${f.message}`), []);
      assert.deepEqual(session.errors, []);
    });
  }
}

test('a still bleed shot with no caption still changes between frames in pop, whose camera is locked', async (t) => {
  const session = await open(t, { version: 2, mode: 'viral', look: 'pop', format: '9:16', fps: 30, seed: 3, shots: [{ id: 'm', show: 'media', src: 'photo.png', hold: 3 }] });
  if (!session) return;
  const held = await session.page.evaluate((n) => window.__heldFlags(1, n - 1, false), session.info.frameCount);
  assert.ok(held.some((same) => !same), 'some frame differs from the one before it');
  assert.deepEqual(session.errors, []);
});

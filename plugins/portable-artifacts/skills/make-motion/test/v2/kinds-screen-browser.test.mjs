// The screen kind in the page: its url is display text the page never requests (the session blocks and records any
// request off the loopback server), and a framed screen with title, url, regions and a zoom reviews clean in both looks
// and formats. Run with --test-concurrency=1; skips without a browser.
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
  specDir = mkdtempSync(path.join(tmpdir(), 'mm-v2-screen-browser-'));
  // a page-like screenshot: a light page with a dark header band and a few grey rows
  writeFileSync(path.join(specDir, 'page.png'), pngOf(480, 300, (x, y) => (y < 40 ? [30, 40, 60] : (y % 40 < 20 && x > 30 && x < 450 ? [200, 205, 215] : [245, 246, 248]))));
});
after(() => rmSync(specDir, { recursive: true, force: true }));

async function open(t, film) {
  const session = await sessionOrNull(film, { specDir });
  if (!session) { t.skip('no browser'); return null; }
  t.after(() => session.close());
  return session;
}

const SHOT = {
  id: 's', show: 'screen', src: 'page.png', say: 'This is the weekly report. The total sits at the bottom of the page.',
  title: 'Weekly report', url: 'example.com/report', regions: { total: [0.1, 0.6, 0.6, 0.25] }, zoom: 'total',
};

test('the url is drawn, never requested: the page asks nothing of anything but the film own server', async (t) => {
  const session = await open(t, { version: 2, mode: 'pro', look: 'desk', format: '16:9', fps: 30, seed: 3, shots: [{ ...SHOT, url: 'https://example.com/report' }] });
  if (!session) return;
  await session.page.evaluate(() => window.__seek(0));
  assert.deepEqual(session.blocked, []);
  assert.deepEqual(session.errors, []);
});

for (const [mode, look, format] of [['pro', 'desk', '16:9'], ['pro', 'desk', '9:16'], ['viral', 'pop', '16:9'], ['viral', 'pop', '9:16']]) {
  test(`a framed screen with a zoom in ${look} at ${format} has no review finding`, async (t) => {
    const session = await open(t, { version: 2, mode, look, format, fps: 30, seed: 3, shots: [SHOT] });
    if (!session) return;
    const findings = await reviewFilm({ session });
    assert.deepEqual(findings.map((f) => `${f.kind}: ${f.path}: ${f.message}`), []);
    assert.deepEqual(session.errors, []);
  });
}

// EXPERIMENTAL LOOK: the parked `cosmos` look (look.experimental since gate review 3) against the review rules. Every
// example `--list kinds` prints, in pro 16:9 and viral 9:16, reviewed at the sheet moments, comes back with no finding,
// so the parked code does not rot while it is left out of the shipped set (review-browser.test.mjs covers desk and
// pop). A kind that left out a secondary line to keep cosmos's minimum size says so (rule 'dropped'): that is the kind
// working as designed, not a defect, and is not counted. Run with --test-concurrency=1; skips without a browser.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listEntries } from '../../scripts/v2/list.mjs';
import { reviewFilm } from '../../scripts/v2/review.mjs';
import { sessionOrNull } from './helpers/session.mjs';

const FPS = 30;
const COMBOS = Object.freeze([
  { mode: 'pro', format: '16:9' },
  { mode: 'viral', format: '9:16' },
]);

// A striped PNG, built by hand so a browser can decode it: a stand-in screenshot.
function stripedPng(w, h) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = Array.from({ length: h }, (_, y) => Buffer.concat([Buffer.from([0]), ...Array.from({ length: w }, () => Buffer.from(Math.floor(y / 10) % 2 ? [40, 90, 200] : [235, 240, 245]))]));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

let specDir;
before(() => {
  specDir = mkdtempSync(path.join(tmpdir(), 'mm-v2-cosmos-examples-'));
  mkdirSync(path.join(specDir, 'assets'));
  writeFileSync(path.join(specDir, 'assets', 'screenshot.png'), stripedPng(640, 400));
});
after(() => rmSync(specDir, { recursive: true, force: true }));

for (const { mode, format } of COMBOS) {
  for (const entry of listEntries('kinds')) {
    test(`experimental look cosmos: the ${entry.name} example at ${format} has no review finding`, async (t) => {
      const film = { version: 2, mode, look: 'cosmos', format, fps: FPS, seed: 3, shots: [entry.example] };
      const session = await sessionOrNull(film, { specDir });
      if (!session) { t.skip('no browser'); return; }
      t.after(() => session.close());
      const findings = await reviewFilm({ session });
      const kept = findings.filter((f) => f.rule !== 'dropped');
      assert.deepEqual(kept.map((f) => `${f.kind}: ${f.message}`), []);
      assert.deepEqual(session.errors, []);
    });
  }
}

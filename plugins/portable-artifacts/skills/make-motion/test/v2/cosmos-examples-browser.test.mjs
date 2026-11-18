// The `cosmos` look (listed again after the final gate review) against the review rules. Every example `--list kinds`
// prints for a kind cosmos ships, in pro 16:9 and viral 9:16, reviewed at the sheet moments, comes back with exactly the
// findings named in KNOWN (none for most) (review-browser.test.mjs covers desk and pop). No rule is filtered out. Run
// with --test-concurrency=1; skips without a browser.
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
// The findings cosmos gives on a kind's example, by "<kind> <format>", as "<kind> <rule> <path>": the example is shared
// with desk and pop, so its copy stays; what cosmos cannot show is said.
// - list: cosmos sets no list slug and marks items with a dot rail, so the example's title and its steps numbering are
//   not drawn (review C C1: said, never silent);
// (end and quote at 9:16 were listed here for a dropped ask and attribution; the band's foot at 0.84 and the end's
// titleHeightTall hold both, so they now come back with none)
const KNOWN = Object.freeze({
  'list 16:9': ['creative kind shots[0].title', 'creative kind shots[0].style'],
  'list 9:16': ['creative kind shots[0].title', 'creative kind shots[0].style'],
});
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
  const rows = Array.from({ length: h }, (_, y) => Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3).fill(Buffer.from(Math.floor(y / 10) % 2 ? [40, 90, 200] : [235, 240, 245]))]));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

let specDir;
before(() => {
  specDir = mkdtempSync(path.join(tmpdir(), 'mm-v2-cosmos-examples-'));
  mkdirSync(path.join(specDir, 'assets'));
  writeFileSync(path.join(specDir, 'assets', 'screenshot.png'), stripedPng(1600, 1000)); // wide enough for the screen kind's whole zoom (a 640 px picture gives the resolution finding)
});
after(() => rmSync(specDir, { recursive: true, force: true }));

// each kind only in the looks that ship it (its listing's `looks`): cosmos has no data for the second-wave kinds, which
// it refuses at validation naming the looks that support them (cosmos-look.test.mjs)
for (const { mode, format } of COMBOS) {
  for (const entry of listEntries('kinds').filter((e) => e.looks.includes('cosmos'))) {
    test(`look cosmos: the ${entry.name} example at ${format} has only its known findings`, async (t) => {
      const film = { version: 2, mode, look: 'cosmos', format, fps: FPS, seed: 3, shots: [entry.example] };
      const session = await sessionOrNull(film, { specDir });
      if (!session) { t.skip('no browser'); return; }
      t.after(() => session.close());
      const findings = await reviewFilm({ session });
      // every finding counts (review C I2: the sweep no longer filters any rule out); the ones this parked look is known
      // to give are asserted by name
      const named = findings.map((f) => `${f.kind} ${f.rule} ${f.path}`);
      assert.deepEqual(named, KNOWN[`${entry.name} ${format}`] ?? [], findings.map((f) => f.message).join('\n'));
      assert.deepEqual(session.errors, []);
    });
  }
}

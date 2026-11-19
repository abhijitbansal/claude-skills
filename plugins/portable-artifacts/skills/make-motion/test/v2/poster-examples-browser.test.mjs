// The examples sweep for `poster` (looks-four plan, Task 7): every kind poster ships, its registry example as a one-shot
// film rendered in the browser at 16:9 in pro, at 9:16 in pro and at 9:16 in viral, reviewed by the real frame review
// (real glyphs: the rules poster-kinds.test.mjs leaves to this file) with no finding and no page error.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import { supportsKind, isParkedKind } from '../../engine/looks/index.mjs';
import { listEntries } from '../../scripts/v2/list.mjs';
import { reviewFilm } from '../../scripts/v2/review.mjs';
import { sessionOrNull } from './helpers/session.mjs';

process.env.MM_DEBUG_SAFE ??= '1'; // TEMPORARY: engine/review/frame.mjs prints the ink and the safe area of a text outside it
const FPS = 30;
const CASES = Object.freeze([['16:9', 'pro'], ['9:16', 'pro'], ['9:16', 'viral']]);
const look = registries.looks.get('poster');
const SHIPPED = registries.kinds.names().filter((kind) => supportsKind(look, kind) && !isParkedKind(look, kind));
const exampleOf = (kind) => listEntries('kinds').find((e) => e.name === kind)?.example ?? registries.kinds.get(kind).example;
const STRIPE = 10; // px

// A striped PNG of w x h: a stand-in screenshot.
function stripedPng(w, h) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = Array.from({ length: h }, (_, y) => Buffer.concat([Buffer.from([0]), ...Array.from({ length: w }, () => Buffer.from(Math.floor(y / STRIPE) % 2 ? [40, 90, 200] : [235, 240, 245]))]));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

let specDir;
before(() => {
  specDir = mkdtempSync(path.join(tmpdir(), 'mm-v2-poster-examples-'));
  mkdirSync(path.join(specDir, 'assets'));
  writeFileSync(path.join(specDir, 'assets', 'screenshot.png'), stripedPng(1600, 1000));
});
after(() => rmSync(specDir, { recursive: true, force: true }));

test('the sweep covers every kind poster ships', () => {
  assert.deepEqual(SHIPPED, registries.kinds.names().filter((kind) => !isParkedKind(look, kind)));
});

for (const [format, mode] of CASES) {
  for (const kind of SHIPPED) {
    test(`look poster: the ${kind} example at ${format} in ${mode} has no finding`, async (t) => {
      const film = { version: 2, mode, look: 'poster', format, fps: FPS, seed: 3, shots: [exampleOf(kind)] };
      const session = await sessionOrNull(film, { specDir });
      if (!session) { t.skip('no browser'); return; }
      t.after(() => session.close());
      const findings = await reviewFilm({ session });
      assert.deepEqual(findings.map((f) => `${f.kind} ${f.rule} ${f.path}`), [], findings.map((f) => f.message).join('\n'));
      assert.deepEqual(session.errors, []);
    });
  }
}

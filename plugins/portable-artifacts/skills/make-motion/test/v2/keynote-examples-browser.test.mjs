// The `keynote` look (experimental) against the review rules in the page: every kind's example (as --list kinds prints
// it) that keynote ships unparked, in pro at 16:9 and 9:16, reviewed at the sheet moments, comes back with no finding and
// no page error. The kinds come from the registry, not from a listing: a hidden look is in none, so a sweep built on
// listEntries(...).looks would test nothing (the count is asserted). Run with --test-concurrency=1; skips without a
// browser.
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

const FPS = 30;
const FORMATS = Object.freeze(['16:9', '9:16']);
const look = registries.looks.get('keynote');
const SHIPPED = registries.kinds.names().filter((kind) => supportsKind(look, kind) && !isParkedKind(look, kind));
const exampleOf = (kind) => listEntries('kinds').find((e) => e.name === kind)?.example ?? registries.kinds.get(kind).example;

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
  specDir = mkdtempSync(path.join(tmpdir(), 'mm-v2-keynote-examples-'));
  mkdirSync(path.join(specDir, 'assets'));
  // as wide as the node helper's shot.png: the screen kind's zoom asks for a picture at least 1560 px wide at 9:16
  writeFileSync(path.join(specDir, 'assets', 'screenshot.png'), stripedPng(1600, 1000));
});
after(() => rmSync(specDir, { recursive: true, force: true }));

test('the sweep covers every kind keynote ships: sixteen less the two it parks (number, clipping; screen un-parked by n2)', () => {
  assert.equal(SHIPPED.length, 14);
  assert.deepEqual(registries.kinds.names().filter((kind) => isParkedKind(look, kind)).sort(), ['clipping', 'number']);
});

for (const format of FORMATS) {
  for (const kind of SHIPPED) {
    test(`look keynote: the ${kind} example at ${format} has no finding`, async (t) => {
      const film = { version: 2, mode: 'pro', look: 'keynote', format, fps: FPS, seed: 3, shots: [exampleOf(kind)] };
      const session = await sessionOrNull(film, { specDir });
      if (!session) { t.skip('no browser'); return; }
      t.after(() => session.close());
      const findings = await reviewFilm({ session });
      assert.deepEqual(findings.map((f) => `${f.kind} ${f.rule} ${f.path}`), [], findings.map((f) => f.message).join('\n'));
      assert.deepEqual(session.errors, []);
    });
  }
}

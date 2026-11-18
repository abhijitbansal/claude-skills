// The `marker` look, third pass (m3), with real glyphs in the page: what the node tests cannot judge because the fake text
// measure sets Caveat wider than the page does. Needs a browser (skips without one); run with --test-concurrency=1.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { sessionOrNull } from './helpers/session.mjs';

// A striped PNG built by hand so a browser can decode it: the stand-in screenshot of the examples that name one.
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
  specDir = mkdtempSync(path.join(tmpdir(), 'mm-v2-marker-m3-'));
  mkdirSync(path.join(specDir, 'assets'));
  writeFileSync(path.join(specDir, 'assets', 'screenshot.png'), stripedPng(1600, 1000));
});
after(() => rmSync(specDir, { recursive: true, force: true }));

const FPS = 30;
const look = registries.looks.get('marker');
const flat = (nodes) => nodes.flatMap((n) => [n, ...flat(n.children ?? [])]);
const filmOf = (kind, format) => ({ version: 2, mode: 'pro', look: 'marker', format, fps: FPS, seed: 3, shots: [registries.kinds.get(kind).example] });

async function settled(t, kind, format) {
  const film = filmOf(kind, format);
  const session = await sessionOrNull(film, { specDir });
  if (!session) { t.skip('no browser'); return null; }
  t.after(() => session.close());
  const last = buildTimeline(film, { fps: FPS }).frameCount - 1;
  return { session, tree: flat(await session.page.evaluate((i) => window.__snapshot(i), last)), canvas: format === '16:9' ? { w: 1920, h: 1080 } : { w: 1080, h: 1920 } };
}

test('marker map at 16:9 with real glyphs: the title is one line across the top and the map takes over half the width', async (t) => {
  const open = await settled(t, 'map', '16:9');
  if (!open) return;
  const title = open.tree.find((n) => n.id === 'reach.title');
  const sheet = open.tree.find((n) => n.id === 'reach.map');
  assert.equal(title.layout.lines.length, 1, 'the title is one line');
  const [tx, ty, tw, th] = [title.x + title.layout.lines[0].x, title.y, title.layout.width, title.layout.height];
  const margin = look.grid.margin;
  assert.ok(tx >= margin && tx + tw <= open.canvas.w - margin, 'the title is inside the margins');
  assert.ok(ty >= margin - 1, 'under the top margin');
  assert.ok(sheet.bbox[2] >= 0.5 * open.canvas.w, `the map is ${Math.round((100 * sheet.bbox[2]) / open.canvas.w)} percent of the width`);
  assert.ok(ty + th <= sheet.bbox[1], 'the title ends above the map');
  assert.deepEqual(open.session.errors, []);
});

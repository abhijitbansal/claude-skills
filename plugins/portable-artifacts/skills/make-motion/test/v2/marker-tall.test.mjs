// The `marker` look on a tall frame with real glyphs (looks-four Task 13, m2, ban 2): every kind marker ships, its example
// at 9:16 in pro, settles on a board that fills the frame (at least 65 percent of the height from the first thing drawn to
// the last, under a third empty above and under a quarter below, no empty band over 35 percent; the hand, the field and the
// frame furniture are not content), and on frame 0 the hand rests clear of every finished text. Needs a browser (skips
// without one); run with --test-concurrency=1. The node helpers measure text with a stand-in, which sets this look's
// handwriting far smaller than Caveat, so the fill is judged in the page.
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
import { buildTimeline } from '../../engine/script/timing.mjs';
import { handOutline } from '../../engine/hand/shape.mjs';
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
  specDir = mkdtempSync(path.join(tmpdir(), 'mm-v2-marker-tall-'));
  mkdirSync(path.join(specDir, 'assets'));
  writeFileSync(path.join(specDir, 'assets', 'screenshot.png'), stripedPng(1600, 1000));
});
after(() => rmSync(specDir, { recursive: true, force: true }));

const FPS = 30;
const CANVAS = { w: 1080, h: 1920 };
const MIN_USE = 0.65;
const MAX_EMPTY = 0.35;
const MAX_TOP_EMPTY = 0.3; // under a third of the board is empty above the first thing drawn
const MAX_BOTTOM_EMPTY = 0.22; // and under a quarter below the last
const GROUND = 0.6; // a path covering this share of the canvas is a ground, not content
const FURNITURE = /\.(slug|kicker)\b/;
const INK_UP = 0.74, INK_DOWN = 0.22;
const look = registries.looks.get('marker');
const SHIPPED = registries.kinds.names().filter((kind) => supportsKind(look, kind) && !isParkedKind(look, kind) && kind !== 'free');
const exampleOf = (kind) => listEntries('kinds').find((e) => e.name === kind)?.example ?? registries.kinds.get(kind).example;
const filmOf = (kind) => ({ version: 2, mode: 'pro', look: 'marker', format: '9:16', fps: FPS, seed: 3, shots: [exampleOf(kind)] });

// The content leaves of a snapshot with their boxes: drawn, not the hand, the field, a ground or the frame furniture.
function contentBoxes(tree) {
  const out = [];
  const walk = (n, alpha) => {
    const a = alpha * (n.opacity ?? 1);
    if (a <= 0 || n.type === 'field' || n.props?.role === 'hand' || n.props?.caption !== undefined || FURNITURE.test(n.id ?? '')) return;
    const [, , w, h] = n.bbox ?? [0, 0, 0, 0];
    const ground = n.type === 'path' && w * h >= GROUND * CANVAS.w * CANVAS.h;
    if ((n.children ?? []).length === 0 && w * h > 0 && !ground) out.push(n.bbox);
    (n.children ?? []).forEach((c) => walk(c, a));
  };
  tree.forEach((n) => walk(n, 1));
  return out;
}

function largestGap(boxes, top, bottom) {
  const spans = boxes.map((b) => [Math.max(top, b[1]), Math.min(bottom, b[1] + b[3])]).filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  let reach = top, gap = 0;
  for (const [a, b] of spans) {
    gap = Math.max(gap, a - reach);
    reach = Math.max(reach, b);
  }
  return Math.max(gap, bottom - reach);
}

async function opened(t, kind) {
  const film = filmOf(kind);
  const session = await sessionOrNull(film, { specDir });
  if (!session) { t.skip('no browser'); return null; }
  t.after(() => session.close());
  return { session, last: buildTimeline(film, { fps: FPS }).frameCount - 1 };
}

const pct = (v) => `${(100 * v).toFixed(0)}%`;

for (const kind of SHIPPED) {
  test(`marker ${kind} at 9:16 with real glyphs: the finished board fills the frame`, async (t) => {
    const open = await opened(t, kind);
    if (!open) return;
    const margin = look.gridTall.margin;
    const [top, bottom] = [margin, CANVAS.h - margin];
    const boxes = contentBoxes(await open.session.page.evaluate((i) => window.__snapshot(i), open.last));
    assert.ok(boxes.length > 0, 'content on the settled frame');
    const first = Math.max(top, Math.min(...boxes.map((b) => b[1]))), last = Math.min(bottom, Math.max(...boxes.map((b) => b[1] + b[3])));
    const height = bottom - top;
    assert.ok((last - first) / height >= MIN_USE, `${pct((last - first) / height)} of the height used (at least ${pct(MIN_USE)})`);
    assert.ok((first - top) / height <= MAX_TOP_EMPTY, `the top ${pct((first - top) / height)} of the board is empty (at most ${pct(MAX_TOP_EMPTY)})`);
    assert.ok((bottom - last) / height <= MAX_BOTTOM_EMPTY, `the bottom ${pct((bottom - last) / height)} of the board is empty (at most ${pct(MAX_BOTTOM_EMPTY)})`);
    assert.ok(largestGap(boxes, top, bottom) / height <= MAX_EMPTY, `an empty band of ${pct(largestGap(boxes, top, bottom) / height)} of the height`);
    assert.deepEqual(open.session.errors, []);
  });
}

// ---- the hand on frame 0 ----

const inside = ([px, py], [x, y, w, h]) => px >= x && px <= x + w && py >= y && py <= y + h;
const flat = (nodes) => nodes.flatMap((n) => [n, ...flat(n.children ?? [])]);

for (const kind of SHIPPED) {
  test(`marker ${kind} at 9:16 with real glyphs: on frame 0 (m4: the pen is down on the first stroke) the hand covers no finished text`, async (t) => {
    const open = await opened(t, kind);
    if (!open) return;
    const frame0 = await open.session.page.evaluate(() => window.__snapshot(0));
    const hand = frame0.find((n) => n.props?.role === 'hand');
    assert.ok(hand, 'the hand is on frame 0');
    const unit = CANVAS.w / 1080;
    const r = ((hand.rotate ?? 0) * Math.PI) / 180;
    const outline = handOutline(look, unit).map(([x, y]) => [hand.x + x * Math.cos(r) - y * Math.sin(r), hand.y + x * Math.sin(r) + y * Math.cos(r)]);
    const boxes = flat(frame0).filter((n) => n.type === 'text' && n.layout && (n.reveal ?? 1) >= 1 && (n.opacity ?? 1) > 0 && !FURNITURE.test(n.id)).flatMap((n) => n.layout.lines.map((line) => {
      const size = n.layout.size ?? n.props.font.size;
      return { id: n.id, box: [n.x + line.x, n.y + line.y - INK_UP * size, line.width, (INK_UP + INK_DOWN) * size] };
    }));
    const covered = boxes.filter(({ box }) => outline.some((p) => inside(p, box))).map((b) => b.id);
    assert.deepEqual(covered, [], 'the hand overlaps finished text on frame 0');
  });
}

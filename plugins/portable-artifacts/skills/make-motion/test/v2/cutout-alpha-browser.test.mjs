// A picture with transparency as a cut-out, drawn: the keyline hugs the picture's edge, a clear corner of its box shows
// the ground (no box), and the shadow is the picture's shape at the look's offset. Skips without a browser.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';
import { browserAvailable } from './helpers/session.mjs';
import '../../scripts/v2/list.mjs';
import { loadFilm } from '../../scripts/v2/pipeline.mjs';
import { openSession } from '../../scripts/v2/session.mjs';

const SIZE = 200;
const RADIUS = 70; // the opaque disc, centred, on a clear field

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}
function discPng() {
  const rows = [];
  for (let y = 0; y < SIZE; y++) {
    const row = Buffer.alloc(1 + SIZE * 4);
    for (let x = 0; x < SIZE; x++) {
      const inside = (x + 0.5 - SIZE / 2) ** 2 + (y + 0.5 - SIZE / 2) ** 2 <= RADIUS ** 2;
      row.set(inside ? [40, 90, 200, 255] : [0, 0, 0, 0], 1 + x * 4);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

let dir, session;
before(async () => {
  if (!await browserAvailable()) return;
  dir = mkdtempSync(path.join(tmpdir(), 'mm-alpha-b-'));
  writeFileSync(path.join(dir, 'disc.png'), discPng());
  writeFileSync(path.join(dir, 'film.json'), JSON.stringify({ version: 2, fps: 30, look: 'desk', shots: [{ id: 'cut', show: 'media', src: 'disc.png', fit: 'cutout', hold: 2 }] }));
  session = await openSession(loadFilm(path.join(dir, 'film.json')));
});
after(async () => {
  await session?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const FRAME = 50;
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const near = (a, b, tolerance) => a.every((v, i) => Math.abs(v - b[i]) <= tolerance);
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

test('the keyline follows the disc\'s edge, a clear corner shows the ground, the shadow is a disc at the look\'s offset', async (t) => {
  if (!session) return t.skip('no browser');
  const probe = await session.page.evaluate(async (i) => {
    await window.__seek(i);
    const find = (nodes, end) => nodes.reduce((hit, n) => hit ?? (n.id.endsWith(end) ? n : find(n.children, end)), null);
    const tree = window.__snapshot(i);
    const image = find(tree, '.cutout.image');
    const keyline = find(tree, '.cutout.keyline');
    const ctx = window.__source.getContext('2d');
    const at = (x, y) => [...ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data].slice(0, 3);
    const [x, y, w] = image.bbox;
    const scale = w / 200;
    const cx = x + w / 2, cy = image.bbox[1] + image.bbox[3] / 2;
    // the disc's radius is in the picture's pixels; the keyline's spread is in the drawn picture's (props.w) pixels
    const r = 70 * scale, k = keyline.props.silhouette.spread * (w / keyline.props.w);
    return {
      colour: keyline.props.silhouette.color, k,
      ring: at(cx - r - k / 2, cy), // just outside the disc, away from the shadow
      corner: at(x + 4, y + 4), ground: at(x - 60, y + 4),
      shadowSide: at(cx + (r + k + 3) * Math.SQRT1_2, cy + (r + k + 3) * Math.SQRT1_2),
      lightSide: at(cx - (r + k + 3) * Math.SQRT1_2, cy - (r + k + 3) * Math.SQRT1_2),
    };
  }, FRAME);
  assert.ok(probe.k >= 4, `the keyline has width (${probe.k} px)`);
  assert.ok(near(probe.ring, hex(probe.colour), 10), `the keyline colour hugs the disc: ${probe.ring} vs ${probe.colour}`);
  assert.ok(near(probe.corner, probe.ground, 14), `a clear corner of the picture's box shows the ground, not a box: ${probe.corner} vs ${probe.ground}`);
  assert.ok(!near(probe.corner, hex(probe.colour), 10), 'no keyline rectangle round the box');
  assert.ok(lum(probe.shadowSide) < lum(probe.lightSide) - 6, `the shadow falls on the look's side: ${probe.shadowSide} vs ${probe.lightSide}`);
});

test('the server reads the transparency from the file: both the keyline and the shadow are the picture\'s silhouette', async (t) => {
  if (!session) return t.skip('no browser');
  const types = await session.page.evaluate((i) => {
    const find = (nodes, end) => nodes.reduce((hit, n) => hit ?? (n.id.endsWith(end) ? n : find(n.children, end)), null);
    return ['.cutout.keyline', '.cutout.shadow'].map((end) => find(window.__snapshot(i), end).type);
  }, FRAME);
  assert.deepEqual(types, ['image', 'image'], 'this picture has transparency, so both are its silhouette');
});

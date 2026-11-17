// Cut-outs with transparency: assetInfo reads whether a picture has alpha from its header (scripts/v2/asset-info.mjs),
// and the cutout device with alpha: true draws its keyline and shadow from the picture's own shape (silhouettes), while
// an opaque picture's nodes stay exactly as recorded before the change (fixtures/cutout-opaque.json).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { registries } from '../../engine/registry.mjs';
import '../../scripts/v2/list.mjs';
import { resolveLook } from '../../engine/graph/film.mjs';
import { node } from '../../engine/graph/node.mjs';
import { assetInfo } from '../../scripts/v2/asset-info.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RECORDED = JSON.parse(readFileSync(path.join(HERE, 'fixtures/cutout-opaque.json'), 'utf8'));

// A minimal PNG: IHDR with the colour type, optional extra chunks, one IDAT of zero rows.
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}
function png(colourType, extra = []) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = colourType;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colourType];
  const raw = Buffer.alloc(2 * (1 + 2 * channels));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), ...extra, chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// A WebP header: RIFF, WEBP, then a VP8X chunk with its flags byte, or a plain lossy VP8 chunk.
const webp = (fourcc, flags = 0) => Buffer.concat([Buffer.from('RIFF'), Buffer.from([30, 0, 0, 0]), Buffer.from('WEBP'), Buffer.from(fourcc), Buffer.from([10, 0, 0, 0, flags, 0, 0, 0, 1, 0, 0, 1, 0, 0])]);

let dir;
before(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'mm-alpha-'));
  const files = {
    'rgba.png': png(6), 'grey-alpha.png': png(4), 'rgb.png': png(2),
    'palette-trns.png': png(3, [chunk('PLTE', Buffer.from([0, 0, 0, 255, 255, 255])), chunk('tRNS', Buffer.from([0]))]),
    'palette.png': png(3, [chunk('PLTE', Buffer.from([0, 0, 0]))]),
    'photo.jpg': Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0]),
    'alpha.webp': webp('VP8X', 0x10), 'flat.webp': webp('VP8X', 0), 'lossy.webp': webp('VP8 '),
    'cut.png': png(6).subarray(0, 20),
  };
  for (const [name, bytes] of Object.entries(files)) writeFileSync(path.join(dir, name), bytes);
});
after(() => rmSync(dir, { recursive: true, force: true }));

test('assetInfo reads transparency from the header: PNG colour types 4 and 6 or tRNS, the WebP alpha flag, never a JPEG', () => {
  const alpha = (name) => assetInfo(path.join(dir, name)).alpha;
  assert.deepEqual(['rgba.png', 'grey-alpha.png', 'palette-trns.png', 'alpha.webp'].map(alpha), [true, true, true, true]);
  assert.deepEqual(['rgb.png', 'palette.png', 'photo.jpg', 'flat.webp', 'lossy.webp'].map(alpha), [false, false, false, false, false]);
});

test('a truncated picture is an error naming the file, not a guess', () => {
  assert.throws(() => assetInfo(path.join(dir, 'cut.png')), /cut\.png/);
});

const build = (lookName, alpha) => registries.devices.get('cutout').build({
  id: 'p.cutout', box: [-200, -150, 400, 300], at: 0, look: resolveLook({ look: lookName }), unit: 2, seed: 1,
  image: node('image', 'p.image', { src: 'a.png', w: 400, h: 300 }), ...(alpha === undefined ? {} : { alpha }),
});

test('an opaque picture draws exactly as recorded before the change, in desk and pop', () => {
  for (const look of ['desk', 'pop']) {
    assert.deepEqual(JSON.parse(JSON.stringify(build(look).nodes)), RECORDED[look], look);
    assert.deepEqual(JSON.parse(JSON.stringify(build(look, false).nodes)), RECORDED[look], `${look}, alpha: false`);
  }
});

test('alpha: true gives a keyline and a shadow in the picture\'s own shape, at the look\'s width and offsets', () => {
  for (const lookName of ['desk', 'pop']) {
    const look = resolveLook({ look: lookName });
    const [group] = build(lookName, true).nodes;
    const byId = Object.fromEntries(group.children.map((n) => [n.id, n]));
    assert.deepEqual(group.children.map((n) => n.id), ['p.cutout.shadow', 'p.cutout.keyline', 'p.cutout.image']);
    const { shadow, keyline } = { shadow: byId['p.cutout.shadow'], keyline: byId['p.cutout.keyline'] };
    for (const n of [shadow, keyline]) {
      assert.equal(n.type, 'image', `${n.id} is the picture itself`);
      assert.equal(n.props.src, 'a.png');
      assert.deepEqual([n.props.w, n.props.h, n.props.x, n.props.y].slice(0, 2), [400, 300]);
    }
    assert.equal(keyline.props.silhouette.spread, look.keyline * 2, 'the keyline is the look\'s width');
    assert.deepEqual([shadow.props.x + 200, shadow.props.y + 150], [look.shadow.dx * 2, look.shadow.dy * 2], 'the shadow sits at the look\'s offset');
    assert.equal(shadow.props.silhouette.spread, 0);
    assert.equal(shadow.props.opacity, look.shadow.alpha);
  }
});

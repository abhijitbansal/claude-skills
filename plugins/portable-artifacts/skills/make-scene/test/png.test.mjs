import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { decodePng, distinctColours, samplePng } from '../scripts/lib/png.mjs';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
};

// An 8-bit PNG of `pixels` (rows of [r,g,b(,a)]) with every row filtered by `filterFor(rowIndex)`.
function encode(pixels, { channels = 3, filterFor = () => 0, colourType = channels === 4 ? 6 : 2 } = {}) {
  const h = pixels.length;
  const w = pixels[0].length;
  const stride = w * channels;
  const raw = pixels.map((row) => Buffer.from(row.flat()));
  const rows = raw.map((line, y) => {
    const type = filterFor(y);
    const prev = y > 0 ? raw[y - 1] : Buffer.alloc(stride);
    const out = Buffer.alloc(stride + 1);
    out[0] = type;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      const predictor = [0, a, b, (a + b) >> 1, paeth][type];
      out[i + 1] = (line[i] - predictor) & 0xff;
    }
    return out;
  });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = colourType;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const gradient = (w, h, channels) => Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => {
  const px = [(x * 37 + y * 11) & 0xff, (x * 5 + y * 29) & 0xff, (x * 17 + y * 3) & 0xff];
  return channels === 4 ? [...px, 255 - ((x + y) & 0x3f)] : px;
}));

for (const channels of [3, 4]) {
  for (const filter of [0, 1, 2, 3, 4]) {
    test(`decodes ${channels === 4 ? 'RGBA' : 'RGB'} rows filtered with type ${filter}`, () => {
      const pixels = gradient(9, 7, channels);
      const png = decodePng(encode(pixels, { channels, filterFor: () => filter }));
      assert.equal(png.width, 9);
      assert.equal(png.height, 7);
      for (let y = 0; y < 7; y++) {
        for (let x = 0; x < 9; x++) assert.deepEqual(png.pixel(x, y), pixels[y][x].slice(0, 3), `pixel ${x},${y}`);
      }
    });
  }
}

test('decodes a PNG that mixes all five filter types row by row', () => {
  const pixels = gradient(12, 10, 3);
  const png = decodePng(encode(pixels, { filterFor: (y) => y % 5 }));
  assert.deepEqual(png.pixel(11, 9), pixels[9][11]);
  assert.deepEqual(png.pixel(0, 4), pixels[4][0]);
});

test('rejects what is not a plain 8-bit RGB or RGBA PNG, with a clear message', () => {
  assert.throws(() => decodePng(Buffer.from('not a png at all')), /not a PNG/);
  assert.throws(() => decodePng(encode(gradient(3, 3, 3), { colourType: 0 })), /unsupported PNG/);
});

test('distinctColours counts the colours on a grid, and a flat image has one', () => {
  const flat = decodePng(encode(Array.from({ length: 40 }, () => Array.from({ length: 40 }, () => [10, 20, 30]))));
  assert.equal(distinctColours(flat, 32), 1);
  const busy = decodePng(encode(gradient(64, 64, 3)));
  assert.ok(distinctColours(busy, 32) > 100);
});

test('samplePng is stable for the same image and differs when pixels differ', () => {
  const a = decodePng(encode(gradient(64, 64, 3)));
  const b = decodePng(encode(gradient(64, 64, 3)));
  const c = decodePng(encode(gradient(64, 64, 3).map((row, y) => (y === 31 ? row.map(() => [1, 2, 3]) : row))));
  assert.equal(samplePng(a, 32), samplePng(b, 32));
  assert.notEqual(samplePng(a, 32), samplePng(c, 32));
});

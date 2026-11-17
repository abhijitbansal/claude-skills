// A picture is refused in Node, from its header and its byte count, before it is sent to the page to be decoded (G-74): a huge
// or hostile file would otherwise be decoded by Chromium first and refused after. No browser, no model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pictureSize, assertPictureLimits, MAX_PICTURE_BYTES, MAX_SIDE } from '../scripts/lib/cutout.mjs';

const png = (w, h) => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
};
// SOI, an APP0 segment, then SOF0: precision, height, width.
const jpeg = (w, h) => {
  const app = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
  const sof = Buffer.alloc(11);
  sof.set([0xff, 0xc0, 0x00, 0x0b, 0x08]);
  sof.writeUInt16BE(h, 5);
  sof.writeUInt16BE(w, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app, sof]);
};
const webpHeader = (kind) => {
  const b = Buffer.alloc(40);
  b.write('RIFF', 0, 'ascii');
  b.write('WEBP', 8, 'ascii');
  b.write(kind, 12, 'ascii');
  return b;
};
const webpLossy = (w, h) => { const b = webpHeader('VP8 '); b.writeUInt16LE(w, 26); b.writeUInt16LE(h, 28); return b; };
const webpLossless = (w, h) => { const b = webpHeader('VP8L'); b.writeUInt32LE((w - 1) | ((h - 1) << 14), 21); return b; };
const webpExtended = (w, h) => { const b = webpHeader('VP8X'); b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3); return b; };

test('pictureSize reads width and height from the header of a PNG, a JPEG and the three kinds of WebP', () => {
  assert.deepEqual(pictureSize(png(1200, 800)), [1200, 800]);
  assert.deepEqual(pictureSize(jpeg(640, 480)), [640, 480]);
  assert.deepEqual(pictureSize(webpLossy(300, 200)), [300, 200]);
  assert.deepEqual(pictureSize(webpLossless(301, 201)), [301, 201]);
  assert.deepEqual(pictureSize(webpExtended(5000, 4000)), [5000, 4000]);
});

test('pictureSize returns null for anything it cannot read, never throws', () => {
  assert.equal(pictureSize(Buffer.from('not a picture')), null);
  assert.equal(pictureSize(Buffer.alloc(0)), null);
  assert.equal(pictureSize(Buffer.from([0xff, 0xd8, 0xff])), null, 'a JPEG cut off before its frame header');
  assert.equal(pictureSize(png(1, 1).subarray(0, 20)), null, 'a PNG cut off inside IHDR');
});

test('assertPictureLimits refuses a picture over MAX_SIDE on a side, from the header alone', () => {
  assert.doesNotThrow(() => assertPictureLimits(png(MAX_SIDE, 100)));
  assert.throws(() => assertPictureLimits(png(MAX_SIDE + 1, 100)), new RegExp(`the picture is ${MAX_SIDE + 1}x100; cutouts take at most ${MAX_SIDE} px on a side\\. Shrink it first`));
  assert.throws(() => assertPictureLimits(jpeg(100, 20000)), /the picture is 100x20000;/);
});

test('assertPictureLimits refuses a file over the byte cap, whatever its header says', () => {
  const big = Buffer.concat([png(10, 10), Buffer.alloc(MAX_PICTURE_BYTES)]);
  assert.throws(() => assertPictureLimits(big), /the picture file is \d+ MB; cutouts take at most 64 MB\. Shrink it first/);
  assert.doesNotThrow(() => assertPictureLimits(png(10, 10)));
});

test('assertPictureLimits leaves a picture whose header it cannot read to the page, which still checks the size after decoding', () => {
  assert.doesNotThrow(() => assertPictureLimits(Buffer.from('GIF89a....')));
});

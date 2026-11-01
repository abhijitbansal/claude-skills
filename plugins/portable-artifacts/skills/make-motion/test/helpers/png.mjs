// Shared by tests that need an image asset (not a test file): a small 8-bit RGB PNG, drawn by a function, with no dependency.
import { deflateSync } from 'node:zlib';

// CRC-32 of the PNG spec (zlib.crc32 needs Node 20.15; the package supports 20.0 and later).
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
};

/** A `width` x `height` PNG whose pixel (x, y) is the [r, g, b] (0-255) that `pixel(x, y)` returns. */
export function makePng(width, height, pixel) {
  const rows = Buffer.alloc((width * 3 + 1) * height); // each row: filter byte 0, then RGB
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * (width * 3 + 1) + 1 + x * 3;
      pixel(x, y).forEach((v, i) => { rows[at + i] = v; });
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8 bits, RGB, deflate, no filter, no interlace
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

/** A PNG of one colour. */
export const solidPng = (width, height, rgb) => makePng(width, height, () => rgb);

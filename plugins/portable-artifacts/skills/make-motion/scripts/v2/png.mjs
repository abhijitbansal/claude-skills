// A minimal PNG reader for the screenshots the browser takes of the stage: 8-bit RGB or RGBA, not interlaced (what
// Chromium writes). Node's zlib only; no package. -> { width, height, channels, data } with the rows unfiltered.
import { inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS = Object.freeze({ 2: 3, 6: 4 }); // colour type -> channels: RGB, RGBA
const BIT_DEPTH = 8;

// The chunks of a PNG: { type, data }.
function chunksOf(buffer) {
  const chunks = [];
  for (let at = SIGNATURE.length; at < buffer.length;) {
    const length = buffer.readUInt32BE(at);
    chunks.push({ type: buffer.toString('ascii', at + 4, at + 8), data: buffer.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
  }
  return chunks;
}

const paeth = (a, b, c) => {
  const p = a + b - c;
  const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

// Undoes the five PNG row filters in place over `raw` (filter byte + row, per row) into `out`.
function unfilter(raw, out, { width, height, channels }) {
  const stride = width * channels;
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[y * stride + x - channels] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels] : 0;
      const predictor = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter];
      if (predictor === undefined) throw new Error(`png: unknown row filter ${filter}`);
      out[y * stride + x] = (raw[src + x] + predictor) & 0xff;
    }
  }
}

/** The pixels of the PNG `buffer`; throws for a file that is not an 8-bit RGB or RGBA, non-interlaced PNG. */
export function readPng(buffer) {
  if (!buffer.subarray(0, SIGNATURE.length).equals(SIGNATURE)) throw new Error('png: not a PNG');
  const chunks = chunksOf(buffer);
  const header = chunks.find((c) => c.type === 'IHDR').data;
  const [width, height, depth, colour, interlace] = [header.readUInt32BE(0), header.readUInt32BE(4), header[8], header[9], header[12]];
  const channels = CHANNELS[colour];
  if (depth !== BIT_DEPTH || channels === undefined || interlace !== 0) throw new Error(`png: only 8-bit RGB or RGBA, not interlaced (depth ${depth}, colour type ${colour})`);
  const raw = inflateSync(Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)));
  const data = Buffer.alloc(width * height * channels);
  unfilter(raw, data, { width, height, channels });
  return { width, height, channels, data };
}

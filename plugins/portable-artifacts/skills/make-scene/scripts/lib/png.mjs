// A minimal PNG reader over node:zlib, for the browser checks: a Playwright element screenshot is decoded here
// and sampled in Node. (Reading pixels in the page returns black: the canvas has no preserveDrawingBuffer.)
// Handles what Chromium writes: 8-bit RGB or RGBA, no interlacing, all five row filters.
import zlib from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS = { 2: 3, 6: 4 }; // colour type -> channels (RGB, RGBA)

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** decodePng(buffer) -> { width, height, pixel(x, y) -> [r, g, b] }. Throws on anything but a plain 8-bit RGB/RGBA PNG. */
export function decodePng(buffer) {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  let header = null;
  const data = [];
  for (let at = 8; at + 8 <= buffer.length;) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.toString('latin1', at + 4, at + 8);
    const body = buffer.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') header = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], colour: body[9], interlace: body[12] };
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += length + 12;
  }
  if (!header || data.length === 0) throw new Error('not a PNG: no header or image data');
  const channels = CHANNELS[header.colour];
  if (!channels || header.depth !== 8 || header.interlace !== 0) {
    throw new Error(`unsupported PNG (colour type ${header.colour}, ${header.depth}-bit, interlace ${header.interlace}); expected 8-bit RGB or RGBA`);
  }
  const { width, height } = header;
  const stride = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(data));
  if (raw.length !== (stride + 1) * height) throw new Error('not a PNG: image data has the wrong length');
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const type = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? pixels[out + i - channels] : 0;
      const b = y > 0 ? pixels[out - stride + i] : 0;
      const c = i >= channels && y > 0 ? pixels[out - stride + i - channels] : 0;
      let predictor;
      if (type === 0) predictor = 0;
      else if (type === 1) predictor = a;
      else if (type === 2) predictor = b;
      else if (type === 3) predictor = (a + b) >> 1;
      else if (type === 4) predictor = paeth(a, b, c);
      else throw new Error(`not a PNG: unknown row filter ${type}`);
      pixels[out + i] = (line[i] + predictor) & 0xff;
    }
  }
  return {
    width,
    height,
    pixel: (x, y) => {
      const at = y * stride + x * channels;
      return [pixels[at], pixels[at + 1], pixels[at + 2]];
    },
  };
}

/** The colours (as "r,g,b" strings) at the centres of an n x n grid over the image. */
function gridColours(png, n) {
  const colours = [];
  for (let gy = 0; gy < n; gy++) {
    for (let gx = 0; gx < n; gx++) {
      const x = Math.min(png.width - 1, Math.floor(((gx + 0.5) * png.width) / n));
      const y = Math.min(png.height - 1, Math.floor(((gy + 0.5) * png.height) / n));
      colours.push(png.pixel(x, y).join(','));
    }
  }
  return colours;
}

/** How many distinct colours an n x n grid of samples sees. A blank canvas sees one. */
export const distinctColours = (png, n = 32) => new Set(gridColours(png, n)).size;

/** One string for the n x n grid of samples: equal strings mean the sampled pixels are all equal. */
export const samplePng = (png, n = 32) => gridColours(png, n).join(';');

// What a film's picture says about itself, from its header: whether it has transparency. One source for the Node-side
// build and the page alike (server.mjs lists it in /film.json; ctx.asset(src).alpha). A PNG has it with colour type 4
// (grey + alpha) or 6 (RGBA), or a tRNS chunk before its image data; a WebP with the VP8X alpha flag or a lossless
// VP8L alpha bit; a JPEG never; a GIF is treated as opaque. A file too short for its own header is an error naming it.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_ALPHA_TYPES = new Set([4, 6]);
const IHDR_COLOUR_TYPE = 25; // byte offset: signature 8 + length 4 + "IHDR" 4 + width 4 + height 4 + depth 1
const CHUNK_OVERHEAD = 12; // length, type, crc
const VP8X_ALPHA = 0x10;
const VP8L_ALPHA_BIT = 28;

const truncated = (file) => new Error(`${path.basename(file)}: the picture is cut short (its header is incomplete)`);

function pngAlpha(bytes, file) {
  if (bytes.length <= IHDR_COLOUR_TYPE) throw truncated(file);
  if (PNG_ALPHA_TYPES.has(bytes[IHDR_COLOUR_TYPE])) return true;
  for (let at = PNG_SIGNATURE.length; ;) {
    if (at + CHUNK_OVERHEAD > bytes.length) throw truncated(file);
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString('latin1', at + 4, at + 8);
    if (type === 'tRNS') return true;
    if (type === 'IDAT' || type === 'IEND') return false;
    at += CHUNK_OVERHEAD + length;
  }
}

function webpAlpha(bytes, file) {
  const fourcc = bytes.toString('latin1', 12, 16);
  if (fourcc === 'VP8X') {
    if (bytes.length < 21) throw truncated(file);
    return (bytes[20] & VP8X_ALPHA) !== 0;
  }
  if (fourcc === 'VP8L') {
    if (bytes.length < 25) throw truncated(file);
    return ((bytes.readUInt32LE(21) >>> VP8L_ALPHA_BIT) & 1) === 1;
  }
  return false;
}

/** @param {string} file a picture's real path @returns {{ alpha: boolean }} */
export function assetInfo(file) {
  const bytes = readFileSync(file);
  if (bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return { alpha: pngAlpha(bytes, file) };
  if (bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return { alpha: webpAlpha(bytes, file) };
  return { alpha: false };
}

// Photo treatments in pixels (engine/devices/treatments.mjs names them): the treated bitmap of a picture is computed once
// per picture, treatment and drawn size by arithmetic on its ImageData and cached, so nothing is recomputed per frame and
// no canvas `filter` is used. duotone: each pixel's luminance mapped from `dark` to `light` through OKLab
// (engine/color/oklab.mjs mixOklab, as a 256-entry table). halftone: the `light` colour with one dot of `dark` per
// `cell` px, its radius from the cell's mean luminance (a black cell's dot covers it, a white cell has none). The pixel
// functions are pure (they take and return RGBA arrays), so Node tests run them; only the default cache makes canvases.
import { mixOklab } from '../color/oklab.mjs';

const CHANNELS = 4;
const LEVELS = 256;
const MAX = 255;
const HEX_RADIX = 16;
const HALF = 2;
const MAX_SIDE = 2048; // px: a treated bitmap is at most this wide or tall; it is drawn scaled to its node's size
// Rec. 709 luma weights on the encoded channels: the lightness a reader sees
const LUMA = Object.freeze([0.2126, 0.7152, 0.0722]);
const LUMA_EPSILON = 1e-9; // the weights sum to 1 only to float precision: a white cell is darkness 0, no dot

const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + HALF), HEX_RADIX));
/** The luminance (0 to 1) of an RGB pixel. */
export const luma = (r, g, b) => (LUMA[0] * r + LUMA[1] * g + LUMA[2] * b) / MAX;

// RGB triplets of mixOklab(dark, light, i / 255) for i = 0..255.
function toneTable(dark, light) {
  const table = new Uint8ClampedArray(LEVELS * 3);
  for (let i = 0; i < LEVELS; i++) table.set(rgbOf(mixOklab(dark, light, i / MAX)), i * 3);
  return table;
}

/** A new RGBA array: each pixel of `data` mapped from `dark` (black) to `light` (white) by its luminance; alpha kept. */
export function duotone(data, dark, light) {
  const table = toneTable(dark, light);
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += CHANNELS) {
    const level = Math.round(luma(data[i], data[i + 1], data[i + 2]) * MAX) * 3;
    out[i] = table[level]; out[i + 1] = table[level + 1]; out[i + 2] = table[level + 2]; out[i + 3] = data[i + 3];
  }
  return out;
}

/** The dots of a halftone of `data` (w x h) at `cell` px: { cx, cy, r } per cell, r = cell/2 * sqrt(2) * sqrt(1 - mean). */
export function halftoneDots(data, w, h, cell) {
  const dots = [];
  for (let y0 = 0; y0 < h; y0 += cell) {
    for (let x0 = 0; x0 < w; x0 += cell) {
      let sum = 0, count = 0;
      for (let y = y0; y < Math.min(h, y0 + cell); y++) {
        for (let x = x0; x < Math.min(w, x0 + cell); x++) {
          const i = (y * w + x) * CHANNELS;
          sum += luma(data[i], data[i + 1], data[i + 2]);
          count += 1;
        }
      }
      const darkness = 1 - sum / count;
      const r = darkness < LUMA_EPSILON ? 0 : (cell / HALF) * Math.SQRT2 * Math.sqrt(darkness);
      dots.push({ cx: x0 + cell / HALF, cy: y0 + cell / HALF, r });
    }
  }
  return dots;
}

/** A new RGBA array: `light` everywhere, `dark` inside each cell's dot (a pixel is inside when its centre is). */
export function halftone(data, w, h, dark, light, cell) {
  const [dr, dg, db] = rgbOf(dark), [lr, lg, lb] = rgbOf(light);
  const out = new Uint8ClampedArray(data.length);
  const columns = Math.ceil(w / cell);
  const dots = halftoneDots(data, w, h, cell);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dot = dots[Math.floor(y / cell) * columns + Math.floor(x / cell)];
      const inside = (x + 0.5 - dot.cx) ** 2 + (y + 0.5 - dot.cy) ** 2 <= dot.r ** 2;
      const i = (y * w + x) * CHANNELS;
      out[i] = inside ? dr : lr; out[i + 1] = inside ? dg : lg; out[i + 2] = inside ? db : lb; out[i + 3] = data[i + 3];
    }
  }
  return out;
}

// The treated pixels of `img` (ImageData-shaped) as a new RGBA array.
function treatPixels({ data, width, height }, treatment) {
  if (treatment.type === 'duotone') return duotone(data, treatment.dark, treatment.light);
  if (treatment.type === 'halftone') return halftone(data, width, height, treatment.dark, treatment.light, treatment.cell);
  throw new Error(`treatment type must be duotone or halftone, got ${JSON.stringify(treatment.type)}`);
}

// The bitmap's size: the drawn size, at most MAX_SIDE on its longer side, at least 1 px.
function bitmapSize(w, h) {
  const fit = Math.min(1, MAX_SIDE / Math.max(w, h));
  return [Math.max(1, Math.round(w * fit)), Math.max(1, Math.round(h * fit))];
}

/**
 * A cache of treated bitmaps: get(image, treatment, w, h, clip?) draws `image` (its `clip` [sx, sy, sw, sh], else all of
 * it) into a canvas of the drawn size w x h made by makeCanvas(width, height), treats its pixels and keeps it, by
 * picture, treatment, size and clip. The same key returns the same canvas object.
 */
export function createTreatCache(makeCanvas) {
  const byImage = new WeakMap();
  return {
    get(image, treatment, w, h, clip) {
      if (!byImage.has(image)) byImage.set(image, new Map());
      const kept = byImage.get(image);
      const key = JSON.stringify([treatment, w, h, clip ?? null]);
      if (kept.has(key)) return kept.get(key);
      const [bw, bh] = bitmapSize(w, h);
      const canvas = makeCanvas(bw, bh);
      const ctx = canvas.getContext('2d');
      if (clip) ctx.drawImage(image, ...clip, 0, 0, bw, bh);
      else ctx.drawImage(image, 0, 0, bw, bh);
      const source = ctx.getImageData(0, 0, bw, bh);
      const treated = ctx.createImageData(bw, bh);
      // a bitmap capped at MAX_SIDE keeps the dots' size on screen: the cell is scaled with it
      const cell = treatment.cell === undefined ? undefined : Math.max(1, Math.round((treatment.cell * bw) / w));
      treated.data.set(treatPixels(source, cell === undefined ? treatment : { ...treatment, cell }));
      ctx.putImageData(treated, 0, 0);
      kept.set(key, canvas);
      return canvas;
    },
  };
}

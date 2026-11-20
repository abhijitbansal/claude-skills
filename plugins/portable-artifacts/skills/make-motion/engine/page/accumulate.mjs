// The mean of a smeared cut's moving layers (engine/cuts/smear.mjs). Each layer is drawn on a clear canvas and its
// premultiplied colour summed in a Float32Array; the sum is exact (whole numbers below 2^24: at most 32 layers of
// 255 x 255). Because compositing is linear in premultiplied colour, the mean of the layers composited once over the
// still picture equals the mean of the whole frames, and the still nodes are drawn once instead of once per sample.
// When the sample cap left neighbouring copies more than SMEAR_GAP_PX apart, the mean is box-filtered along the motion
// over that gap, which closes the gaps between the copies into one streak; a zoom (no single vector) is never capped at
// the lengths a cut may have (test/v2/cuts-smear.test.mjs). The sum runs on the CPU, so it is the same with or without
// WebGL. createAccumulator({ w, h }) -> { kind: 'float', mean(drawLayer, count, { vector, gapPx }) -> canvas, made() }.
import { SMEAR_GAP_PX } from '../cuts/smear.mjs';

const CHANNELS = 4;
const ALPHA = 3;
const BYTE = 255;

// The running integral of one line of the sum (one channel), sampled at a fractional place s in pixels: the sum of the
// whole pixels before floor(s) and the share of pixel floor(s) up to s. Past either end the edge pixel carries on (as
// CLAMP_TO_EDGE does), since what lies off the canvas is not drawn: an opaque sheet running off the canvas must not
// thin out at the edge.
function integralAt(prefix, line, s, length) {
  if (s <= 0) return s * line[0];
  if (s >= length) return prefix[length] + (s - length) * line[length - 1];
  const i = Math.floor(s);
  return prefix[i] + (s - i) * line[i];
}

// A box of width `gap` pixels centred on each pixel, along lines of `length` pixels `stride` apart in `sum` (each pixel
// CHANNELS floats), `lines` of them starting `step` apart: x lines for a horizontal motion, y lines for a vertical one.
function boxLines(sum, { length, lines, stride, step, gap }) {
  const line = new Float64Array(length), prefix = new Float64Array(length + 1);
  const half = gap / 2;
  for (let l = 0; l < lines; l++) {
    for (let c = 0; c < CHANNELS; c++) {
      for (let i = 0; i < length; i++) line[i] = sum[l * step + i * stride + c];
      for (let i = 0; i < length; i++) prefix[i + 1] = prefix[i] + line[i];
      for (let i = 0; i < length; i++) {
        const centre = i + 1 / 2;
        sum[l * step + i * stride + c] = (integralAt(prefix, line, centre + half, length) - integralAt(prefix, line, centre - half, length)) / gap;
      }
    }
  }
}

function boxFilter(sum, w, h, vector, gap) {
  const horizontal = Math.abs(vector[0]) >= Math.abs(vector[1]);
  if (horizontal) boxLines(sum, { length: w, lines: h, stride: CHANNELS, step: w * CHANNELS, gap });
  else boxLines(sum, { length: h, lines: w, stride: w * CHANNELS, step: CHANNELS, gap });
}

// Adds a layer's pixels (un-premultiplied RGBA bytes, as getImageData gives them) to `sum` as premultiplied colour x 255.
function addLayer(sum, data) {
  for (let i = 0; i < data.length; i += CHANNELS) {
    const a = data[i + ALPHA];
    if (a === 0) continue;
    sum[i] += data[i] * a;
    sum[i + 1] += data[i + 1] * a;
    sum[i + 2] += data[i + 2] * a;
    sum[i + ALPHA] += a * BYTE;
  }
}

// The mean in `sum` (each channel the sum over the layers of colour x alpha, alpha summed as alpha x 255) as
// un-premultiplied RGBA bytes: colour = sum(colour x alpha) / sum(alpha), alpha = sum(alpha) / count.
function meanBytes(sum, count, out) {
  for (let i = 0; i < sum.length; i += CHANNELS) {
    const total = sum[i + ALPHA];
    if (total <= 0) {
      out[i] = 0; out[i + 1] = 0; out[i + 2] = 0; out[i + ALPHA] = 0;
      continue;
    }
    for (let c = 0; c < ALPHA; c++) out[i + c] = Math.round((BYTE * sum[i + c]) / total);
    out[i + ALPHA] = Math.round(total / BYTE / count);
  }
}

/**
 * @param {{ w: number, h: number }} size the canvas size
 */
export function createAccumulator({ w, h }) {
  let made = 0;
  let layer = null, result = null, sum = null;
  const ready = () => {
    if (layer !== null) return;
    made += 1;
    layer = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true });
    result = new OffscreenCanvas(w, h).getContext('2d');
    sum = new Float32Array(w * h * CHANNELS);
  };
  return {
    kind: 'float',
    made: () => made,
    /**
     * The mean of `count` layers, drawLayer(ctx, k) painting layer k on a clear canvas at the identity, as a canvas to
     * composite over the still picture; box-filtered along `vector` over `gapPx` when that is over SMEAR_GAP_PX.
     */
    mean(drawLayer, count, { vector = null, gapPx = 0 } = {}) {
      if (!(Number.isInteger(count) && count > 0)) throw new Error(`accumulate: count must be a whole number > 0, got ${count}`);
      ready();
      sum.fill(0);
      for (let k = 0; k < count; k++) {
        if (typeof layer.reset === 'function') layer.reset();
        layer.setTransform(1, 0, 0, 1, 0, 0);
        layer.clearRect(0, 0, w, h);
        drawLayer(layer, k);
        addLayer(sum, layer.getImageData(0, 0, w, h).data);
      }
      if (vector !== null && gapPx > SMEAR_GAP_PX) boxFilter(sum, w, h, vector, gapPx);
      const image = result.createImageData(w, h);
      meanBytes(sum, count, image.data);
      result.putImageData(image, 0, 0);
      return result.canvas;
    },
  };
}

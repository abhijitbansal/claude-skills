// Colour mixing in OKLab / OKLCH (Bjorn Ottosson's perceptual space): a fade between two colours that keeps its lightness and
// hue honest, so lavender to gold never passes through khaki or olive as an sRGB channel mix does. Pure.

const HEX_RADIX = 16;
const CHANNEL_MAX = 255;
const LINEAR_KNEE = 0.04045, LINEAR_SLOPE = 12.92, GAMMA_OFFSET = 0.055, GAMMA_SCALE = 1.055, GAMMA = 2.4;
const ENCODE_KNEE = 0.0031308;
const CUBE = 3;

const toLinear = (c) => (c <= LINEAR_KNEE ? c / LINEAR_SLOPE : ((c + GAMMA_OFFSET) / GAMMA_SCALE) ** GAMMA);
const toGamma = (c) => (c <= ENCODE_KNEE ? c * LINEAR_SLOPE : GAMMA_SCALE * c ** (1 / GAMMA) - GAMMA_OFFSET);

/** #rrggbb to [L, a, b] in OKLab. */
export function toOklab(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), HEX_RADIX) / CHANNEL_MAX));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** [L, a, b] in OKLab to #rrggbb (clamped into sRGB). */
export function fromOklab([L, A, B]) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** CUBE;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** CUBE;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** CUBE;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const hex = rgb.map((c) => Math.round(Math.min(1, Math.max(0, toGamma(Math.max(0, c)))) * CHANNEL_MAX).toString(HEX_RADIX).padStart(2, '0'));
  return `#${hex.join('')}`;
}

const TURN = 2 * Math.PI;
const GREY_CHROMA = 0.02; // under this a colour has no hue worth keeping: the other end's hue is used

/**
 * The colour `t` (0 to 1) of the way from `from` to `to` (#rrggbb), mixed in OKLCH: lightness and chroma
 * straight, hue along the shorter arc. A plain OKLab mix of opposite hues (lavender, gold) still passes near grey.
 */
export function mixOklab(from, to, t) {
  const [la, aa, ba] = toOklab(from), [lb, ab, bb] = toOklab(to);
  const ca = Math.hypot(aa, ba), cb = Math.hypot(ab, bb);
  let ha = Math.atan2(ba, aa), hb = Math.atan2(bb, ab);
  if (ca < GREY_CHROMA) ha = hb;
  if (cb < GREY_CHROMA) hb = ha;
  const dh = ((((hb - ha) % TURN) + TURN + Math.PI) % TURN) - Math.PI;
  const L = la + (lb - la) * t, C = ca + (cb - ca) * t, h = ha + dh * t;
  return fromOklab([L, C * Math.cos(h), C * Math.sin(h)]);
}

/** OKLCH chroma of a #rrggbb colour: how far from grey it is (khaki and olive are low-chroma mixes). */
export function chromaOf(hex) {
  const [, a, b] = toOklab(hex);
  return Math.hypot(a, b);
}

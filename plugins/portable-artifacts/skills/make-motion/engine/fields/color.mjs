// Colour helpers for the v2 fields: all colours are #rrggbb strings. Pure and DOM-free.

const HEX = /^#[0-9a-fA-F]{6}$/;
const CHANNELS = 3;
const MAX_CHANNEL = 255;
const HEX_RADIX = 16;
const ALPHA_DIGITS = 4;

export const isHexColour = (color) => typeof color === 'string' && HEX.test(color);

export function parseHex(color) {
  if (!isHexColour(color)) throw new Error(`colour must be #rrggbb, got ${JSON.stringify(color)}`);
  return Object.freeze([1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), HEX_RADIX)));
}

const isUnit = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const toHex = (channel) => channel.toString(HEX_RADIX).padStart(2, '0');

// mix(a, b, 0) is a, mix(a, b, 1) is b; channels are rounded to whole numbers.
export function mix(a, b, weight) {
  const from = parseHex(a), to = parseHex(b);
  if (!isUnit(weight)) throw new Error(`mix weight must be a number in [0, 1], got ${weight}`);
  const channels = Array.from({ length: CHANNELS }, (_, i) => Math.round(from[i] + (to[i] - from[i]) * weight));
  return `#${channels.map((c) => toHex(Math.min(MAX_CHANNEL, c))).join('')}`;
}

// sRGB relative luminance, as WCAG defines it (shared/contrast.mjs is not served to the page, where fields paint).
const LINEAR_KNEE = 0.03928, LINEAR_SLOPE = 12.92, GAMMA_OFFSET = 0.055, GAMMA_SCALE = 1.055, GAMMA = 2.4;
const LUMA = Object.freeze([0.2126, 0.7152, 0.0722]);
export function luminance(color) {
  const linear = parseHex(color).map((c) => {
    const s = c / MAX_CHANNEL;
    return s <= LINEAR_KNEE ? s / LINEAR_SLOPE : ((s + GAMMA_OFFSET) / GAMMA_SCALE) ** GAMMA;
  });
  return linear.reduce((sum, c, i) => sum + c * LUMA[i], 0);
}

// A canvas colour string for a #rrggbb colour at the given alpha.
export function rgba(color, alpha) {
  const [r, g, b] = parseHex(color);
  if (!isUnit(alpha)) throw new Error(`alpha must be a number in [0, 1], got ${alpha}`);
  return `rgba(${r}, ${g}, ${b}, ${Number(alpha.toFixed(ALPHA_DIGITS))})`;
}

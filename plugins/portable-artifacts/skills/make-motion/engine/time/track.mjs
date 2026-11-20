// Keyframe tracks for the v2 engine: track(keys) builds an immutable Track, sample(track, t) reads it.
// A value is a number, a number array (interpolated per element), a #rrggbb colour (interpolated per
// channel) or any other string (stepped: the earlier value holds until the next key). Pure and DOM-free.
import { ease } from './ease.mjs';
import { mixOklab } from '../color/oklab.mjs';

const DEFAULT_EASE = 'linear';
const COLOUR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const CHANNEL_MAX = 255;
const CHANNEL_COUNT = 3;
const HEX_RADIX = 16;
const FRAME_EPSILON = 1e-9; // keeps an exact frame boundary (0.5 s at 24 fps) from flooring to the frame before

const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const isHashString = (v) => typeof v === 'string' && v.startsWith('#');

// Which interpolation a value takes: 'number', 'array', 'colour', 'string', or null when it is none of them.
function kindOf(v) {
  if (isNumber(v)) return 'number';
  if (Array.isArray(v)) return v.length > 0 && v.every(isNumber) ? 'array' : null;
  if (typeof v === 'string') return COLOUR_PATTERN.test(v) ? 'colour' : 'string';
  return null;
}

// Every track error reads "<path>: <message>", the form resolveEase already used.
function checkValue(v, index, first) {
  const at = `keys[${index}].v`;
  if (isHashString(v) && !COLOUR_PATTERN.test(v)) throw new Error(`${at}: colours must be #rrggbb, got "${v}"`);
  const kind = kindOf(v);
  if (index === 0) {
    if (kind === null) throw new Error(`${at}: must be a finite number, a non-empty number array or a string`);
    return kind;
  }
  const want = first.kind;
  if (kind === want && (want !== 'array' || v.length === first.length)) return kind;
  const as = '(as keys[0].v is)';
  if (want === 'array') throw new Error(`${at}: must be an array of ${first.length} numbers ${as}`);
  if (want === 'colour') throw new Error(`${at}: must be a #rrggbb colour ${as}`);
  throw new Error(`${at}: must be a ${want} ${as}`);
}

function checkTime(t, index, previous) {
  if (!isNumber(t)) throw new Error(`keys[${index}].t: must be a finite number`);
  if (previous !== undefined && t < previous) {
    throw new Error(`keys[${index}].t: ${t} is before keys[${index - 1}].t (${previous}); keys must be in ascending order of t`);
  }
}

function resolveEase(name, index) {
  try {
    return ease(name ?? DEFAULT_EASE);
  } catch (err) {
    throw new Error(`keys[${index}].ease: ${err.message}`);
  }
}

// Stored values: arrays are frozen copies, colours are lowercased, every other string keeps its case.
function copyValue(v) {
  if (Array.isArray(v)) return Object.freeze([...v]);
  return typeof v === 'string' && COLOUR_PATTERN.test(v) ? v.toLowerCase() : v;
}

// options.space 'oklab': colour keys are mixed in OKLab (engine/color/oklab.mjs) instead of per sRGB channel.
export function track(keys, { space } = {}) {
  if (!Array.isArray(keys) || keys.length === 0) throw new Error('keys: must have at least one key');
  const first = { kind: null, length: 0 };
  const points = keys.map((key, i) => {
    checkTime(key?.t, i, i > 0 ? keys[i - 1].t : undefined);
    const kind = checkValue(key.v, i, first);
    if (i === 0) { first.kind = kind; first.length = Array.isArray(key.v) ? key.v.length : 0; }
    return Object.freeze({ t: key.t, v: copyValue(key.v), ease: resolveEase(key.ease, i) });
  });
  return Object.freeze({ kind: first.kind, points: Object.freeze(points), ...(space === 'oklab' ? { space } : {}) });
}

// ---- sampling ----

const lerp = (a, b, e) => a + (b - a) * e;

function parseColour(hex) {
  return Array.from({ length: CHANNEL_COUNT }, (_, i) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), HEX_RADIX));
}

/** The [r, g, b] channels (0 to 255) of a #rrggbb colour, or null for any other value. */
export const colourChannels = (v) => (typeof v === 'string' && COLOUR_PATTERN.test(v) ? parseColour(v) : null);

function formatColour(channels) {
  const hex = channels.map((c) => Math.min(CHANNEL_MAX, Math.max(0, Math.round(c))).toString(HEX_RADIX).padStart(2, '0'));
  return `#${hex.join('')}`;
}

function blend(kind, from, to, e, space) {
  if (kind === 'number') return lerp(from, to, e);
  if (kind === 'array') return from.map((a, i) => lerp(a, to[i], e));
  if (kind === 'colour') {
    if (space === 'oklab') return mixOklab(from, to, e);
    const b = parseColour(to);
    return formatColour(parseColour(from).map((a, i) => lerp(a, b[i], e)));
  }
  return from; // plain strings step
}

const out = (v) => (Array.isArray(v) ? [...v] : v);

function quantise(t, stepFps) {
  if (stepFps === undefined) return t;
  if (!isNumber(stepFps) || stepFps <= 0) throw new Error(`sample stepFps: must be a finite number > 0, got ${stepFps}`);
  return Math.floor(t * stepFps + FRAME_EPSILON) / stepFps;
}

export function sample(tr, t, stepFps) {
  if (!isNumber(t)) throw new Error(`sample t: must be a finite number, got ${t}`);
  const { points, kind, space } = tr;
  const time = quantise(t, stepFps);
  let i = -1;
  while (i + 1 < points.length && points[i + 1].t <= time) i++;
  if (i < 0) return out(points[0].v);
  if (i === points.length - 1 || time === points[i].t) return out(points[i].v);
  const next = points[i + 1];
  const p = (time - points[i].t) / (next.t - points[i].t); // next.t > time >= points[i].t, so never 0
  return blend(kind, points[i].v, next.v, next.ease(p), space);
}

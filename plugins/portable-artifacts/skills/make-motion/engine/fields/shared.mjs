// Helpers shared by the v2 fields (paper, mesh, halftone): input and param checks, seeded draws,
// deep freezing and the offscreen cache. Pure and DOM-free; OffscreenCanvas is only looked up at paint time.
import { mulberry32 } from '../../template/seeded.mjs';
import { isHexColour } from './color.mjs';

export const TAU = Math.PI * 2;
export const PALETTE_KEYS = Object.freeze(['paper', 'ink', 'ink2', 'accent', 'accent2', 'rule']);
const REFERENCE_SIDE = 1080; // 1 unit = short side / 1080
const LAYER_STRIDE = 0x9e3779b9; // golden-ratio odd constant: spreads layer seeds far apart

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

export const clean = (n) => n + 0; // turns -0 into 0 so plans survive a JSON round trip

// Validates the arguments every field plan takes and fills in unit (pixels per unit) when it is omitted.
export function checkInput({ w, h, unit, seed, palette } = {}) {
  if (!isFiniteNumber(w) || !isFiniteNumber(h) || w <= 0 || h <= 0) throw new Error(`w and h must be finite numbers > 0, got ${w} x ${h}`);
  if (unit !== undefined && (!isFiniteNumber(unit) || unit <= 0)) throw new Error(`unit must be a finite number > 0, got ${unit}`);
  if (!isFiniteNumber(seed)) throw new Error(`seed must be a finite number, got ${seed}`);
  if (palette === null || typeof palette !== 'object') throw new Error('palette must be an object with paper, ink, ink2, accent, accent2 and rule');
  for (const key of PALETTE_KEYS) {
    if (!isHexColour(palette[key])) throw new Error(`palette.${key} must be #rrggbb, got ${JSON.stringify(palette[key])}`);
  }
  return { w, h, unit: unit ?? Math.min(w, h) / REFERENCE_SIDE, seed, palette };
}

function checkParam(field, name, value, rule) {
  const bad = (what) => new Error(`param "${name}" must be ${what}, got ${JSON.stringify(value)} (field "${field}")`);
  if (rule.choices) {
    if (!rule.choices.includes(value)) throw bad(`one of: ${rule.choices.join(', ')}`);
    return;
  }
  const range = `[${rule.min}, ${rule.max}]`;
  if (!isFiniteNumber(value) || value < rule.min || value > rule.max) throw bad(`${rule.int ? 'an integer' : 'a number'} in ${range}`);
  if (rule.int && !Number.isInteger(value)) throw bad(`an integer in ${range}`);
}

// rules: { name: { min, max, int? } | { choices } }. Returns a frozen object holding only the params given.
export function resolveParams(field, params, rules) {
  if (params === undefined || params === null) return Object.freeze({});
  if (typeof params !== 'object' || Array.isArray(params)) throw new Error('params must be an object');
  const accepted = Object.keys(rules);
  for (const [name, value] of Object.entries(params)) {
    if (!accepted.includes(name)) throw new Error(`unknown param "${name}" for field "${field}"; accepted: ${accepted.join(', ')}`);
    checkParam(field, name, value, rules[name]);
  }
  return Object.freeze({ ...params });
}

// One random stream per layer, so overriding one param never shifts the draws of another layer.
export const layerRng = (seed, layer) => mulberry32((seed + Math.imul(layer + 1, LAYER_STRIDE)) >>> 0);

export const randRange = (rng, [lo, hi]) => lo + (hi - lo) * rng();
export const randInt = (rng, [lo, hi]) => lo + Math.floor(rng() * (hi - lo + 1));

export function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

// An OffscreenCanvas and its 2d context. It is the page (or a test fake) that provides the class.
export function createSurface(w, h) {
  if (typeof OffscreenCanvas !== 'function') throw new Error('OffscreenCanvas is not available here; fields paint through it');
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas could not give a 2d context');
  return { canvas, ctx };
}

// Paints the plan once into an offscreen canvas of the plan's size, keyed by the plan object, then blits it.
export function blitCached(ctx, cache, plan, build) {
  let canvas = cache.get(plan);
  if (canvas === undefined) {
    const surface = createSurface(plan.w, plan.h);
    build(surface.ctx, plan);
    canvas = surface.canvas;
    cache.set(plan, canvas);
  }
  ctx.drawImage(canvas, 0, 0);
}

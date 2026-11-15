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

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isPositiveInteger = (v) => Number.isInteger(v) && v > 0;
const MIN_UNIT = 0.25; // a short side under 270 px: grain, fibres and dots would shrink below a pixel

// Validates the arguments every field plan takes and fills in unit (pixels per unit) when it is omitted.
export function checkInput(input) {
  if (!isPlainObject(input)) throw new Error(`plan input must be an object with w, h, seed and palette, got ${input === null ? 'null' : typeof input}`);
  const { w, h, unit, seed, palette } = input;
  if (!isPositiveInteger(w) || !isPositiveInteger(h)) throw new Error(`w and h must be positive integers (pixels), got ${w} x ${h}`);
  const resolved = unit ?? Math.min(w, h) / REFERENCE_SIDE;
  if (!isFiniteNumber(resolved) || resolved < MIN_UNIT) {
    throw new Error(`unit must be at least ${MIN_UNIT} (1 unit = short side / ${REFERENCE_SIDE}; a short side under ${MIN_UNIT * REFERENCE_SIDE} px is too small), got ${resolved}`);
  }
  if (!Number.isInteger(seed)) throw new Error(`seed must be an integer, got ${seed}`);
  if (!isPlainObject(palette)) throw new Error('palette must be an object with paper, ink, ink2, accent, accent2 and rule');
  for (const key of PALETTE_KEYS) {
    if (!isHexColour(palette[key])) throw new Error(`palette.${key} must be #rrggbb, got ${JSON.stringify(palette[key])}`);
  }
  return { w, h, unit: resolved, seed, palette };
}

// What paint(ctx, plan, t) is given: a plan made by the same field and a finite t. Checked before ctx is touched.
export function checkPaint(field, plan, t) {
  if (!isPlainObject(plan) || plan.field !== field) throw new Error(`${field}.paint: expected a ${field} plan, got ${describePlan(plan)}`);
  if (!isFiniteNumber(t)) throw new Error(`${field}.paint: t must be a finite number, got ${t}`);
}

function describePlan(plan) {
  if (plan === null) return 'null';
  if (Array.isArray(plan)) return 'array';
  if (typeof plan !== 'object') return typeof plan;
  return typeof plan.field === 'string' ? plan.field : 'object';
}

// Runs draw(ctx) between save() and restore(), restoring even when a draw call throws, so a field
// leaves the caller's fillStyle and the like untouched. It deliberately does not reset the caller's
// transform, alpha or composite mode: the camera moves a field and a cut may fade it.
export function withSavedState(ctx, draw) {
  ctx.save();
  try {
    draw(ctx);
  } finally {
    ctx.restore();
  }
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

// One random stream per layer, so overriding one param never shifts the draws of another layer. Every
// layer of every field has its own index here, so two fields given the same seed are not correlated.
export const LAYERS = Object.freeze({ paperBlotches: 0, paperFibres: 1, paperSpecks: 2, paperGrain: 3, mesh: 4, halftone: 5 });
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

// An OffscreenCanvas and its 2d context, which is the field's own: transform, alpha and composite mode
// are set explicitly. It is the page (or a test fake) that provides the class.
export function createSurface(w, h) {
  if (typeof OffscreenCanvas !== 'function') throw new Error('OffscreenCanvas is not available here; fields paint through it');
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas could not give a 2d context');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  return { canvas, ctx };
}

// Paints the plan once into an offscreen canvas of the plan's size, keyed by the plan object, then blits
// it into the caller's context (inside the caller's transform, alpha and composite mode).
export function blitCached(ctx, cache, plan, build) {
  withSavedState(ctx, () => {
    let canvas = cache.get(plan);
    if (canvas === undefined) {
      const surface = createSurface(plan.w, plan.h);
      build(surface.ctx, plan);
      canvas = surface.canvas;
      cache.set(plan, canvas);
    }
    ctx.drawImage(canvas, 0, 0);
  });
}

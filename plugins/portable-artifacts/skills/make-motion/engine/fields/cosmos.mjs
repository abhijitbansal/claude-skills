// The "cosmos" field: a vertical gradient from the palette's deep navy (top) to its violet paper (bottom), a soft
// radial lift behind the hero area, two layers of seeded stars drifting at different slow speeds, and a faint vignette.
// plan() is pure data. paint() blits two cached still surfaces (the ground: gradient and lift; the vignette) around the
// stars, which it draws every frame where they have drifted to:
//   x(t) = wrap(x0 + vx * t, w), y(t) = wrap(y0 + vy * t, h)
// Each layer's stars sit one to a cell of a jittered grid, inset from the cell edges, and the whole grid moves rigidly
// and wraps at the field's (bled, off-screen) edges, so no two stars of a layer ever come closer than MIN_STAR_GAP and
// the density inside any text area stays bounded, at every t.
// paint draws inside the caller's transform, alpha and composite mode (the camera moves a field and a cut may fade it)
// and leaves no state behind: it sits between save() and restore(), and star alpha is in the fill colour, never in
// globalAlpha.
import { registries } from '../registry.mjs';
import { isHexColour, mix, parseHex, rgba } from './color.mjs';
import {
  TAU, checkInput, checkPaint, clean, createSurface, deepFreeze, layerRng, randInt, resolveParams, withSavedState,
} from './shared.mjs';

// Random streams of this field. shared.mjs LAYERS holds 0 to 5 (paper, mesh, halftone); these continue after it, so a
// cosmos film and a paper film with the same seed are not correlated.
const COSMOS_LAYERS = Object.freeze({ farStars: 6, nearStars: 7, drift: 8 });

// Sizes are in units (1 unit = short side / 1080); speeds in units per second. plan() scales them by `unit`.
const STAR_COUNT = [60, 140]; // per layer on REFERENCE_AREA, scaled by the field's area
const MAX_STARS = 200; // the `stars` param's ceiling (per layer, on REFERENCE_AREA)
const REFERENCE_AREA = 1920 * 1080; // square units: a 16:9 canvas
const JITTER_INSET = 0.2; // a star sits in the middle 60% of its cell, so two stars of a layer are 0.4 cell apart at least
const SIZE_WEIGHTS = Object.freeze([0.62, 0.28, 0.1]); // small, medium, large: most stars are the smallest
// far: small, faint and slow; near: a little larger, brighter and faster (parallax)
const LAYER_SPECS = Object.freeze([
  Object.freeze({ stream: COSMOS_LAYERS.farStars, speed: 4, radii: Object.freeze([0.8, 1.2, 1.8]), alpha: 0.45 }),
  Object.freeze({ stream: COSMOS_LAYERS.nearStars, speed: 9, radii: Object.freeze([1.1, 1.7, 2.6]), alpha: 0.72 }),
]);
export const MAX_STAR_RADIUS = 3; // units: stars are dots, never discs that read as marks
export const MAX_DRIFT_SPEED = 12; // units per second: a gentle float
export const MIN_STAR_GAP = 36; // units: the closest two stars of one layer may come (at MAX_STARS)
// The most stars (both layers) per million square units inside any text area a kind reports (the composition area,
// a hero block, the viral safe zone). STAR_COUNT's top on REFERENCE_AREA averages 135; a jittered grid adds at most a
// row and a column of cells at a rectangle's edges, so 175 holds with room (test/v2/cosmos-field.test.mjs).
export const STAR_CAP = 175;

// The lift: a radial glow of paper pushed toward ink2, left of centre where a flush-left hero sits.
const LIFT_AT = Object.freeze([0.38, 0.46]); // share of the field's width and height
const LIFT_RADIUS = 0.75; // share of the field's short side
const LIFT_MIX = 0.4; // how far the lift colour is pushed from paper toward ink2
const LIFT_ALPHA = 0.32; // at its centre
const LIFT_STOPS = Object.freeze([[0, 1], [0.45, 0.5], [1, 0]]); // [position along the radius, share of LIFT_ALPHA]
// The vignette: clear in the middle, palette.deep at the corners.
const VIGNETTE_INNER = 0.55; // share of the half diagonal that stays clear
const VIGNETTE_ALPHA = 0.35;
const HALF = 2;

const RULES = Object.freeze({ stars: { min: 0, max: MAX_STARS, int: true } });

// sRGB relative luminance, as WCAG defines it (shared/contrast.mjs is not served to the page).
const LINEAR_KNEE = 0.03928, LINEAR_SLOPE = 12.92, GAMMA_OFFSET = 0.055, GAMMA_SCALE = 1.055, GAMMA = 2.4;
const LUMA = Object.freeze([0.2126, 0.7152, 0.0722]);
const MAX_CHANNEL = 255;
function luminance(hex) {
  const linear = parseHex(hex).map((c) => {
    const s = c / MAX_CHANNEL;
    return s <= LINEAR_KNEE ? s / LINEAR_SLOPE : ((s + GAMMA_OFFSET) / GAMMA_SCALE) ** GAMMA;
  });
  return linear.reduce((sum, c, i) => sum + c * LUMA[i], 0);
}

// Fisher-Yates over 0..n-1, so a layer fills `count` cells of its grid chosen by the seed.
function shuffledCells(rng, n) {
  const out = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function sizeIndex(rng) {
  const draw = rng();
  let total = 0;
  for (let i = 0; i < SIZE_WEIGHTS.length; i += 1) {
    total += SIZE_WEIGHTS[i];
    if (draw < total) return i;
  }
  return SIZE_WEIGHTS.length - 1;
}

// One star layer: `count` stars, one to a cell of a cols x rows grid over the field, each [x, y, sizeIndex].
function planLayer(rng, spec, { w, h, unit }, count, heading) {
  const cols = Math.max(1, Math.round(Math.sqrt((count * w) / h)));
  const rows = Math.max(1, Math.ceil(count / cols));
  const cw = w / cols, ch = h / rows;
  const jitter = () => JITTER_INSET + rng() * (1 - HALF * JITTER_INSET);
  const stars = shuffledCells(rng, cols * rows).slice(0, count).map((cell) => {
    const col = cell % cols, row = Math.floor(cell / cols);
    return [(col + jitter()) * cw, (row + jitter()) * ch, sizeIndex(rng)];
  });
  return {
    vx: clean(Math.cos(heading) * spec.speed * unit), vy: clean(Math.sin(heading) * spec.speed * unit),
    alpha: spec.alpha, radii: spec.radii.map((r) => r * unit), stars,
  };
}

function planLift({ w, h }, palette, top, bottom) {
  const lift = {
    x: LIFT_AT[0] * w, y: LIFT_AT[1] * h, r: LIFT_RADIUS * Math.min(w, h),
    color: mix(palette.paper, palette.ink2, LIFT_MIX), alpha: LIFT_ALPHA,
  };
  // the lightest colour the field paints under text: the lift's centre over the gradient there, or the bottom
  const behindLift = mix(mix(top, bottom, lift.y / h), lift.color, lift.alpha);
  return { lift, peak: luminance(behindLift) > luminance(bottom) ? behindLift : bottom };
}

export function plan(input) {
  const { w, h, unit, seed, palette } = checkInput(input);
  if (!isHexColour(palette.deep)) throw new Error(`field "cosmos" needs palette.deep as #rrggbb (the gradient's top), got ${JSON.stringify(palette.deep)}`);
  const params = resolveParams('cosmos', input.params, RULES);
  const areaShare = ((w / unit) * (h / unit)) / REFERENCE_AREA;
  const heading = layerRng(seed, COSMOS_LAYERS.drift)() * TAU;
  const layers = LAYER_SPECS.map((spec) => {
    const rng = layerRng(seed, spec.stream);
    const drawn = randInt(rng, STAR_COUNT); // the count is always drawn first, as paper's are
    const count = Math.round((params.stars ?? drawn) * areaShare);
    return planLayer(rng, spec, { w, h, unit }, count, heading);
  });
  const top = palette.deep, bottom = palette.paper;
  const { lift, peak } = planLift({ w, h }, palette, top, bottom);
  return deepFreeze({
    field: 'cosmos', w, h, unit, top, bottom, lift, peak, starColor: palette.ink,
    vignette: { color: palette.deep, alpha: VIGNETTE_ALPHA, inner: VIGNETTE_INNER },
    layers,
  });
}

const wrap = (v, size) => ((v % size) + size) % size;

/** Every star of every layer at time t, as [[x, y, radius] per star] per layer, in the plan's pixels. */
export function starsAt(fieldPlan, t) {
  const { w, h } = fieldPlan;
  return fieldPlan.layers.map(({ vx, vy, radii, stars }) => stars.map(([x, y, size]) => [wrap(x + vx * t, w), wrap(y + vy * t, h), radii[size]]));
}

/** How many stars (both layers) have their centre inside `rect` ({ x, y, w, h }, the plan's pixels) at time t. */
export function starsIn(fieldPlan, rect, t) {
  const inside = ([x, y]) => x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
  return starsAt(fieldPlan, t).reduce((sum, layer) => sum + layer.filter(inside).length, 0);
}

function buildGround(c, p) {
  const gradient = c.createLinearGradient(0, 0, 0, p.h);
  gradient.addColorStop(0, p.top);
  gradient.addColorStop(1, p.bottom);
  c.fillStyle = gradient;
  c.fillRect(0, 0, p.w, p.h);
  const { x, y, r, color, alpha } = p.lift;
  const glow = c.createRadialGradient(x, y, 0, x, y, r);
  for (const [at, share] of LIFT_STOPS) glow.addColorStop(at, rgba(color, alpha * share));
  c.fillStyle = glow;
  c.fillRect(0, 0, p.w, p.h);
}

function buildVignette(c, p) {
  const cx = p.w / HALF, cy = p.h / HALF, reach = Math.hypot(cx, cy);
  const shade = c.createRadialGradient(cx, cy, reach * p.vignette.inner, cx, cy, reach);
  shade.addColorStop(0, rgba(p.vignette.color, 0));
  shade.addColorStop(1, rgba(p.vignette.color, p.vignette.alpha));
  c.fillStyle = shade;
  c.fillRect(0, 0, p.w, p.h);
}

const cache = new WeakMap();

// The plan's two still surfaces, built on first use and kept for the plan's life.
function stillsOf(p) {
  if (!cache.has(p)) {
    const ground = createSurface(p.w, p.h), vignette = createSurface(p.w, p.h);
    buildGround(ground.ctx, p);
    buildVignette(vignette.ctx, p);
    cache.set(p, { ground: ground.canvas, vignette: vignette.canvas });
  }
  return cache.get(p);
}

// One batched path per layer and size: six fills a frame however many stars there are.
function drawStars(c, p, t) {
  const now = starsAt(p, t);
  p.layers.forEach((layer, li) => {
    c.fillStyle = rgba(p.starColor, layer.alpha);
    layer.radii.forEach((radius, size) => {
      c.beginPath();
      now[li].forEach(([x, y], i) => {
        if (layer.stars[i][2] !== size) return;
        c.moveTo(x + radius, y);
        c.arc(x, y, radius, 0, TAU);
      });
      c.fill();
    });
  });
}

export function paint(ctx, fieldPlan, t) {
  checkPaint('cosmos', fieldPlan, t);
  withSavedState(ctx, (c) => {
    const stills = stillsOf(fieldPlan);
    c.drawImage(stills.ground, 0, 0);
    drawStars(c, fieldPlan, t);
    c.drawImage(stills.vignette, 0, 0);
  });
}

registries.fields.add('cosmos', {
  summary: 'Deep navy to violet with a soft lift behind the hero, two layers of seeded stars drifting slowly, and a faint vignette.',
  animated: true, plan, paint,
});

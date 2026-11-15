// The "mesh" field: a paper base with 4 to 6 large soft colour blobs that sway slowly. plan() is pure
// data; paint() redraws every frame because each blob moves on a closed path around its base position:
//   x = x + ampX * sin(2pi * t / period + phase)
//   y = y + ampY * sin(2pi * t / (period * ratio) + phase2)
// so a blob never leaves its amplitude of the base, however long the shot runs.
// paint draws inside the caller's transform, alpha and composite mode (the camera moves a field and a
// cut may fade it) and leaves no state behind: it sits between save() and restore().
import { registries } from '../registry.mjs';
import { mix, rgba } from './color.mjs';
import {
  LAYERS, TAU, checkInput, checkPaint, deepFreeze, layerRng, randInt, randRange, resolveParams, withSavedState,
} from './shared.mjs';

// Sizes are in units (1 unit = short side / 1080); plan() scales lengths by `unit`. Periods are seconds.
const BLOB_COUNT = [4, 6];
const BLOB_RADIUS = [500, 900];
const SWAY_AMPLITUDE = [20, 60];
const SWAY_PERIOD = [9, 17];
const SWAY_RATIO = [1.2, 1.6]; // y period / x period, so the path is a slow Lissajous loop, not a line
const DEFAULT_STRENGTH = 0.6;
const MIX_TOWARD_PAPER = 0.5;
const MAX_BLOBS = 8;
const DIAMETER = 2; // diameter in radii
// A gaussian-ish falloff: [position along the radius, share of the blob alpha].
const BLOB_STOPS = Object.freeze([[0, 1], [0.2, 0.88], [0.45, 0.55], [0.7, 0.2], [1, 0]]);

const RULES = Object.freeze({
  blobs: { min: 1, max: MAX_BLOBS, int: true },
  strength: { min: 0, max: 1 },
});

const colourPool = ({ paper, accent, accent2, ink2 }) => [
  accent, accent2, ink2,
  mix(accent, paper, MIX_TOWARD_PAPER), mix(accent2, paper, MIX_TOWARD_PAPER), mix(ink2, paper, MIX_TOWARD_PAPER),
];

// Fisher-Yates over a copy, so the first blobs get distinct colours before any repeat.
function shuffled(rng, list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function planBlob(rng, { w, h, unit }, color) {
  const x = rng() * w, y = rng() * h, r = randRange(rng, BLOB_RADIUS) * unit;
  return {
    x, y, r, color,
    ampX: randRange(rng, SWAY_AMPLITUDE) * unit, ampY: randRange(rng, SWAY_AMPLITUDE) * unit,
    period: randRange(rng, SWAY_PERIOD), ratio: randRange(rng, SWAY_RATIO),
    phase: rng() * TAU, phase2: rng() * TAU,
  };
}

export function plan(input) {
  const { w, h, unit, seed, palette } = checkInput(input);
  const params = resolveParams('mesh', input.params, RULES);
  const rng = layerRng(seed, LAYERS.mesh);
  const drawn = randInt(rng, BLOB_COUNT);
  const colours = shuffled(rng, colourPool(palette));
  const blobs = Array.from({ length: params.blobs ?? drawn }, (_, i) => planBlob(rng, { w, h, unit }, colours[i % colours.length]));
  return deepFreeze({ field: 'mesh', w, h, unit, background: palette.paper, alpha: params.strength ?? DEFAULT_STRENGTH, blobs });
}

function blobCentre(b, t) {
  return [
    b.x + b.ampX * Math.sin((TAU * t) / b.period + b.phase),
    b.y + b.ampY * Math.sin((TAU * t) / (b.period * b.ratio) + b.phase2),
  ];
}

function drawMesh(ctx, p, t) {
  ctx.fillStyle = p.background;
  ctx.fillRect(0, 0, p.w, p.h);
  for (const b of p.blobs) {
    const [x, y] = blobCentre(b, t);
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, b.r);
    for (const [at, share] of BLOB_STOPS) gradient.addColorStop(at, rgba(b.color, p.alpha * share));
    ctx.fillStyle = gradient;
    ctx.fillRect(x - b.r, y - b.r, b.r * DIAMETER, b.r * DIAMETER);
  }
}

export function paint(ctx, fieldPlan, t) {
  checkPaint('mesh', fieldPlan, t);
  withSavedState(ctx, () => drawMesh(ctx, fieldPlan, t));
}

registries.fields.add('mesh', { summary: 'A paper base with a few large soft colour blobs that sway slowly.', plan, paint });

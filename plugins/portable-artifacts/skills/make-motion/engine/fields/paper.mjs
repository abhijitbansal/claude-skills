// The "paper" field: a flat tint, soft blotches, thin curved fibres, a few specks and a noise tile, so
// the surface reads as warm stock rather than noise. plan() is pure data; paint() draws it once into a
// cached offscreen canvas and blits that on every later call (paper never changes with t).
// paint draws inside the caller's transform, alpha and composite mode (the camera moves a field and a
// cut may fade it) and leaves no state behind: the blit sits between save() and restore().
import { mulberry32 } from '../seeded.mjs';
import { registries } from '../registry.mjs';
import { mix, rgba } from './color.mjs';
import {
  LAYERS, TAU, blitCached, checkInput, checkPaint, createSurface, deepFreeze, layerRng, randInt, randRange, resolveParams,
} from './shared.mjs';

// Counts and sizes below are in units (1 unit = short side / 1080); lengths are scaled by `unit` in plan().
// Alphas are above the first-draft 3% / 5% / 4%: at 1:1 those left fibres and blotches invisible.
const BLOTCH_COUNT = [8, 14];
const BLOTCH_RADIUS = [150, 450];
const BLOTCH_ALPHA = 0.07;
const BLOTCH_LIGHT_SHARE = 0.5; // share of blotches that are lighter than the paper rather than darker
const FIBRE_COUNT = [2000, 4000];
const FIBRE_LENGTH = [4, 14];
const FIBRE_WIDTH = 1;
const FIBRE_BEND = 0.25; // sideways bow of the curve, as a share of the fibre length, either way
const FIBRE_ALPHA = 0.2;
const LIGHT_FIBRE_SHARE = 0.3;
const SPECK_COUNT = [40, 120];
const SPECK_RADIUS = [0.5, 1.4];
const SPECK_ALPHA = 0.18;
const GRAIN_TILE = 256;
const GRAIN_ALPHA = 0.06;
const GRAIN_LEVELS = 8;
const GRAIN_SEED_RANGE = 2 ** 32;
const MAX_CHANNEL = 255;
const CHANNELS_PER_PIXEL = 4;
const MAX_COUNT = 20000;
const HALF = 2;
const DIAMETER = 2; // diameter in radii

// How far paper is pushed toward ink2 / ink (dark) or white (light) for each layer's colour.
const WHITE = '#ffffff';
const BLOTCH_DARK_MIX = 0.5, BLOTCH_LIGHT_MIX = 0.6;
const FIBRE_DARK_MIX = 0.6, FIBRE_LIGHT_MIX = 0.7;
const SPECK_MIX = 0.7;

const DARK = 0, LIGHT = 1; // fibre and blotch tones

const RULES = Object.freeze({
  blotches: { min: 0, max: MAX_COUNT, int: true },
  blotchAlpha: { min: 0, max: 1 },
  fibres: { min: 0, max: MAX_COUNT, int: true },
  fibreAlpha: { min: 0, max: 1 },
  specks: { min: 0, max: MAX_COUNT, int: true },
  grainAlpha: { min: 0, max: 1 },
});

// The count is always drawn first so an override changes how many items there are, not what they look like.
function planBlotches(rng, { w, h, unit }, tones, override) {
  const drawn = randInt(rng, BLOTCH_COUNT);
  return Array.from({ length: override ?? drawn }, () => {
    const x = rng() * w, y = rng() * h, r = randRange(rng, BLOTCH_RADIUS) * unit;
    return { x, y, r, color: tones[rng() < BLOTCH_LIGHT_SHARE ? LIGHT : DARK] };
  });
}

function planFibres(rng, { w, h, unit }, override) {
  const drawn = randInt(rng, FIBRE_COUNT);
  return Array.from({ length: override ?? drawn }, () => {
    const x = rng() * w, y = rng() * h, len = randRange(rng, FIBRE_LENGTH) * unit;
    const angle = rng() * TAU, bend = randRange(rng, [-FIBRE_BEND, FIBRE_BEND]);
    return [x, y, len, angle, bend, rng() < LIGHT_FIBRE_SHARE ? LIGHT : DARK];
  });
}

function planSpecks(rng, { w, h, unit }, override) {
  const drawn = randInt(rng, SPECK_COUNT);
  return Array.from({ length: override ?? drawn }, () => [rng() * w, rng() * h, randRange(rng, SPECK_RADIUS) * unit]);
}

export function plan(input) {
  const { w, h, unit, seed, palette } = checkInput(input);
  const params = resolveParams('paper', input.params, RULES);
  const dims = { w, h, unit };
  const blotchTones = [mix(palette.paper, palette.ink2, BLOTCH_DARK_MIX), mix(palette.paper, WHITE, BLOTCH_LIGHT_MIX)];
  return deepFreeze({
    field: 'paper', w, h, unit, tint: palette.paper,
    blotches: planBlotches(layerRng(seed, LAYERS.paperBlotches), dims, blotchTones, params.blotches),
    blotchAlpha: params.blotchAlpha ?? BLOTCH_ALPHA,
    fibres: planFibres(layerRng(seed, LAYERS.paperFibres), dims, params.fibres),
    fibreAlpha: params.fibreAlpha ?? FIBRE_ALPHA,
    fibreWidth: FIBRE_WIDTH * unit,
    fibreColors: [mix(palette.paper, palette.ink2, FIBRE_DARK_MIX), mix(palette.paper, WHITE, FIBRE_LIGHT_MIX)],
    specks: planSpecks(layerRng(seed, LAYERS.paperSpecks), dims, params.specks),
    speckAlpha: SPECK_ALPHA,
    speckColor: mix(palette.paper, palette.ink, SPECK_MIX),
    grain: {
      seed: Math.floor(layerRng(seed, LAYERS.paperGrain)() * GRAIN_SEED_RANGE),
      size: GRAIN_TILE, scale: unit, alpha: params.grainAlpha ?? GRAIN_ALPHA,
    },
  });
}

function paintBlotches(c, p) {
  for (const { x, y, r, color } of p.blotches) {
    const gradient = c.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, rgba(color, p.blotchAlpha));
    gradient.addColorStop(1, rgba(color, 0));
    c.fillStyle = gradient;
    c.fillRect(x - r, y - r, r * DIAMETER, r * DIAMETER);
  }
}

function paintFibres(c, p) {
  c.lineWidth = p.fibreWidth;
  c.lineCap = 'round';
  c.globalAlpha = p.fibreAlpha;
  for (const [x, y, len, angle, bend, tone] of p.fibres) {
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const ex = x + cos * len, ey = y + sin * len;
    c.strokeStyle = p.fibreColors[tone];
    c.beginPath();
    c.moveTo(x, y);
    c.quadraticCurveTo((x + ex) / HALF - sin * len * bend, (y + ey) / HALF + cos * len * bend, ex, ey);
    c.stroke();
  }
  c.globalAlpha = 1;
}

function paintSpecks(c, p) {
  c.fillStyle = p.speckColor;
  c.globalAlpha = p.speckAlpha;
  c.beginPath();
  for (const [x, y, r] of p.specks) {
    c.moveTo(x + r, y);
    c.arc(x, y, r, 0, TAU);
  }
  c.fill();
  c.globalAlpha = 1;
}

// A GRAIN_TILE-pixel tile of grey noise in GRAIN_LEVELS steps at the grain alpha, written with one
// ImageData. It is drawn repeated at tile size * unit so the grain keeps its physical size on every canvas.
function drawGrainTile(grain, rng) {
  const { canvas, ctx } = createSurface(grain.size, grain.size);
  const image = ctx.createImageData(grain.size, grain.size);
  const alpha = Math.round(grain.alpha * MAX_CHANNEL);
  const pixels = image.data;
  for (let i = 0; i < pixels.length; i += CHANNELS_PER_PIXEL) {
    const level = Math.floor(rng() * GRAIN_LEVELS);
    const grey = Math.round((level * MAX_CHANNEL) / (GRAIN_LEVELS - 1));
    pixels[i] = grey;
    pixels[i + 1] = grey;
    pixels[i + 2] = grey;
    pixels[i + 3] = alpha;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function paintGrain(c, p) {
  const tile = drawGrainTile(p.grain, mulberry32(p.grain.seed));
  const step = p.grain.size * p.grain.scale;
  c.imageSmoothingEnabled = false;
  for (let y = 0; y < p.h; y += step) {
    for (let x = 0; x < p.w; x += step) c.drawImage(tile, x, y, step, step);
  }
}

function buildPaper(c, p) {
  c.fillStyle = p.tint;
  c.fillRect(0, 0, p.w, p.h);
  paintBlotches(c, p);
  paintFibres(c, p);
  paintSpecks(c, p);
  paintGrain(c, p);
}

const cache = new WeakMap();

// t is checked but not used: paper does not change over time.
export function paint(ctx, fieldPlan, t) {
  checkPaint('paper', fieldPlan, t);
  blitCached(ctx, cache, fieldPlan, buildPaper);
}

registries.fields.add('paper', { summary: 'Warm paper stock: a flat tint, soft blotches, thin fibres and a few specks.', animated: false, plan, paint });

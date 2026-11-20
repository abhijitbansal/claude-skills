// The "halftone" field: dots on a rotated grid over a flat paper colour, their area shrinking along a
// falloff line across the canvas. plan() is pure data; paint() draws once into a cached offscreen canvas
// and blits it afterwards (halftone never changes with t).
// paint draws inside the caller's transform, alpha and composite mode (the camera moves a field and a
// cut may fade it) and leaves no state behind: the blit sits between save() and restore().
import { registries } from '../registry.mjs';
import { mix } from './color.mjs';
import {
  LAYERS, TAU, blitCached, checkInput, checkPaint, clean, deepFreeze, layerRng, randRange, resolveParams,
} from './shared.mjs';

// Sizes are in units (1 unit = short side / 1080); plan() scales them by `unit`.
const DEFAULT_CELL = 22;
const ANGLE_RANGE = [15, 75]; // degrees
const DEFAULT_STRENGTH = 0.45; // how far the dot colour is pushed from paper toward its palette colour
const DEFAULT_COLOR = 'accent';
const DOT_FILL = 0.9; // the largest dot spans this share of a cell, so neighbours never touch
const MIN_DOT_RADIUS = 0.35; // dots thinner than this many units are not drawn
const DEGREES_TO_RADIANS = Math.PI / 180;
const HALF = 2;
const COLOR_KEYS = Object.freeze(['ink', 'ink2', 'accent', 'accent2', 'rule']);

const RULES = Object.freeze({
  cell: { min: 4, max: 200 },
  angle: { min: -360, max: 360 },
  color: { choices: COLOR_KEYS },
  strength: { min: 0, max: 1 },
});

// A line through the canvas centre that spans the whole canvas along its direction: dots are full size
// at (x0, y0) and vanish at (x1, y1).
function planFalloff(rng, w, h) {
  const heading = rng() * TAU, dx = Math.cos(heading), dy = Math.sin(heading);
  const half = (Math.abs(dx) * w + Math.abs(dy) * h) / HALF;
  const cx = w / HALF, cy = h / HALF;
  return { x0: clean(cx - dx * half), y0: clean(cy - dy * half), x1: clean(cx + dx * half), y1: clean(cy + dy * half) };
}

export function plan(input) {
  const { w, h, unit, seed, palette } = checkInput(input);
  const params = resolveParams('halftone', input.params, RULES);
  const rng = layerRng(seed, LAYERS.halftone);
  const drawnAngle = randRange(rng, ANGLE_RANGE);
  const cell = (params.cell ?? DEFAULT_CELL) * unit;
  return deepFreeze({
    field: 'halftone', w, h, unit, cell,
    angle: params.angle ?? drawnAngle,
    color: mix(palette.paper, palette[params.color ?? DEFAULT_COLOR], params.strength ?? DEFAULT_STRENGTH),
    background: palette.paper,
    maxRadius: (cell * DOT_FILL) / HALF,
    minRadius: MIN_DOT_RADIUS * unit,
    falloff: planFalloff(rng, w, h),
  });
}

// Calls draw(x, y, r) for every visible dot. The grid is centred on the canvas, turned by the plan angle
// and big enough to cover the canvas corners.
function forEachDot(p, draw) {
  const angle = p.angle * DEGREES_TO_RADIANS, cos = Math.cos(angle), sin = Math.sin(angle);
  const cx = p.w / HALF, cy = p.h / HALF;
  const reach = Math.ceil(Math.hypot(p.w, p.h) / HALF / p.cell) + 1;
  const { x0, y0, x1, y1 } = p.falloff;
  const length2 = (x1 - x0) ** 2 + (y1 - y0) ** 2;
  for (let i = -reach; i <= reach; i += 1) {
    for (let j = -reach; j <= reach; j += 1) {
      const x = cx + (i * cos - j * sin) * p.cell, y = cy + (i * sin + j * cos) * p.cell;
      if (x < -p.maxRadius || x > p.w + p.maxRadius || y < -p.maxRadius || y > p.h + p.maxRadius) continue;
      const along = Math.min(1, Math.max(0, ((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / length2));
      const r = p.maxRadius * Math.sqrt(1 - along); // dot area follows the tone, so radius follows its square root
      if (r >= p.minRadius) draw(x, y, r);
    }
  }
}

function buildHalftone(c, p) {
  c.fillStyle = p.background;
  c.fillRect(0, 0, p.w, p.h);
  c.fillStyle = p.color;
  c.beginPath();
  forEachDot(p, (x, y, r) => {
    c.moveTo(x + r, y);
    c.arc(x, y, r, 0, TAU);
  });
  c.fill();
}

const cache = new WeakMap();

// t is checked but not used: halftone does not change over time.
export function paint(ctx, fieldPlan, t) {
  checkPaint('halftone', fieldPlan, t);
  blitCached(ctx, cache, fieldPlan, buildHalftone);
}

registries.fields.add('halftone', { summary: 'Dots on a rotated grid over a flat colour, shrinking along a falloff line across the frame.', animated: false, plan, paint });

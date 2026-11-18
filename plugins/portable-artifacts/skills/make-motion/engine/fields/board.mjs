// The "board" field (marker): a whiteboard. The palette's paper as the board, a faint seeded sheen (one broad band of
// the rule colour at a low alpha, its angle and place from the seed, so two films differ and one film never does) and a
// frame in the rule colour `FRAME` units wide at half the margin. Still (animated: false), so a held frame is reused.
// The frame sits on the canvas's own margin (the field is bled past the canvas, see grid.mjs canvasSide), and the sheen
// is generated from the seed alone: no image, no network. plan() is pure data; paint() draws it once into a cached
// offscreen canvas and blits that after.
import { registries } from '../registry.mjs';
import { mulberry32 } from '../seeded.mjs';
import { checkInput, checkPaint, blitCached, deepFreeze, resolveParams, TAU } from './shared.mjs';
import { canvasSide } from './grid.mjs';

const FRAME = 6; // units: the board's frame
const HALF = 2;
const MAX_UNITS = 400;
const SEED_SALT = 0x2b7e15;
const SHEEN_BANDS = 2; // broad pale bands across the board
const SHEEN_SPAN = Object.freeze({ min: 0.18, max: 0.34 }); // of the board's long side
const ANGLE_FROM = -0.5; // rad: the bands lean this way at most
const ANGLE_SPAN = 1;

const RULES = Object.freeze({
  margin: { min: 0, max: MAX_UNITS },
  marginTall: { min: 0, max: MAX_UNITS },
  sheen: { min: 0, max: 1 },
});
const NEEDED = Object.freeze(Object.keys(RULES));

export function plan(input) {
  const { w, h, unit, seed, palette } = checkInput(input);
  const params = resolveParams('board', input.params, RULES);
  const missing = NEEDED.filter((name) => params[name] === undefined);
  if (missing.length > 0) throw new Error(`field "board" needs params ${missing.join(', ')} (the look's margin per format and the sheen's strength)`);
  const cw = canvasSide(w), ch = canvasSide(h);
  const margin = (cw > ch ? params.margin : params.marginTall) * unit;
  const x0 = (w - cw) / HALF, y0 = (h - ch) / HALF;
  const rng = mulberry32(((seed ?? 0) ^ SEED_SALT) >>> 0);
  const long = Math.max(w, h);
  const bands = Array.from({ length: SHEEN_BANDS }, () => ({
    angle: ANGLE_FROM + rng() * ANGLE_SPAN,
    at: [rng(), rng()],
    span: (SHEEN_SPAN.min + rng() * (SHEEN_SPAN.max - SHEEN_SPAN.min)) * long,
  }));
  const inset = margin / HALF;
  return deepFreeze({
    field: 'board', w, h, unit, tint: palette.paper, rule: palette.rule, sheen: params.sheen, bands,
    frame: { x: x0 + inset, y: y0 + inset, w: cw - HALF * inset, h: ch - HALF * inset, width: FRAME * unit },
  });
}

function buildBoard(c, p) {
  c.fillStyle = p.tint;
  c.fillRect(0, 0, p.w, p.h);
  c.fillStyle = p.rule;
  for (const band of p.bands) {
    const cx = band.at[0] * p.w, cy = band.at[1] * p.h;
    const dx = Math.cos(band.angle + TAU / 4) * band.span, dy = Math.sin(band.angle + TAU / 4) * band.span;
    const gradient = c.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    gradient.addColorStop(0, 'rgba(228,228,223,0)');
    gradient.addColorStop(0.5, p.rule);
    gradient.addColorStop(1, 'rgba(228,228,223,0)');
    c.globalAlpha = p.sheen;
    c.fillStyle = gradient;
    c.fillRect(0, 0, p.w, p.h);
  }
  c.globalAlpha = 1;
  c.strokeStyle = p.rule;
  c.lineWidth = p.frame.width;
  c.strokeRect(p.frame.x, p.frame.y, p.frame.w, p.frame.h);
}

const cache = new WeakMap();

// t is checked but not used: the board does not change over time.
export function paint(ctx, fieldPlan, t) {
  checkPaint('board', fieldPlan, t);
  blitCached(ctx, cache, fieldPlan, buildBoard);
}

registries.fields.add('board', { summary: 'A whiteboard: the paper as the board, a faint seeded sheen and a thin frame.', animated: false, plan, paint });

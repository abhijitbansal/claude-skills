// The "flat" field (poster): one flat ground (the palette's paper, which engine/looks/grounds.mjs sets to the shot's
// ground), the twelve column edges as hairlines in the palette's rule colour (the ground's second permitted colour) at
// `alpha`, and at most two cut-paper shapes from the seed: a bar across the frame and a circle off a corner, each in
// the palette's accent with a misregistered copy in its ink set MISREGISTER units down and right under it. The shapes
// keep clear of `clear` (the text area, [x, y, w, h] in canvas pixels, given by the film: engine/graph/film.mjs), or of
// the margins when it is absent; a shape with too little room is left out. It is still (animated: false), so a held
// frame is reused. plan() is pure data; paint() draws it once into a cached offscreen canvas and blits that after.
import { registries } from '../registry.mjs';
import { checkInput, checkPaint, blitCached, deepFreeze, resolveParams, TAU } from './shared.mjs';
import { mulberry32 } from '../seeded.mjs';
import { canvasSide, columnEdges } from './grid.mjs';

const HAIRLINE = 1; // units
const HALF = 2;
const MAX_UNITS = 400;
const MISREGISTER = 3; // units: the copy's offset
const GAP = 12; // units a shape keeps from the text area
const BAR = Object.freeze({ min: 14, max: 64 }); // units thick
const CIRCLE = Object.freeze({ min: 28, max: 220, out: 0.5 }); // radius in units; the centre sits `out` radii past the corner
const SEED_SALT = 0x5f3a91;

const RULES = Object.freeze({
  margin: { min: 0, max: MAX_UNITS },
  gutter: { min: 0, max: MAX_UNITS },
  marginTall: { min: 0, max: MAX_UNITS },
  gutterTall: { min: 0, max: MAX_UNITS },
  alpha: { min: 0, max: 1 },
});
const NEEDED = Object.freeze(Object.keys(RULES));

// The text area in canvas pixels: `clear` when given (four finite numbers), else the margins inset.
function clearRect(clear, cw, ch, margin) {
  if (clear === undefined) return [margin, margin, cw - HALF * margin, ch - HALF * margin];
  if (!Array.isArray(clear) || clear.length !== 4 || !clear.every(Number.isFinite)) {
    throw new Error(`field "flat": params.clear must be [x, y, w, h] in canvas pixels, got ${JSON.stringify(clear)}`);
  }
  return clear;
}

// A bar across the whole field in the larger of the rooms above and below the text area, centred in it.
function barShape(rng, [, cy, , chh], cw, ch, unit, [x0, y0, w]) {
  const top = cy, bottom = ch - (cy + chh);
  const side = top === bottom ? (rng() < 1 / HALF ? 'top' : 'bottom') : top > bottom ? 'top' : 'bottom';
  const room = (side === 'top' ? top : bottom) - GAP * unit;
  const thick = Math.min(BAR.max * unit, room * (1 / HALF));
  if (thick < BAR.min * unit) return null;
  const y = side === 'top' ? (room - thick) / HALF : ch - room + (room - thick) / HALF;
  return { kind: 'bar', box: [0, y0 + y, w, thick] };
}

// A circle off one corner whose box keeps clear of the text area on one axis at least.
function circleShape(rng, [cx, cy, cww, chh], cw, ch, unit, [x0, y0]) {
  const corner = Math.floor(rng() * 4);
  const right = corner % HALF === 1, low = corner >= HALF;
  const roomX = right ? cw - (cx + cww) : cx, roomY = low ? ch - (cy + chh) : cy;
  const r = Math.min(CIRCLE.max * unit, (Math.max(roomX, roomY) - GAP * unit) / (1 - CIRCLE.out));
  if (r < CIRCLE.min * unit) return null;
  const px = right ? cw + CIRCLE.out * r : -CIRCLE.out * r;
  const py = low ? ch + CIRCLE.out * r : -CIRCLE.out * r;
  return { kind: 'circle', cx: x0 + px, cy: y0 + py, r, box: [x0 + px - r, y0 + py - r, HALF * r, HALF * r] };
}

export function plan(input) {
  const { w, h, unit, seed, palette } = checkInput(input);
  const { clear: given, ...rest } = input.params ?? {}; // clear: the film's text area, checked by clearRect
  const params = resolveParams('flat', rest, RULES);
  const missing = NEEDED.filter((name) => params[name] === undefined);
  if (missing.length > 0) throw new Error(`field "flat" needs params ${missing.join(', ')} (the look's grid per format and the hairline alpha)`);
  const cw = canvasSide(w), ch = canvasSide(h);
  const wide = cw > ch;
  const margin = (wide ? params.margin : params.marginTall) * unit;
  const gutter = (wide ? params.gutter : params.gutterTall) * unit;
  const x0 = (w - cw) / HALF, y0 = (h - ch) / HALF;
  const clear = clearRect(given, cw, ch, margin);
  const rng = mulberry32(((seed ?? 0) ^ SEED_SALT) >>> 0);
  const shapes = [barShape(rng, clear, cw, ch, unit, [x0, y0, w]), circleShape(rng, clear, cw, ch, unit, [x0, y0])].filter(Boolean);
  return deepFreeze({
    field: 'flat', w, h, unit, tint: palette.paper, rule: palette.rule, alpha: params.alpha, width: HAIRLINE * unit,
    lines: columnEdges(cw, margin, gutter).map((x) => x0 + x), shapes, fill: palette.accent, copy: palette.ink, offset: MISREGISTER * unit,
  });
}

function drawShape(c, s, dx) {
  if (s.kind === 'bar') {
    c.fillRect(s.box[0] + dx, s.box[1] + dx, s.box[2], s.box[3]);
    return;
  }
  c.beginPath();
  c.arc(s.cx + dx, s.cy + dx, s.r, 0, TAU);
  c.fill();
}

function buildFlat(c, p) {
  c.fillStyle = p.tint;
  c.fillRect(0, 0, p.w, p.h);
  c.globalAlpha = p.alpha;
  c.fillStyle = p.rule;
  for (const x of p.lines) c.fillRect(Math.round(x - p.width / HALF), 0, Math.max(1, Math.round(p.width)), p.h);
  c.globalAlpha = 1;
  for (const s of p.shapes) {
    c.fillStyle = p.copy;
    drawShape(c, s, p.offset);
    c.fillStyle = p.fill;
    drawShape(c, s, 0);
  }
}

const cache = new WeakMap();

// t is checked but not used: the ground does not change over time.
export function paint(ctx, fieldPlan, t) {
  checkPaint('flat', fieldPlan, t);
  blitCached(ctx, cache, fieldPlan, buildFlat);
}

registries.fields.add('flat', { summary: 'One flat ground with the column edges as hairlines and at most two cut-paper shapes clear of the text.', animated: false, plan, paint });

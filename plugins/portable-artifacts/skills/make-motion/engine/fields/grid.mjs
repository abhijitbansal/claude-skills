// The "grid" field (ledger): flat paper with a vertical hairline on each of the twelve column starts and the right
// margin, and a baseline rule along the bottom margin, in the rule colour. Nothing else: no texture, no grain. It is
// still (animated: false), so a held frame is reused. The hairlines land on the canvas's own grid: the field is bled
// past the canvas (FIELD_BLEED), so plan() finds the canvas inside its size and the grid of its format (the look's grid
// on a wide frame, its tall grid otherwise, given as params). plan() is pure data; paint() draws it once into a cached
// offscreen canvas and blits that on every later call.
import { registries } from '../registry.mjs';
import { checkInput, checkPaint, blitCached, deepFreeze, resolveParams, FIELD_BLEED } from './shared.mjs';

const COLUMNS = 12;
const HAIRLINE = 1; // units
const HALF = 2;
const MAX_UNITS = 400; // a margin or gutter in units at most

const RULES = Object.freeze({
  margin: { min: 0, max: MAX_UNITS },
  gutter: { min: 0, max: MAX_UNITS },
  marginTall: { min: 0, max: MAX_UNITS },
  gutterTall: { min: 0, max: MAX_UNITS },
  alpha: { min: 0, max: 1 },
});
const NEEDED = Object.freeze(Object.keys(RULES));

// The canvas side a bled side of `size` px was made from (kinds/shared.mjs fieldNode rounds side * (1 + 2 bleed)): the
// whole number nearest size / (1 + 2 bleed) that rounds back to it, so the hairlines sit on the canvas's own columns.
export function canvasSide(size) {
  const grow = 1 + HALF * FIELD_BLEED;
  const guess = Math.round(size / grow);
  const near = [guess, guess - 1, guess + 1].find((side) => Math.round(side * grow) === size);
  return near ?? size / grow;
}

// The x of each column start (1 to 12) and the right margin edge on a canvas `w` wide, in canvas pixels.
function columnEdges(w, margin, gutter) {
  const column = (w - HALF * margin - (COLUMNS - 1) * gutter) / COLUMNS;
  return [...Array.from({ length: COLUMNS }, (_, i) => margin + i * (column + gutter)), w - margin];
}

export function plan(input) {
  const { w, h, unit, palette } = checkInput(input);
  const params = resolveParams('grid', input.params, RULES);
  const missing = NEEDED.filter((name) => params[name] === undefined);
  if (missing.length > 0) throw new Error(`field "grid" needs params ${missing.join(', ')} (the look's grid per format and the hairline alpha)`);
  const cw = canvasSide(w), ch = canvasSide(h);
  const wide = cw > ch;
  const margin = (wide ? params.margin : params.marginTall) * unit;
  const gutter = (wide ? params.gutter : params.gutterTall) * unit;
  const x0 = (w - cw) / HALF, y0 = (h - ch) / HALF;
  const lines = columnEdges(cw, margin, gutter).map((x) => x0 + x);
  return deepFreeze({
    field: 'grid', w, h, unit, tint: palette.paper, rule: palette.rule, alpha: params.alpha, width: HAIRLINE * unit,
    lines, baseline: y0 + ch - margin, from: lines[0], to: lines.at(-1),
  });
}

function buildGrid(c, p) {
  c.fillStyle = p.tint;
  c.fillRect(0, 0, p.w, p.h);
  c.globalAlpha = p.alpha;
  c.fillStyle = p.rule;
  // hairlines as filled rectangles, so a 1-unit line stays one crisp pixel wide at unit 1
  for (const x of p.lines) c.fillRect(Math.round(x - p.width / HALF), 0, Math.max(1, Math.round(p.width)), p.h);
  c.fillRect(Math.round(p.from), Math.round(p.baseline - p.width / HALF), Math.round(p.to - p.from), Math.max(1, Math.round(p.width)));
  c.globalAlpha = 1;
}

const cache = new WeakMap();

// t is checked but not used: the grid does not change over time.
export function paint(ctx, fieldPlan, t) {
  checkPaint('grid', fieldPlan, t);
  blitCached(ctx, cache, fieldPlan, buildGrid);
}

registries.fields.add('grid', { summary: 'Flat paper with a hairline on each column edge and a baseline rule: a newsroom page grid.', animated: false, plan, paint });

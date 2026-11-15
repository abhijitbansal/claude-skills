// The hand marks: `underline`, `circle`, `arrow` and `bracket`. Each is one stroked path node that draws on
// (`draw` 0 to 1). In a hand look (desk) the path runs through control points moved by seeded offsets and is drawn
// as one continuous pen stroke that overshoots the target a little, stepping at the look's frame rate; in a crisp
// look (pop) it is exact geometry with butt ends. The wobble is baked into `d` (not the draw layer's `rough`), so a
// different seed draws a different mark. Pure and DOM-free.
import { node } from '../graph/node.mjs';
import {
  checkParams, isHand, styleOf, colourOf, deviceRng, spread, landing, polyline, smoothPath, at2, styledBy,
} from './shared.mjs';

const TAU = Math.PI * 2;
const DEGREES = Math.PI / 180;
const DEFAULT_WIDTH = 6; // units, when the look does not style the mark
const UNDERLINE_GAP = 6; // units below the box
const UNDERLINE_POINTS = 9;
const UNDERLINE_WAVES = 2;
const WAVE_AMPLITUDE = 2.2; // units
const UNDERLINE_JITTER = 0.8; // units
const UNDERLINE_TILT = 3; // units: the far end sits this much higher or lower
const OVERSHOOT_MIN = 4; // units a hand stroke runs past the box at its start
const OVERSHOOT_SPAN = 6; // units: extra overshoot at the end, from the seed
const CIRCLE_SCALE = 1.25; // of the box
const CIRCLE_OVERLAP = 12; // units the stroke runs on past where it began
const CIRCLE_SEPARATION = 1.6; // stroke widths between the start and the end lines, so the overlap shows
const CIRCLE_POINTS = 12;
const CIRCLE_RADIAL_NOISE = 2.5; // units
const CIRCLE_START = -150 * DEGREES; // the pen starts upper left and turns clockwise
const CIRCLE_START_SPAN = 35 * DEGREES;
const BEZIER_CIRCLE = 0.5523; // control-point distance of a quarter ellipse
const ARROW_GAP = 12; // units between the tip and the box
const ARROW_BOW = 0.16; // of the arrow's length
const ARROW_BOW_MAX = 90; // units
const ARROW_CONTROL_JITTER = 4; // units
const HALF_CHANCE = 0.5; // the bow goes either way
const BOW_VARY_MIN = 0.7; // the bow is 0.7 to 1.3 times its nominal size
const BOW_VARY_SPAN = 0.6;
const NEAR_CONTROL = 0.3; // of the length: where the first control point sits along the arrow
const FAR_CONTROL = 0.25; // of the length: how far back from the tip the second one sits
const TIP_BOW = 0.35; // of the bow: the second control point is bent less than the first
const HEAD_ANGLE = 30 * DEGREES;
const BARB_ANGLE_JITTER = 7 * DEGREES; // hand look: each barb's angle moves by up to this
const BARB_LENGTH_MIN = 0.9; // hand look: each barb is 0.9 to 1.1 times the head length
const BARB_LENGTH_SPAN = 0.2;
const HEAD_LENGTH_MIN = 26; // units
const HEAD_LENGTH_PER_WIDTH = 3.2;
const BRACKET_GAP = 16; // units left of the box
const BRACKET_SERIF = 14; // units: how far the top and bottom bars reach toward the box
const BRACKET_PAD = 8; // units above and below the box
const BRACKET_JITTER = 2; // units
const BRACKET_BULGE = 3; // units: the spine bows this far
const HALF = 2;
const NO_CROSSING = null;

const lerp = (a, b, f) => a + (b - a) * f;

// The stroke node every mark shares: width in units, colour from the look's entry, a draw-on that lands on `at`.
function markNode({ id, d, look, unit, at, name, fallbackColour }) {
  const style = styleOf(look, name);
  const hand = isHand(look);
  const props = {
    d,
    stroke: colourOf(look, style.color ?? fallbackColour),
    strokeWidth: (style.width ?? DEFAULT_WIDTH) * unit,
    lineCap: hand ? 'round' : 'butt',
  };
  const step = hand ? look.moves.draw.step : undefined;
  return { nodes: [node('path', id, props, { tracks: { draw: landing(at, look.moves.draw, 0, 1, step) }, step })] };
}

// ---- underline ----

function handUnderline([x, y, w, h], unit, rng) {
  const base = y + h + UNDERLINE_GAP * unit;
  const x0 = x - (OVERSHOOT_MIN + rng() * OVERSHOOT_MIN) * unit;
  const x1 = x + w + (OVERSHOOT_MIN + rng() * OVERSHOOT_SPAN) * unit;
  const tilt = spread(rng, UNDERLINE_TILT) * unit, phase = rng() * TAU;
  const points = Array.from({ length: UNDERLINE_POINTS }, (_, i) => {
    const f = i / (UNDERLINE_POINTS - 1);
    const wave = WAVE_AMPLITUDE * unit * Math.sin(f * TAU * UNDERLINE_WAVES + phase);
    return [lerp(x0, x1, f), base + tilt * f + wave + spread(rng, UNDERLINE_JITTER) * unit];
  });
  return smoothPath(points);
}

function buildUnderline(params) {
  const { id, box, at, look, unit, seed } = checkParams('underline', params);
  const [x, y, w, h] = box;
  const base = y + h + UNDERLINE_GAP * unit;
  const d = isHand(look) ? handUnderline(box, unit, deviceRng(seed, id, 'underline')) : polyline([[x, base], [x + w, base]]);
  return markNode({ id, d, look, unit, at, name: 'underline', fallbackColour: 'accent2' });
}

// ---- circle ----

function ellipsePath(cx, cy, rx, ry) {
  const kx = BEZIER_CIRCLE * rx, ky = BEZIER_CIRCLE * ry;
  const top = [cx, cy - ry], right = [cx + rx, cy], bottom = [cx, cy + ry], left = [cx - rx, cy];
  const q = (c1, c2, to) => `C${at2(c1)} ${at2(c2)} ${at2(to)}`;
  return `M${at2(top)}${q([cx + kx, cy - ry], [cx + rx, cy - ky], right)}${q([cx + rx, cy + ky], [cx + kx, cy + ry], bottom)}`
    + `${q([cx - kx, cy + ry], [cx - rx, cy + ky], left)}${q([cx - rx, cy - ky], [cx - kx, cy - ry], top)}Z`;
}

// One turn and a bit more. The pen's line drifts outward along the normal, so the end passes beside the start
// instead of on it; that visible crossing is what makes it read as hand-drawn.
function handCircle([x, y, w, h], unit, width, rng) {
  const cx = x + w / HALF, cy = y + h / HALF, rx = (w * CIRCLE_SCALE) / HALF, ry = (h * CIRCLE_SCALE) / HALF;
  const start = CIRCLE_START + rng() * CIRCLE_START_SPAN;
  const speed = Math.hypot(rx * Math.sin(start), ry * Math.cos(start));
  const sweep = TAU + (CIRCLE_OVERLAP * unit) / speed;
  const separation = width * unit * CIRCLE_SEPARATION;
  const points = Array.from({ length: CIRCLE_POINTS + 1 }, (_, i) => {
    const f = i / CIRCLE_POINTS, angle = start + sweep * f;
    const nx = Math.cos(angle) / rx, ny = Math.sin(angle) / ry, norm = Math.hypot(nx, ny);
    const offset = lerp(-separation / HALF, separation / HALF, f) + spread(rng, CIRCLE_RADIAL_NOISE) * unit;
    return [cx + rx * Math.cos(angle) + (nx / norm) * offset, cy + ry * Math.sin(angle) + (ny / norm) * offset];
  });
  return smoothPath(points);
}

function buildCircle(params) {
  const { id, box, at, look, unit, seed } = checkParams('circle', params);
  const [x, y, w, h] = box;
  const width = styleOf(look, 'circle').width ?? DEFAULT_WIDTH;
  const d = isHand(look)
    ? handCircle(box, unit, width, deviceRng(seed, id, 'circle'))
    : ellipsePath(x + w / HALF, y + h / HALF, (w * CIRCLE_SCALE) / HALF, (h * CIRCLE_SCALE) / HALF);
  return markNode({ id, d, look, unit, at, name: 'circle', fallbackColour: 'accent2' });
}

// ---- arrow ----

// The parameter range of a ray inside the interval [lo, hi] on one axis, or null when it never crosses.
function slab(from, delta, lo, hi) {
  if (delta === 0) return from >= lo && from <= hi ? [-Infinity, Infinity] : NO_CROSSING;
  const a = (lo - from) / delta, b = (hi - from) / delta;
  return a < b ? [a, b] : [b, a];
}

// Where the line from `from` to the box centre first reaches the box grown by `gap`.
function tipOf(from, [x, y, w, h], gap) {
  const centre = [x + w / HALF, y + h / HALF];
  const delta = [centre[0] - from[0], centre[1] - from[1]];
  const sx = slab(from[0], delta[0], x - gap, x + w + gap), sy = slab(from[1], delta[1], y - gap, y + h + gap);
  const entry = sx && sy ? Math.max(sx[0], sy[0]) : NO_CROSSING;
  if (entry === NO_CROSSING || entry <= 0) throw new Error(`arrow: from ${JSON.stringify(from)} must lie outside the box and its ${gap}px gap`);
  return [from[0] + delta[0] * entry, from[1] + delta[1] * entry];
}

// A bowed shaft as one cubic from `from` to `tip`; returns its path, its second control point and the end tangent.
function bowedShaft(from, tip, unit, rng) {
  const dx = tip[0] - from[0], dy = tip[1] - from[1], length = Math.hypot(dx, dy);
  const along = [dx / length, dy / length], side = [-along[1], along[0]];
  const bow = Math.min(length * ARROW_BOW, ARROW_BOW_MAX * unit) * (rng() < HALF_CHANCE ? -1 : 1) * (BOW_VARY_MIN + BOW_VARY_SPAN * rng());
  const jitter = () => spread(rng, ARROW_CONTROL_JITTER) * unit;
  // c1 sits a third of the way along and carries the bow; c2 sits near the tip and is bent less, so the head still
  // aims at the box.
  const c1 = [from[0] + along[0] * length * NEAR_CONTROL + side[0] * bow + jitter(), from[1] + along[1] * length * NEAR_CONTROL + side[1] * bow + jitter()];
  const c2 = [tip[0] - along[0] * length * FAR_CONTROL + side[0] * bow * TIP_BOW + jitter(), tip[1] - along[1] * length * FAR_CONTROL + side[1] * bow * TIP_BOW + jitter()];
  return { head: `C${at2(c1)} ${at2(c2)} ${at2(tip)}`, last: c2 };
}

// The two barbs of the head: back from the tip along the end tangent, spread either side by HEAD_ANGLE.
function barbs(tip, last, headLength, rng, hand) {
  const heading = Math.atan2(tip[1] - last[1], tip[0] - last[0]);
  return [-1, 1].map((side) => {
    const angle = heading + Math.PI + side * (HEAD_ANGLE + (hand ? spread(rng, BARB_ANGLE_JITTER) : 0));
    const length = headLength * (hand ? BARB_LENGTH_MIN + rng() * BARB_LENGTH_SPAN : 1);
    return [tip[0] + Math.cos(angle) * length, tip[1] + Math.sin(angle) * length];
  });
}

function buildArrow(params) {
  const { id, box, at, look, unit, seed } = checkParams('arrow', params, ['from']);
  const { from } = params;
  if (!Array.isArray(from) || from.length !== HALF || !from.every(Number.isFinite)) throw new Error(`arrow: from must be [x, y], got ${JSON.stringify(from)}`);
  const hand = isHand(look), rng = deviceRng(seed, id, 'arrow');
  const tip = tipOf(from, box, ARROW_GAP * unit);
  const width = (styleOf(look, 'arrow').width ?? DEFAULT_WIDTH) * unit;
  const shaft = hand ? bowedShaft(from, tip, unit, rng) : { head: `L${at2(tip)}`, last: from };
  const [b1, b2] = barbs(tip, shaft.last, Math.max(HEAD_LENGTH_MIN * unit, width * HEAD_LENGTH_PER_WIDTH), rng, hand);
  // One subpath, so the draw-on is one pen stroke: shaft, tip, first barb, back to the tip, second barb.
  const d = `M${at2(from)}${shaft.head}L${at2(b1)}L${at2(tip)}L${at2(b2)}`;
  return markNode({ id, d, look, unit, at, name: 'arrow', fallbackColour: 'accent2' });
}

// ---- bracket ----

function buildBracket(params) {
  const { id, box, at, look, unit, seed } = checkParams('bracket', params);
  const [x, y, , h] = box;
  const spine = x - BRACKET_GAP * unit, top = y - BRACKET_PAD * unit, bottom = y + h + BRACKET_PAD * unit;
  const reach = BRACKET_SERIF * unit;
  const square = [[spine + reach, top], [spine, top], [spine, bottom], [spine + reach, bottom]];
  if (!isHand(look)) return markNode({ id, d: polyline(square), look, unit, at, name: 'bracket', fallbackColour: 'ink' });
  const rng = deviceRng(seed, id, 'bracket');
  const loose = ([px, py]) => [px + spread(rng, BRACKET_JITTER) * unit, py + spread(rng, BRACKET_JITTER) * unit];
  const middle = [spine - BRACKET_BULGE * unit * (0.5 + rng()), (top + bottom) / HALF];
  const points = [square[0], square[1], middle, square[2], square[3]].map(loose);
  return markNode({ id, d: polyline(points), look, unit, at, name: 'bracket', fallbackColour: 'ink' });
}

const device = (name, build, summary) => Object.freeze({ name, summary, supports: styledBy(name), build });

export const underline = device('underline', buildUnderline, 'A hand-drawn line that draws on under a phrase or a region.');
export const circle = device('circle', buildCircle, 'A hand-drawn loop that draws on around a word, a number or a region.');
export const arrow = device('arrow', buildArrow, 'An arrow that draws on and points at its target.');
export const bracket = device('bracket', buildBracket, 'A bracket that draws on beside a block of text or a region.');

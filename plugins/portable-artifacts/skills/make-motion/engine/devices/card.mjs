// The `card` device: a sheet of paper that carries a quote, a figure or a picture. One group (the object entrance)
// holding a soft shadow, the paper and, where the look says `edge: 'taped'`, two tape strips (props.tape: true), or
// a seeded torn bottom edge for `edge: 'torn'`. The paper is the look's paper tint one step lighter unless the look
// names a fill. A hand look sets it down slightly crooked and jitters its corners; a crisp look draws an exact
// rectangle. The caller puts its content on top.
// `edge: 'rounded'` (cosmos) is a rounded rectangle of the style's `radius` (units), set square: no tilt, no tape, no
// jitter. Over its paper lies a faint lighter sheen (`<id>.sheen`, a soft-edged group of rings inset so its edge stays
// on the card: a soft inner gradient) and a 1-unit lighter edge stroke (`<id>.edge`). Pure and DOM-free.
import { node } from '../graph/node.mjs';
import {
  checkParams, isHand, styleOf, colourOf, deviceRng, spread, entrance, polyline, roundedRect, softRoundedRect, styledBy,
} from './shared.mjs';

const TILT = 1.5; // degrees
const CORNER_JITTER = 1.5; // units, hand look
const TOOTH = 14; // units: spacing of the torn edge's teeth
const TEAR_DEPTH = 4; // units
const MIN_TEETH = 4;
const TAPE = Object.freeze({ w: 96, h: 30, angle: 34, angleJitter: 4, inset: 12, drop: 2, colour: '#e9dfae', alpha: 0.8, notch: 1.2 });
const LIGHTER = 0.45; // how far the paper tint moves toward white
const HEX_RADIX = 16;
const CHANNEL_MAX = 255;
const HALF = 2;

// `colour` (#rrggbb) moved `amount` of the way to white.
function lighten(colour, amount) {
  const channels = [1, 3, 5].map((i) => parseInt(colour.slice(i, i + HALF), HEX_RADIX));
  const lifted = channels.map((c) => Math.round(c + (CHANNEL_MAX - c) * amount));
  return `#${lifted.map((c) => c.toString(HEX_RADIX).padStart(HALF, '0')).join('')}`;
}

// The paper outline about the card's centre: a rectangle, with a torn bottom edge for `torn`.
function paperOutline(edge, [w, h], unit, hand, rng) {
  const hw = w / HALF, hh = h / HALF;
  const jitter = (p) => (hand ? [p[0] + spread(rng, CORNER_JITTER * unit), p[1] + spread(rng, CORNER_JITTER * unit)] : p);
  const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(jitter);
  if (edge !== 'torn') return polyline(corners, true);
  const teeth = Math.max(MIN_TEETH, Math.round(w / (TOOTH * unit)));
  const torn = Array.from({ length: teeth - 1 }, (_, i) => [hw - (w * (i + 1)) / teeth, hh + spread(rng, TEAR_DEPTH * unit)]);
  return polyline([corners[0], corners[1], corners[2], ...torn, corners[3]], true);
}

function tapeStrip(id, side, [w, h], unit, rng) {
  const { w: tw, h: th, angle, angleJitter, inset, drop, colour, alpha, notch } = TAPE;
  const hw = (tw * unit) / HALF, hh = (th * unit) / HALF;
  const ends = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => [x + spread(rng, notch * unit), y + spread(rng, notch * unit)]);
  const props = {
    d: polyline(ends, true),
    fill: colour,
    opacity: alpha,
    tape: true,
    x: side * (w / HALF - inset * unit),
    y: -h / HALF + drop * unit,
    rotate: -side * (angle + spread(rng, angleJitter)),
  };
  return node('path', id, props);
}

const DEFAULT_RADIUS = 28; // units, a rounded card whose style names none
// reach: units of soft edge (stacked rings, no blur filter), at most maxReachShare of the card's short side
const SHEEN = Object.freeze({ lighter: 0.08, alpha: 0.5, reach: 48, maxReachShare: 0.16, height: 0.55 });
const EDGE = Object.freeze({ lighter: 0.18, width: 1 }); // width in units

// The look's shadow under outline `d`, as every card has it.
function shadowNode(id, d, look, unit) {
  const shadow = look.shadow;
  return node('path', `${id}.shadow`, {
    d, fill: colourOf(look, shadow.color), x: shadow.dx * unit, y: shadow.dy * unit, opacity: shadow.alpha,
    ...(shadow.blur > 0 ? { blur: (shadow.blur * unit) / HALF } : {}),
  });
}

// A rounded card: shadow, paper, a soft sheen over the top `SHEEN.height` of the card inset by its reach (so its soft
// edge never spills past the paper), and the lighter edge.
function roundedCard({ id, box, at, look, unit }, style) {
  const [x, y, w, h] = box;
  const fill = style.fill === undefined ? lighten(look.palette.paper, LIGHTER) : colourOf(look, style.fill);
  const radius = (style.radius ?? DEFAULT_RADIUS) * unit;
  const d = roundedRect(-w / HALF, -h / HALF, w, h, radius);
  const reach = Math.min(SHEEN.reach * unit, SHEEN.maxReachShare * Math.min(w, h));
  const sheenRect = [-w / HALF + reach, -h / HALF + reach, Math.max(0, w - HALF * reach), Math.max(0, h * SHEEN.height - reach)];
  const parts = [
    shadowNode(id, d, look, unit),
    node('path', `${id}.paper`, { d, fill }),
    softRoundedRect({ id: `${id}.sheen`, rect: sheenRect, radius: Math.max(0, radius - reach), reach, alpha: SHEEN.alpha, fill: lighten(fill, SHEEN.lighter) }),
    node('path', `${id}.edge`, { d, stroke: lighten(fill, EDGE.lighter), strokeWidth: EDGE.width * unit }),
  ];
  return { nodes: [entrance({ id, at, look, unit, cx: x + w / HALF, cy: y + h / HALF, children: parts })] };
}

function buildCard(params) {
  const { id, box, at, look, unit, seed } = checkParams('card', params);
  const [x, y, w, h] = box;
  const style = styleOf(look, 'card');
  if (style.edge === 'rounded') return roundedCard({ id, box, at, look, unit }, style);
  const hand = isHand(look), rng = deviceRng(seed, id, 'card');
  const rotate = hand ? spread(rng, TILT) : 0;
  const d = paperOutline(style.edge, [w, h], unit, hand, rng);
  const parts = [
    shadowNode(id, d, look, unit),
    node('path', `${id}.paper`, { d, fill: style.fill === undefined ? lighten(look.palette.paper, LIGHTER) : colourOf(look, style.fill) }),
    ...(style.edge === 'taped' ? [-1, 1].map((side, i) => tapeStrip(`${id}.tape${i + 1}`, side, [w, h], unit, rng)) : []),
  ];
  const group = entrance({ id, at, look, unit, cx: x + w / HALF, cy: y + h / HALF, rotate, children: parts });
  return { nodes: [group] };
}

export const card = Object.freeze({
  name: 'card',
  summary: 'A sheet of paper that carries a quote, a figure or a picture.',
  supports: styledBy('card'),
  build: buildCard,
});

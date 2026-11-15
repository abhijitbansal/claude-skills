// The `card` device: a sheet of paper that carries a quote, a figure or a picture. One group (the object entrance)
// holding a soft shadow, the paper and, where the look says `edge: 'taped'`, two tape strips (props.tape: true), or
// a seeded torn bottom edge for `edge: 'torn'`. The paper is the look's paper tint one step lighter unless the look
// names a fill. A hand look sets it down slightly crooked and jitters its corners; a crisp look draws an exact
// rectangle. The caller puts its content on top. Pure and DOM-free.
import { node } from '../graph/node.mjs';
import { checkParams, isHand, styleOf, colourOf, deviceRng, spread, entrance, polyline, styledBy } from './shared.mjs';

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

function buildCard(params) {
  const { id, box, at, look, unit, seed } = checkParams('card', params);
  const [x, y, w, h] = box;
  const style = styleOf(look, 'card'), hand = isHand(look), rng = deviceRng(seed, id, 'card');
  const rotate = hand ? spread(rng, TILT) : 0;
  const d = paperOutline(style.edge, [w, h], unit, hand, rng);
  const shadow = look.shadow;
  const parts = [
    node('path', `${id}.shadow`, {
      d, fill: colourOf(look, shadow.color), x: shadow.dx * unit, y: shadow.dy * unit, opacity: shadow.alpha,
      ...(shadow.blur > 0 ? { blur: (shadow.blur * unit) / HALF } : {}),
    }),
    node('path', `${id}.paper`, { d, fill: style.fill === undefined ? lighten(look.palette.paper, LIGHTER) : colourOf(look, style.fill) }),
    ...(style.edge === 'taped' ? [-1, 1].map((side, i) => tapeStrip(`${id}.tape${i + 1}`, side, [w, h], unit, rng)) : []),
  ];
  const group = entrance({ id, at, look, unit, cx: x + w / HALF, cy: y + h / HALF, rotate, children: parts });
  return { nodes: [group] };
}

export const card = Object.freeze({
  name: 'card',
  supports: styledBy('card'),
  build: buildCard,
});

// The look's light source (look.sun, cosmos): one recurring warm glow, a soft disc with a smooth falloff (draw.mjs
// props.radial: a radial gradient, no blur filter) that the kinds place with intent: at the focus of a number's orbit,
// at the start of a list's path, behind a statement's emphasised words, behind the end card's mark. Not a registered
// device (no event places it, so it needs no sound). Pure and DOM-free.
//
// look.sun: { color (#rrggbb), alpha (at the centre), core (share of the radius held near full), lift (seconds to
// light up) }.
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';

const KAPPA = 0.5523; // cubic Bezier circle
const HALF_STOP = 0.5;
const ROUND = 100;

// A circle of radius r about the origin, as a path.
function circle(r) {
  const k = KAPPA * r;
  const p = (x, y) => `${Math.round(x * ROUND) / ROUND} ${Math.round(y * ROUND) / ROUND}`;
  return `M${p(0, -r)}C${p(k, -r)} ${p(r, -k)} ${p(r, 0)}C${p(r, k)} ${p(k, r)} ${p(0, r)}C${p(-k, r)} ${p(-r, k)} ${p(-r, 0)}C${p(-r, -k)} ${p(-k, -r)} ${p(0, -r)}Z`;
}

/** Does the look carry a light source? */
export const hasSun = (look) => look.sun !== undefined;

/**
 * The sun's node at (cx, cy) with radius r px, its centre alpha the look's times `strength`, lighting up from `at`
 * over the look's lift (absent `at`: lit from frame 0). [] for a look without one.
 */
export function sunNodes(id, look, { cx, cy, r, strength = 1, at }) {
  if (!hasSun(look)) return [];
  const { color, alpha, core, lift } = look.sun;
  const a = alpha * strength;
  const radial = { r, color, stops: [[0, a], [core, a * HALF_STOP], [1, 0]] };
  const tracks = at === undefined ? {} : { opacity: track([{ t: 0, v: 0 }, { t: at, v: 0 }, { t: at + lift, v: 1, ease: 'outCubic' }]) };
  return [node('path', id, { d: circle(r), x: cx, y: cy, radial, furniture: true }, { tracks })];
}

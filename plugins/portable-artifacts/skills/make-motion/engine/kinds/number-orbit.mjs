// The number kind's orbit (look.kinds.number.orbit, cosmos): a tilted ellipse round the figure, large enough to leave
// air round its cap box, faint from the first frame, with a small bright dot that circles it once as the figure counts
// (from the count's start to its landing); the ellipse brightens as the figure lands. Pure and DOM-free.
//
// orbit data: { tilt (degrees), ratio (minor / major axis), air (share past the box's corners), width (units of
// stroke), dot (units of radius), faint and lit (the ellipse's opacity before and after the landing) }.
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';
import { CAP_HEIGHT } from './shared.mjs';

const HALF = 2;
const DEGREES_TO_RADIANS = Math.PI / 180;
const FULL_TURN = 360;
const BEZIER_CIRCLE = 0.5523;
const DOT_GLOW = 2.5; // the dot's light, in dot radii of blur
const DOT_GLOW_ALPHA = 0.9;
const ROUND = 100; // path coordinates to 0.01 px

/**
 * The orbit round a box { width, height } (its cap box, centred): its tilt, the ellipse's half axes a and b in its own
 * tilted frame, and hx, hy, the half width and half height of the ellipse on screen. When the tilted orbit is wider
 * than 2 * maxHx (a wide figure in a narrow frame), it stands upright, exactly 2 * maxHx wide and as tall as it must be
 * to hold the box with its air; the caller keeps the box under WIDE_SHARE of that width.
 */
export function orbitGeometry({ width, height }, orbit, maxHx = Infinity) {
  const t = orbit.tilt * DEGREES_TO_RADIANS, c = Math.cos(t), s = Math.sin(t);
  const corners = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([i, j]) => [(i * width) / HALF, (j * height) / HALF]);
  // each corner in the ellipse's frame (turned back by the tilt): the smallest ellipse of this ratio through it
  const reach = Math.max(...corners.map(([x, y]) => Math.hypot(x * c + y * s, (-x * s + y * c) / orbit.ratio)));
  const a = reach * (1 + orbit.air), b = a * orbit.ratio;
  const hx = Math.hypot(a * c, b * s);
  if (hx <= maxHx) return { tilt: orbit.tilt, a, b, hx, hy: Math.hypot(a * s, b * c) };
  const across = Math.min(WIDE_SHARE, width / HALF / maxHx);
  // the box's corners at UPRIGHT_FIT of the way out: the same air a tilted orbit leaves
  const upright = height / HALF / Math.sqrt(UPRIGHT_FIT - across * across);
  return { tilt: 0, a: maxHx, b: upright, hx: maxHx, hy: upright };
}

/** The most of an upright orbit's width a figure may take (orbitGeometry). */
export const WIDE_SHARE = 0.8;
const UPRIGHT_FIT = 0.85;

function ellipsePath(a, b) {
  const kx = BEZIER_CIRCLE * a, ky = BEZIER_CIRCLE * b;
  const p = (x, y) => `${Math.round(x * ROUND) / ROUND} ${Math.round(y * ROUND) / ROUND}`;
  return `M${p(0, -b)}C${p(kx, -b)} ${p(a, -ky)} ${p(a, 0)}C${p(a, ky)} ${p(kx, b)} ${p(0, b)}`
    + `C${p(-kx, b)} ${p(-a, ky)} ${p(-a, 0)}C${p(-a, -ky)} ${p(-kx, -b)} ${p(0, -b)}Z`;
}

/**
 * The orbit's nodes round the figure's cap box (left edge, width, baseline, size in px): a group at the box's centre,
 * turned by the tilt, holding the ellipse and the dot. The dot rides a circle of radius a squashed to the ratio (so it
 * follows the ellipse exactly); it is itself an ellipse 1 / ratio tall, so it shows round.
 */
export function orbitNodes(id, ctx, { left, width, baseline, size }, times, orbit, geometry) {
  const { look, unit, fps } = ctx;
  const height = CAP_HEIGHT * size;
  const { a, b, tilt } = geometry;
  const lit = look.moves.emphasize;
  const opacity = track([{ t: 0, v: orbit.faint }, { t: times.land, v: orbit.faint }, { t: times.land + lit.dur, v: orbit.lit, ease: lit.ease }]);
  const ring = node('path', `${id}.orbit.ring`, { d: ellipsePath(a, b), stroke: look.palette.accent, strokeWidth: orbit.width * unit, lineCap: 'round' }, { tracks: { opacity } });
  const r = orbit.dot * unit;
  const dot = node('path', `${id}.orbit.dot`, {
    d: ellipsePath(r, r / orbit.ratio), x: 0, y: -a,
    fill: look.palette.ink, glow: { color: look.palette.accent, alpha: DOT_GLOW_ALPHA, radius: DOT_GLOW * r },
  });
  const turn = track([{ t: 0, v: 0 }, { t: times.start, v: 0 }, { t: Math.max(times.start + 1 / fps, times.land), v: FULL_TURN, ease: look.moves.count.ease }]);
  const spin = node('group', `${id}.orbit.spin`, {}, { tracks: { rotate: turn }, children: [dot] });
  const squash = node('group', `${id}.orbit.path`, { scaleY: orbit.ratio }, { children: [spin] });
  return [node('group', `${id}.orbit`, { x: left + width / HALF, y: baseline - height / HALF, rotate: tilt }, { children: [ring, squash] })];
}

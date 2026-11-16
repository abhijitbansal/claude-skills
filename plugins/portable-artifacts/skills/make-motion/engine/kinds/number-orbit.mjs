// The number kind's orbit (look.kinds.number.orbit, cosmos): a tilted ellipse round the figure, large enough to leave
// air round its cap box, faint from the first frame, with a small bright dot that circles it once as the figure counts
// (from the count's start to its landing) and keeps circling slowly to the end of the shot; the ellipse brightens as
// the figure lands. The kind sets it so the look's sun stands at a focus (number-sky.mjs). Pure and DOM-free.
//
// orbit data: { tilt (degrees), ratio (minor / major axis), air (share past the box's corners), width (units of
// stroke), dot (units of radius), faint and lit (the ellipse's opacity before and after the landing) }.
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';

const HALF = 2;
const DEGREES_TO_RADIANS = Math.PI / 180;
const FULL_TURN = 360;
const BEZIER_CIRCLE = 0.5523;
const DOT_GLOW = 2.5; // the dot's light, in dot radii of blur
const DOT_GLOW_ALPHA = 0.9;
const ROUND = 100; // path coordinates to 0.01 px
const REST_TURN = 24; // degrees a second the dot keeps circling after the count lands: the orbit never stops

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
 * The orbit's nodes about its centre (x, y px): a group there, turned by the geometry's tilt, holding the ellipse (half
 * axes a across and b up its own frame: b > a stands tall) and the dot. The dot rides a circle of radius a stretched
 * to b / a up (so it follows the ellipse exactly, starting at its top); it is itself drawn a / b tall, so it shows round.
 * The group carries its axes (props.axes) for the kinds that place things by its foci.
 */
export function orbitNodes(id, ctx, { x, y }, times, orbit, { a, b, tilt }) {
  const { look, unit, fps } = ctx;
  const lit = look.moves.emphasize;
  const opacity = track([{ t: 0, v: orbit.faint }, { t: times.land, v: orbit.faint }, { t: times.land + lit.dur, v: orbit.lit, ease: lit.ease }]);
  const ring = node('path', `${id}.orbit.ring`, { d: ellipsePath(a, b), stroke: look.palette.accent, strokeWidth: orbit.width * unit, lineCap: 'round' }, { tracks: { opacity } });
  const r = orbit.dot * unit;
  const dot = node('path', `${id}.orbit.dot`, {
    d: ellipsePath(r, (r * a) / b), x: 0, y: -a,
    fill: look.palette.ink, glow: { color: look.palette.accent, alpha: DOT_GLOW_ALPHA, radius: DOT_GLOW * r },
  });
  const landed = Math.max(times.start + 1 / fps, times.land), end = Math.max(landed, ctx.timing.duration);
  const turn = track([{ t: 0, v: 0 }, { t: times.start, v: 0 }, { t: landed, v: FULL_TURN, ease: look.moves.count.ease }, { t: end, v: FULL_TURN + REST_TURN * (end - landed) }]);
  const spin = node('group', `${id}.orbit.spin`, {}, { tracks: { rotate: turn }, children: [dot] });
  const squash = node('group', `${id}.orbit.path`, { scaleY: b / a }, { children: [spin] });
  return [node('group', `${id}.orbit`, { x, y, rotate: tilt, axes: { a, b } }, { children: [ring, squash] })];
}

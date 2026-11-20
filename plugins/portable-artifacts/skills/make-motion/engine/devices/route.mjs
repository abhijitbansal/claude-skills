// The `route` device: a line that draws on through `points` ([x, y][], two or more), smoothed through each of them in
// order, landing on `at`. The look's `devices.route` styles it: desk a thin red thread stepping at 12 fps with a pin at
// each end (`pins`), pop a thick line whose arrow head jabs in (springs from small) as the line arrives. `pins`, given,
// overrides the look's. Takes no box: its box is the points'. Pure and DOM-free.
import { node } from '../graph/node.mjs';
import { checkParams, isHand, styleOf, colourOf, landing, smoothPath, polyline, at2, styledBy } from './shared.mjs';

const BEZIER_CIRCLE = 0.5523; // control-point distance of a quarter circle
const DEFAULT_WIDTH = 6; // units
const PIN_RADIUS = 9; // units
const HEAD_LENGTH = 3.2; // stroke widths
const HEAD_ANGLE = Math.PI / 6;
const HEAD_FROM = 0.4; // the head's scale as it starts to jab in
const HALF = 2;

function boundsOf(points) {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(1, Math.max(...xs) - Math.min(...xs)), Math.max(1, Math.max(...ys) - Math.min(...ys))];
}

// A pin: a small filled disc (four quarter curves) at `p`.
function pinNode(id, [x, y], r, fill, tracks) {
  const k = BEZIER_CIRCLE * r;
  const c = (c1, c2, to) => `C${at2(c1)} ${at2(c2)} ${at2(to)}`;
  const d = `M${at2([x, y - r])}${c([x + k, y - r], [x + r, y - k], [x + r, y])}${c([x + r, y + k], [x + k, y + r], [x, y + r])}`
    + `${c([x - k, y + r], [x - r, y + k], [x - r, y])}${c([x - r, y - k], [x - k, y - r], [x, y - r])}Z`;
  return node('path', id, { d, fill }, { tracks });
}

// The arrow head at the last point, aimed along the last leg, about the tip so its jab grows from the tip.
function headNode(id, points, width, colour, at, look) {
  const tip = points.at(-1), from = points.at(-2);
  const heading = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const length = HEAD_LENGTH * width;
  const barb = (side) => [Math.cos(heading + Math.PI + side * HEAD_ANGLE) * length, Math.sin(heading + Math.PI + side * HEAD_ANGLE) * length];
  const move = look.moves.pop ?? look.moves.enter;
  return node('path', id, { d: polyline([barb(-1), [0, 0], barb(1)]), stroke: colour, strokeWidth: width, lineCap: 'butt', x: tip[0], y: tip[1] }, {
    tracks: { opacity: landing(at, { ease: 'linear', dur: 0 }, 0, 1), scale: landing(at + move.dur, move, HEAD_FROM, 1) },
  });
}

function buildRoute(params) {
  const { points } = params;
  const ok = Array.isArray(points) && points.length >= HALF && points.every((p) => Array.isArray(p) && p.length === HALF && p.every(Number.isFinite));
  if (!ok) throw new Error(`route: points must be two or more [x, y] pairs, got ${JSON.stringify(points)}`);
  const { id, at, look, unit } = checkParams('route', { ...params, box: boundsOf(points) }, ['points', 'pins']);
  const style = styleOf(look, 'route');
  const colour = colourOf(look, style.color ?? 'accent2');
  const width = (style.width ?? DEFAULT_WIDTH) * unit;
  const step = isHand(look) ? look.moves.draw.step : undefined;
  const line = node('path', `${id}.line`, { d: smoothPath(points), stroke: colour, strokeWidth: width, lineCap: isHand(look) ? 'round' : 'butt' }, {
    tracks: { draw: landing(at, look.moves.draw, 0, 1, step) }, step,
  });
  const pins = params.pins ?? style.pins === true;
  const shown = (t) => ({ opacity: landing(t, { ease: 'linear', dur: 0 }, 0, 1) });
  const start = Math.max(0, at - look.moves.draw.dur);
  const ends = pins ? [pinNode(`${id}.pin0`, points[0], PIN_RADIUS * unit, colour, shown(start)), pinNode(`${id}.pin1`, points.at(-1), PIN_RADIUS * unit, colour, shown(at))] : [];
  const head = pins ? [] : [headNode(`${id}.head`, points, width, colour, at, look)];
  return { nodes: [node('group', id, {}, { children: [line, ...ends, ...head] })] };
}

export const route = Object.freeze({
  name: 'route',
  summary: 'A line that draws on through a list of points: a pinned thread, or a thick line whose arrow head jabs in.',
  supports: styledBy('route'),
  build: buildRoute,
});

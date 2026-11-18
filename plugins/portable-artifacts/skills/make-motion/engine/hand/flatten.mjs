// What the drawing hand draws, from what a kind built (looks-four Task 12): the kinds and devices build groups of paths
// with curves and fills, and the hand draws only text and stroked polylines. flattenForHand rewrites a shot's nodes so
// everything on the board is one of those two:
//   - a group that is only a position (no turn, no scale) is lifted: its children take its offset, so a card, a tag or a
//     label is drawn part by part; a group that turns or scales stays as it is (it appears at once, see `stepped`);
//   - a path of M, L, H, V, Q, C and Z segments becomes a polyline (curves sampled), still stroked in its colour;
//   - a fill in the board's own colour (the card's paper, a tag's plate) is dropped, and the stroke it had stays: a drawn
//     box is its outline; any other fill becomes its outline and, for a rectangle, a hatch of strokes inside it in the
//     fill's colour (a scribble fill), never a flat colour;
//   - a translucent or soft shape (opacity below 1, a shadow) is made opaque, and a path that only sits behind (a card's
//     shadow, `under` with no stroke and a translucent fill) is dropped;
//   - every node left as it is (an image, a turned group) takes a stepped opacity: it is put on at once, never faded.
// Pure and DOM-free; nodes are immutable, so every change builds a new node.
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';
import { polyline } from '../devices/shared.mjs';
import { boxHatch } from './geometry.mjs';

const QUAD_STEPS = 10;
const CUBIC_STEPS = 14;
const HATCH_GAP = 26; // units between the lines of a fill's hatch (as hand/strokes.mjs)
const RECT_FILL = 0.94; // a polygon holding this share of its box is a rectangle for the hatch
const PAPER_FILLS = Object.freeze(['#ffffff']);
const COMMAND = /([MLHVQCZ])([^MLHVQCZ]*)/gi;
const NUMBERS = /-?\d*\.?\d+(?:e[+-]?\d+)?/gi;

const numbers = (text) => (text.match(NUMBERS) ?? []).map(Number);

function quad(a, c, b, steps) {
  return Array.from({ length: steps }, (_, i) => {
    const t = (i + 1) / steps, m = 1 - t;
    return [m * m * a[0] + 2 * m * t * c[0] + t * t * b[0], m * m * a[1] + 2 * m * t * c[1] + t * t * b[1]];
  });
}

function cubic(a, c1, c2, b, steps) {
  return Array.from({ length: steps }, (_, i) => {
    const t = (i + 1) / steps, m = 1 - t;
    return [m ** 3 * a[0] + 3 * m * m * t * c1[0] + 3 * m * t * t * c2[0] + t ** 3 * b[0], m ** 3 * a[1] + 3 * m * m * t * c1[1] + 3 * m * t * t * c2[1] + t ** 3 * b[1]];
  });
}

/** The points of an absolute path of M, L, H, V, Q, C and Z, curves sampled, with whether it ends closed; null for any other path. */
export function pathToPolyline(d) {
  if (typeof d !== 'string' || /[^MLHVQCZ0-9eE.,+\s-]/.test(d)) return null;
  const points = [];
  let at = [0, 0], start = [0, 0], closed = false, subpaths = 0;
  for (const [, cmd, rest] of d.matchAll(COMMAND)) {
    const n = numbers(rest);
    const op = cmd.toUpperCase();
    if (op === 'M') { subpaths += 1; start = at = [n[0], n[1]]; points.push(at); } else if (op === 'L') { for (let i = 0; i + 1 < n.length; i += 2) points.push(at = [n[i], n[i + 1]]); } else if (op === 'H') { for (const x of n) points.push(at = [x, at[1]]); } else if (op === 'V') { for (const y of n) points.push(at = [at[0], y]); } else if (op === 'Q') {
      for (let i = 0; i + 3 < n.length; i += 4) { points.push(...quad(at, [n[i], n[i + 1]], [n[i + 2], n[i + 3]], QUAD_STEPS)); at = [n[i + 2], n[i + 3]]; }
    } else if (op === 'C') {
      for (let i = 0; i + 5 < n.length; i += 6) { points.push(...cubic(at, [n[i], n[i + 1]], [n[i + 2], n[i + 3]], [n[i + 4], n[i + 5]], CUBIC_STEPS)); at = [n[i + 4], n[i + 5]]; }
    } else if (op === 'Z') { closed = true; at = start; }
  }
  return subpaths === 1 && points.length >= 2 ? { points, closed } : null;
}

const boxOf = (points) => {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
};

function area(points) {
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) sum += (points[j][0] + points[i][0]) * (points[j][1] - points[i][1]);
  return Math.abs(sum) / 2;
}

const isRectangle = (points) => {
  const [, , w, h] = boxOf(points);
  return w > 0 && h > 0 && area(points) >= RECT_FILL * w * h;
};

const sameColour = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

// A node as it is with its opacity made a step: 0 until the key where it first leaves 0, then 1 (never part-way).
function stepped(n) {
  const keys = n.tracks.opacity?.points;
  const { opacity, ...props } = n.props;
  if (keys === undefined && (opacity === undefined || opacity === 1)) return n;
  const first = keys?.find((k) => k.v > 0);
  const tracks = { ...n.tracks, opacity: track(first === undefined || first.t <= 0 ? [{ t: 0, v: 1 }] : [{ t: 0, v: 0 }, { t: first.t, v: 0 }, { t: first.t, v: 1 }]) };
  return node(n.type, n.id, props, { tracks, children: n.children, wordTracks: n.wordTracks, step: n.step, depth: n.depth });
}

// A group that is only a position: no turn and no scale.
const isOffset = (g) => g.type === 'group' && !g.props.rotate && g.props.scale === undefined && g.props.scaleX === undefined && g.props.scaleY === undefined
  && g.tracks.rotate === undefined && g.tracks.scale === undefined && g.tracks.scaleX === undefined && g.tracks.scaleY === undefined;

function moved(n, dx, dy, fixed) {
  if (dx === 0 && dy === 0 && !fixed) return n;
  const props = { ...n.props, x: (n.props.x ?? 0) + dx, y: (n.props.y ?? 0) + dy, ...(fixed ? { fixed: true } : {}) };
  return node(n.type, n.id, props, { tracks: n.tracks, children: n.children, wordTracks: n.wordTracks, step: n.step, depth: n.depth });
}

function lift(n, dx = 0, dy = 0, fixed = false) {
  if (!isOffset(n)) return [moved(n, dx, dy, fixed)];
  const [gx, gy] = [dx + (n.props.x ?? 0), dy + (n.props.y ?? 0)];
  return n.children.flatMap((child) => lift(child, gx, gy, fixed || n.props.fixed === true));
}

// A fill the board already is: none, or white (the card's paper, a tag's plate on a white board).
const isBoard = (look, fill) => fill === undefined || sameColour(fill, look.palette.paper) || PAPER_FILLS.some((c) => sameColour(fill, c));

// The hatch of a rectangle in the fill's colour, in the path's own coordinates (the hatch node takes its x and y).
function hatchOf(n, points, fill, look, unit) {
  const [x, y, w, h] = boxOf(points);
  const zig = boxHatch(x + w / 2, y + h / 2, w, h, HATCH_GAP * unit, unit);
  if (zig.length < 2) return [];
  const place = { ...(n.props.x === undefined ? {} : { x: n.props.x }), ...(n.props.y === undefined ? {} : { y: n.props.y }) };
  return [node('path', `${n.id}.hatch`, { d: polyline(zig), stroke: fill, strokeWidth: look.hand.width.fill * unit, lineCap: 'round', ...place }, { depth: n.depth })];
}

// One path as the hand's nodes: its outline and, for a rectangle filled in a colour that is not the board's, a hatch.
function drawnPath(n, look, unit) {
  const parsed = pathToPolyline(n.props.d);
  if (parsed === null) return [stepped(n)];
  const { fill, stroke, opacity, ...rest } = n.props;
  const board = isBoard(look, fill);
  const rectangle = isRectangle(parsed.points);
  if (stroke === undefined && (board || (opacity < 1 && rest.under === true && !rectangle))) return [];
  const outline = node('path', n.id, {
    ...rest, d: polyline(parsed.points, parsed.closed), stroke: stroke ?? fill, strokeWidth: rest.strokeWidth ?? look.hand.width.line * unit, lineCap: rest.lineCap ?? 'round',
  }, { depth: n.depth });
  return board || !rectangle ? [outline] : [outline, ...hatchOf(n, parsed.points, fill, look, unit)];
}

/**
 * The shot's nodes as the hand can draw them (see the header); `unit` is px per unit. Nodes the hand does not draw come
 * back with a stepped opacity. The field and the hand are not touched.
 */
export function flattenForHand(nodes, look, unit) {
  return nodes.flatMap((n) => {
    if (n.type === 'field' || n.props?.role === 'hand') return [n];
    return lift(n).flatMap((m) => (m.type === 'path' ? drawnPath(m, look, unit) : m.type === 'text' ? [m] : [stepped(m)]));
  });
}


// Node outlines. One description per shape, as drawing primitives, feeds both
// the SVG path the renderer emits and the polyline the edge anchoring and the
// tests read, so "where an arrow lands" is computed from what is drawn.
//
// Primitives: { k: 'M'|'L', x, y }, { k: 'A', cx, cy, rx, ry, a0, a1 } (an
// elliptical arc from angle a0 to a1, SVG angles: y points down, so an
// increasing angle runs clockwise on screen) and { k: 'Z' }.
import { HEXAGON_CUT, PARALLELOGRAM_SLANT, CYLINDER_CAP } from './sizes.mjs';

export const CORNER_RADIUS = 8; // rounded-rect, dashed-rounded-rect
export const RECT_RADIUS = 2; // rect: crisp, but not a sharp-cornered box
export const STACK_RADIUS = 4;
export const STACK_INSET = 7; // queue: the two inner lines sit this far from the sides
export const BAR_INSET = 8; // subprocess: the two side bars (sizes.mjs reserves 8 px each side)
export const DOT_INNER = 5; // radius of the filled centre of a ringed dot

const PI = Math.PI;
const ARC_STEP = PI / 48; // sampling step for arcs

const M = (x, y) => ({ k: 'M', x, y });
const L = (x, y) => ({ k: 'L', x, y });
const A = (cx, cy, rx, ry, a0, a1) => ({ k: 'A', cx, cy, rx, ry, a0, a1 });
const Z = { k: 'Z' };

const polygon = (pts) => [M(...pts[0]), ...pts.slice(1).map((p) => L(...p)), Z];

function roundRect({ x, y, width: w, height: h }, r) {
  const rt = x + w;
  const bt = y + h;
  return [
    M(x + r, y), L(rt - r, y), A(rt - r, y + r, r, r, -PI / 2, 0),
    L(rt, bt - r), A(rt - r, bt - r, r, r, 0, PI / 2),
    L(x + r, bt), A(x + r, bt - r, r, r, PI / 2, PI),
    L(x, y + r), A(x + r, y + r, r, r, PI, 1.5 * PI), Z,
  ];
}

const stadium = ({ x, y, width: w, height: h }) => {
  const r = h / 2;
  return [M(x + r, y), L(x + w - r, y), A(x + w - r, y + r, r, r, -PI / 2, PI / 2), L(x + r, y + h), A(x + r, y + r, r, r, PI / 2, 1.5 * PI), Z];
};

const circle = (cx, cy, r) => [M(cx - r, cy), A(cx, cy, r, r, PI, 2 * PI), A(cx, cy, r, r, 0, PI), Z];

const diamond = ({ x, y, width: w, height: h }) => polygon([[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]]);

// Silhouette of a cylinder: the back edge of the top ellipse, the sides, and the
// front edge of the bottom ellipse.
function cylinder({ x, y, width: w, height: h }) {
  const rx = w / 2;
  const cx = x + rx;
  return [
    M(x, y + CYLINDER_CAP), A(cx, y + CYLINDER_CAP, rx, CYLINDER_CAP, PI, 2 * PI),
    L(x + w, y + h - CYLINDER_CAP), A(cx, y + h - CYLINDER_CAP, rx, CYLINDER_CAP, 0, PI), Z,
  ];
}

const vline = (x, y0, y1) => [M(x, y0), L(x, y1)];

/**
 * The drawn parts of a shape in box `b` ({ x, y, width, height }): `outline`
 * is the closed silhouette (the node's fill and border), `decor` the extra
 * strokes inside it.
 */
export function shapeParts(shape, b) {
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const rt = b.x + b.width;
  const bt = b.y + b.height;
  switch (shape) {
    case 'rounded-rect':
    case 'dashed-rounded-rect':
      return { outline: roundRect(b, CORNER_RADIUS), decor: [] };
    case 'rect':
      return { outline: roundRect(b, RECT_RADIUS), decor: [] };
    case 'stacked-rect':
      return { outline: roundRect(b, STACK_RADIUS), decor: [vline(b.x + STACK_INSET, b.y, bt), vline(rt - STACK_INSET, b.y, bt)] };
    case 'double-bar-rect':
      return { outline: roundRect(b, RECT_RADIUS), decor: [vline(b.x + BAR_INSET, b.y, bt), vline(rt - BAR_INSET, b.y, bt)] };
    case 'stadium':
      return { outline: stadium(b), decor: [] };
    case 'diamond':
    case 'small-diamond':
      return { outline: diamond(b), decor: [] };
    case 'hexagon-rect': {
      const c = HEXAGON_CUT;
      return { outline: polygon([[b.x + c, b.y], [rt - c, b.y], [rt, b.y + c], [rt, bt - c], [rt - c, bt], [b.x + c, bt], [b.x, bt - c], [b.x, b.y + c]]), decor: [] };
    }
    case 'parallelogram': {
      const s = PARALLELOGRAM_SLANT;
      return { outline: polygon([[b.x + s, b.y], [rt, b.y], [rt - s, bt], [b.x, bt]]), decor: [] };
    }
    case 'cylinder': {
      const rx = b.width / 2;
      // the front edge of the top ellipse, drawn as a line inside the silhouette
      return { outline: cylinder(b), decor: [[M(b.x, b.y + CYLINDER_CAP), A(cx, b.y + CYLINDER_CAP, rx, CYLINDER_CAP, PI, 0)]] };
    }
    case 'filled-dot':
      return { outline: circle(cx, cy, Math.min(b.width, b.height) / 2), decor: [] };
    case 'ringed-dot':
      return { outline: circle(cx, cy, Math.min(b.width, b.height) / 2), decor: [circle(cx, cy, DOT_INNER)] };
    default:
      throw new Error(`unknown shape ${JSON.stringify(shape)}`);
  }
}

// ---- primitives -> SVG path data / polyline ---------------------------------

const num = (v) => String(Math.round(v * 100) / 100);

const arcEnd = (p) => ({ x: p.cx + p.rx * Math.cos(p.a1), y: p.cy + p.ry * Math.sin(p.a1) });

/** SVG path data for a list of primitives. */
export function pathD(prims) {
  return prims.map((p) => {
    if (p.k === 'Z') return 'Z';
    if (p.k === 'A') {
      const end = arcEnd(p);
      const large = Math.abs(p.a1 - p.a0) > PI + 1e-9 ? 1 : 0;
      return `A${num(p.rx)} ${num(p.ry)} 0 ${large} ${p.a1 > p.a0 ? 1 : 0} ${num(end.x)} ${num(end.y)}`;
    }
    return `${p.k}${num(p.x)} ${num(p.y)}`;
  }).join('');
}

/** The vertices of a closed outline, arcs sampled finely. */
export function polyline(prims) {
  const pts = [];
  for (const p of prims) {
    if (p.k === 'A') {
      const steps = Math.max(2, Math.ceil(Math.abs(p.a1 - p.a0) / ARC_STEP));
      for (let i = 1; i <= steps; i++) {
        const a = p.a0 + ((p.a1 - p.a0) * i) / steps;
        pts.push({ x: p.cx + p.rx * Math.cos(a), y: p.cy + p.ry * Math.sin(a) });
      }
    } else if (p.k !== 'Z') {
      pts.push({ x: p.x, y: p.y });
    }
  }
  return pts;
}

// ---- where an axis-aligned ray meets the outline -----------------------------

const EPS = 1e-6;

/**
 * Walk from `from` along the unit axis step `dir` ({ dx, dy }, one of them 0)
 * and return the first point on the outline of `shape` in `box`, or null when
 * the ray never reaches it (it passes beside the shape).
 */
export function outlineHit(shape, box, from, dir) {
  const pts = polyline(shapeParts(shape, box).outline);
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const t = dir.dx !== 0 ? crossAlongX(a, b, from, dir.dx) : crossAlongY(a, b, from, dir.dy);
    if (t !== null && t >= -EPS && (best === null || t < best)) best = t;
  }
  return best === null ? null : { x: from.x + dir.dx * best, y: from.y + dir.dy * best };
}

// Distance along a horizontal ray (y = from.y, direction sign) to segment a-b, or null.
function crossAlongX(a, b, from, sign) {
  const lo = Math.min(a.y, b.y);
  const hi = Math.max(a.y, b.y);
  if (from.y < lo - EPS || from.y > hi + EPS) return null;
  if (Math.abs(b.y - a.y) < EPS) return null; // parallel to the ray
  const x = a.x + ((b.x - a.x) * (from.y - a.y)) / (b.y - a.y);
  return (x - from.x) * sign;
}

function crossAlongY(a, b, from, sign) {
  const lo = Math.min(a.x, b.x);
  const hi = Math.max(a.x, b.x);
  if (from.x < lo - EPS || from.x > hi + EPS) return null;
  if (Math.abs(b.x - a.x) < EPS) return null;
  const y = a.y + ((b.y - a.y) * (from.x - a.x)) / (b.x - a.x);
  return (y - from.y) * sign;
}

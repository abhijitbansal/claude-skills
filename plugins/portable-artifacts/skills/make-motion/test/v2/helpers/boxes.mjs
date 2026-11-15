// Canvas boxes of sampled nodes without a page (engine/page/bounds.mjs annotate measures paths with an SVG element):
// a path's box is the box of the coordinate pairs in its string (exact for the M L Q paths the devices build, and the
// control hull of a C curve, which holds the curve), carried through each node's matrix (localMatrix, as draw.mjs
// applies it). Boxes are [x, y, w, h].
import { localMatrix } from '../../../engine/page/bounds.mjs';

const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);

export const multiply = (p, q) => [
  p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1],
  p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3],
  p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5],
];
export const apply = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
export function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}
export const corners = ([x, y, w, h]) => [[x, y], [x + w, y], [x, y + h], [x + w, y + h]];

function boxOfPoints(points) {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const left = Math.min(...xs), top = Math.min(...ys);
  return [left, top, Math.max(...xs) - left, Math.max(...ys) - top];
}

/** The box of a path string's coordinate pairs, in the path's own space. */
export function pathBox(d) {
  const nums = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  return boxOfPoints(Array.from({ length: nums.length / 2 }, (_, i) => [nums[2 * i], nums[2 * i + 1]]));
}

/** A sampled node by id with its canvas matrix (its own transform included), or null. */
export function worldOf(nodes, id, parent = IDENTITY) {
  for (const n of nodes) {
    const m = multiply(parent, localMatrix(n));
    if (n.id === id) return { node: n, m };
    const found = worldOf(n.children, id, m);
    if (found) return found;
  }
  return null;
}

const pointsOf = (d) => {
  const nums = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  return Array.from({ length: nums.length / 2 }, (_, i) => [nums[2 * i], nums[2 * i + 1]]);
};

// A node's own points in its local space: an image's corners, a filled path's points, a stroked path's box corners grown
// by half its stroke; none for anything else.
function ownPoints(n) {
  if (n.type === 'image') return corners([0, 0, n.props.w, n.props.h]);
  if (n.type !== 'path' || typeof n.props.d !== 'string') return [];
  if (!n.props.stroke) return pointsOf(n.props.d);
  const [x, y, w, h] = pathBox(n.props.d);
  const grow = (n.props.strokeWidth ?? 1) / 2;
  return corners([x - grow, y - grow, w + 2 * grow, h + 2 * grow]);
}

function collect(n, m, out) {
  out.push(...ownPoints(n).map((p) => apply(m, p)));
  for (const child of n.children) collect(child, multiply(m, localMatrix(child)), out);
  return out;
}

/** The canvas box of node `id` and everything under it in a sampled tree (paths and images), or null. */
export function subtreeBox(nodes, id) {
  const found = worldOf(nodes, id);
  if (!found) return null;
  const points = collect(found.node, found.m, []);
  return points.length > 0 ? boxOfPoints(points) : null;
}

// Node transforms and bounding boxes. localMatrix is the one place a sampled node's x, y, rotate and scale become
// a matrix: draw.mjs applies it to the canvas and annotate() multiplies it down the tree, so a box always matches
// what was drawn. Matrices are canvas-style [a, b, c, d, e, f]; boxes are [x, y, w, h].
import { measurePath } from './geometry.mjs';

const DEGREES_TO_RADIANS = Math.PI / 180;
const HALF = 2;
const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);
const clean = (n) => n + 0; // turns -0 into 0

export function localMatrix(n) {
  const angle = n.rotate * DEGREES_TO_RADIANS;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const sx = n.scaleX * n.scale, sy = n.scaleY * n.scale;
  return [cos * sx, sin * sx, -sin * sy, cos * sy, n.x, n.y];
}

function multiply(p, q) {
  return [
    p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1],
    p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3],
    p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5],
  ];
}

// The axis-aligned box of `box` after matrix m.
function transformBox(m, [x, y, w, h]) {
  const xs = [], ys = [];
  for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
    xs.push(m[0] * cx + m[2] * cy + m[4]);
    ys.push(m[1] * cx + m[3] * cy + m[5]);
  }
  const left = Math.min(...xs), top = Math.min(...ys);
  return [clean(left), clean(top), clean(Math.max(...xs) - left), clean(Math.max(...ys) - top)];
}

function union(boxes) {
  const left = Math.min(...boxes.map((b) => b[0])), top = Math.min(...boxes.map((b) => b[1]));
  const right = Math.max(...boxes.map((b) => b[0] + b[2])), bottom = Math.max(...boxes.map((b) => b[1] + b[3]));
  return [left, top, right - left, bottom - top];
}

function pathBounds({ d, stroke, strokeWidth = 1, rough = 0 }) {
  if (typeof d !== 'string') return null;
  const [x, y, w, h] = measurePath(d).bbox;
  const grow = (stroke ? strokeWidth / HALF : 0) + rough;
  return [x - grow, y - grow, w + 2 * grow, h + 2 * grow];
}

function textBounds({ layout }) {
  if (!layout || layout.lines.length === 0) return null;
  const left = Math.min(...layout.lines.map((l) => l.x));
  const right = Math.max(...layout.lines.map((l) => l.x + l.width));
  return [left, 0, right - left, layout.height];
}

function imageBounds({ w, h }) {
  return Number.isFinite(w) && Number.isFinite(h) ? [0, 0, w, h] : null;
}

/** The node's own content box in its local space, or null when it draws nothing itself (a group, an empty text). */
export function localBounds(n) {
  if (n.type === 'path') return pathBounds(n.props);
  if (n.type === 'text') return textBounds(n.props);
  if (n.type === 'image') return imageBounds(n.props);
  return null;
}

function annotateNode(n, parent) {
  const m = multiply(parent, localMatrix(n));
  const children = n.children.map((child) => annotateNode(child, m));
  const own = localBounds(n);
  const boxes = [...(own ? [transformBox(m, own)] : []), ...children.map((c) => c.bbox)];
  const bbox = boxes.length > 0 ? union(boxes) : [clean(m[4]), clean(m[5]), 0, 0];
  return { ...n, children, bbox, ...(n.type === 'text' ? { layout: n.props.layout } : {}) };
}

/** The sampled tree with a canvas-pixel `bbox: [x, y, w, h]` on every node (a group's is its children's union)
 *  and, on a text node, its `layout`. Plain data, so it crosses page.evaluate. */
export function annotate(sampled) {
  return sampled.map((n) => annotateNode(n, IDENTITY));
}

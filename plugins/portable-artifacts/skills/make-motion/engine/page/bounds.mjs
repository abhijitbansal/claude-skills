// Node transforms and bounding boxes. localMatrix is the one place a sampled node's x, y, rotate and scale become
// a matrix: draw.mjs applies it to the canvas and annotate() multiplies it down the tree, so a box always matches
// what was drawn. Matrices are canvas-style [a, b, c, d, e, f]; boxes are [x, y, w, h].
import { measurePath } from './geometry.mjs';
import { WORD_IDENTITY } from './text-style.mjs';

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

// One word's box where draw.mjs puts it: scaled about its centre on the baseline, after its own x and y.
function wordBox(line, word, tracks, { ascent, descent }) {
  const t = { ...WORD_IDENTITY, ...tracks };
  const scale = Math.abs(t.scale);
  const half = (word.width / HALF) * scale;
  const centre = line.x + word.x + word.width / HALF + t.x;
  return [centre - half, line.y + t.y - ascent * scale, 2 * half, (ascent + descent) * scale];
}

// The union of the words' boxes, so a word that has moved or grown is inside it. The first baseline is the ascent;
// the last baseline plus the descent is the layout's height.
function textBounds(n) {
  const { layout } = n.props;
  if (!layout || layout.lines.length === 0) return null;
  const metrics = { ascent: layout.lines[0].y, descent: layout.height - layout.lines.at(-1).y };
  return union(layout.lines.flatMap((line) => line.words.map((word) => wordBox(line, word, n.words?.[word.index], metrics))));
}

function imageBounds({ w, h }) {
  return Number.isFinite(w) && Number.isFinite(h) ? [0, 0, w, h] : null;
}

/** The node's own content box in its local space, or null when it draws nothing itself (a group, an empty text). */
export function localBounds(n) {
  if (n.type === 'path') return pathBounds(n.props);
  if (n.type === 'text') return textBounds(n);
  if (n.type === 'image') return imageBounds(n.props);
  return null;
}

/** The node's own content and all its descendants, in the node's local space (a child's box through its own
 *  transform), or null when nothing in the subtree draws. This is what `reveal` clips. */
export function contentBox(n) {
  const own = localBounds(n);
  const inner = n.children.flatMap((child) => {
    const box = contentBox(child);
    return box ? [transformBox(localMatrix(child), box)] : [];
  });
  const boxes = own ? [own, ...inner] : inner;
  return boxes.length > 0 ? union(boxes) : null;
}

// ctx.filter blur(s) spreads its ink about three standard deviations past the edge.
const BLUR_SPREAD_SIGMAS = 3;

function annotateNode(n, parent, inheritedBlur) {
  const m = multiply(parent, localMatrix(n));
  const blur = n.blur > 0 ? n.blur : inheritedBlur; // a blurred parent blurs its children too (see draw.mjs)
  const children = n.children.map((child) => annotateNode(child, m, blur));
  const own = localBounds(n);
  const boxes = [...(own ? [transformBox(m, own)] : []), ...children.map((c) => c.bbox)];
  const bbox = boxes.length > 0 ? union(boxes) : [clean(m[4]), clean(m[5]), 0, 0];
  return { ...n, children, bbox, spread: blur * BLUR_SPREAD_SIGMAS, ...(n.type === 'text' ? { layout: n.props.layout } : {}) };
}

/** The sampled tree with a canvas-pixel `bbox: [x, y, w, h]` on every node (a group's is its children's union),
 *  a `spread` (px the blur adds beyond the box; 0 without blur, never added to the box) and, on a text node, its
 *  `layout`. Plain data, so it crosses page.evaluate. */
export function annotate(sampled) {
  return sampled.map((n) => annotateNode(n, IDENTITY, 0));
}

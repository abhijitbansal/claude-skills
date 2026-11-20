// Where a shot's marks stand on the frame, computed one way for the captions that keep off them (engine/captions
// index.mjs, which places a zone) and for the review that judges a caption over them (frame.mjs caption-covers), so the
// judge never disagrees with the placer (branch review A, I4). Both walk a sampled tree (the review's snapshot is one,
// with boxes added) through engine/page/bounds.mjs localMatrix, the one place a node's transform becomes a matrix, and
// take a marked path's box from its points (devices/shared.mjs pathPoints: the corners of a polyline or a rounded
// rectangle, the control points of a curve, which hold the curve), grown by half its stroke and its roughness as the
// page's own bounds are. Pure and DOM-free: the page's measured bbox needs a document, the placer has none.
import { localMatrix } from '../page/bounds.mjs';
import { pathPoints } from '../devices/shared.mjs';
import { unionBox as union } from '../kinds/shared.mjs';

const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);
const HALF = 2;
const HAS_NUMBER = /\d/;
const isBox = (box) => box.every(Number.isFinite);

const multiply = (p, q) => [p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1], p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3],
  p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5]];

/**
 * Does a node show anything of its own? A text with a word above opacity 0 (or no word tracks), a path with its fill
 * finished or some of its stroke drawn, an image; a group shows only through its children. `reveal` 0 hides all.
 */
export function showsItself(n) {
  if ((n.reveal ?? 1) <= 0) return false;
  if (n.type === 'text') return !Array.isArray(n.words) || n.words.length === 0 || n.words.some((w) => (w.opacity ?? 1) > 0);
  if (n.type === 'path') return (Boolean(n.props?.fill) && (n.draw ?? 1) >= 1) || (Boolean(n.props?.stroke) && (n.draw ?? 1) > 0);
  return n.type === 'image';
}

/**
 * The canvas box of path node `n` through matrix `m` (its own transform included): the box of its points, grown by half
 * its stroke width and its roughness, its corners through `m`. Null for a path with no points, or one whose box is not
 * made of finite numbers (the review never throws on a path it cannot read: frame.mjs).
 */
export function pathBox(n, m) {
  const points = typeof n.props?.d === 'string' && HAS_NUMBER.test(n.props.d) ? pathPoints(n.props.d) : [];
  if (points.length === 0) return null;
  const [x, y, w, h] = union(points.map(([px, py]) => [px, py, 0, 0]));
  const grow = (n.props.stroke ? (n.props.strokeWidth ?? 1) / HALF : 0) + (n.props.rough ?? 0);
  const corners = [[x - grow, y - grow], [x + w + grow, y - grow], [x - grow, y + h + grow], [x + w + grow, y + h + grow]];
  const box = union(corners.map(([cx, cy]) => [m[0] * cx + m[2] * cy + m[4], m[1] * cx + m[3] * cy + m[5], 0, 0]));
  return isBox(box) ? box : null;
}

/**
 * Visits every node of a sampled tree on screen (accumulated opacity above 0) as visit(n, m, parent): `m` its matrix to
 * the canvas, its own transform included, and `parent` the node it sits in (null at the top).
 */
export function walkPlaced(sampled, visit) {
  const walk = (n, parentMatrix, opacity, parent) => {
    const o = opacity * (n.opacity ?? 1);
    if (o <= 0) return;
    const m = multiply(parentMatrix, localMatrix({ scale: 1, scaleX: 1, scaleY: 1, rotate: 0, x: 0, y: 0, ...n }));
    visit(n, m, parent);
    (n.children ?? []).forEach((child) => walk(child, m, o, n));
  };
  (Array.isArray(sampled) ? sampled : []).forEach((n) => walk(n, IDENTITY, 1, null));
}

/**
 * Where the marks `ids` stand in a sampled tree (camera applied), as { id, box }: for each mark on screen, the union of
 * its drawn paths' boxes (pathBox: a frame, a circle, a band, a line; never a region highlight's paper scrim, `<id>.scrim`).
 */
export function markBoxes(sampled, ids) {
  const wanted = new Set(ids), marks = new Map(), found = new Map();
  if (wanted.size === 0) return [];
  walkPlaced(sampled, (n, m, parent) => {
    const mark = wanted.has(n.id) ? n.id : marks.get(parent) ?? null;
    if (mark === null) return;
    marks.set(n, mark);
    const box = n.type === 'path' && !n.id.endsWith('.scrim') && showsItself(n) ? pathBox(n, m) : null;
    if (box !== null) found.set(mark, [...(found.get(mark) ?? []), box]);
  });
  return [...found].map(([id, boxes]) => ({ id, box: union(boxes) }));
}

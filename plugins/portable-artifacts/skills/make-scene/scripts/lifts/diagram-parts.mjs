// What the flat and the sequence lifts share: scale, the block each node kind becomes, edge colours,
// rounded tube routes, the per-kind legend groups and camera views. Pure; no sibling is loaded here.
import { groupColour } from '../lib/palette.mjs';

export const SCALE = 40; // 2D px -> world units
export const px = (v) => v / SCALE;

export const TUBE_RADIUS = 0.05;
const ROUND_CORNER = 0.3; // how far from a corner a route starts to bend
const MIN_SEGMENT = 0.01; // a spline through two coincident points is NaN: routes never repeat a point
const DISPLAY_MAX = 120; // tooltip text: a node's detail, cut here (the diagram keeps the full text)
const MIN_FOOTPRINT = 0.5;

/** Collapse whitespace; the label as one line. */
export const oneLine = (text) => String(text).replace(/\s+/g, ' ').trim();

/** The tooltip line under a node's label: its detail, else its kind. Cut to DISPLAY_MAX characters. */
export function displayOf(entry) {
  const text = entry.detail !== undefined && entry.detail !== '' ? oneLine(entry.detail) : entry.kind;
  return text.length > DISPLAY_MAX ? `${text.slice(0, DISPLAY_MAX - 1)}…` : text;
}

// ---- blocks ---------------------------------------------------------------

const BOX_HEIGHT = 0.6;
const CYLINDER_HEIGHT = 0.9;
const DISC_HEIGHT = 0.3;
const CONE_HEIGHT = 1;
const SLAB_HEIGHT = 0.2;
const SLAB_PITCH = 0.28;
const SLAB_COUNT = 3;

const SHAPE_OF_KIND = {
  database: 'cylinder', storage: 'cylinder', queue: 'box', start: 'disc', end: 'disc', decision: 'cone', choice: 'cone',
};

/** The batch shape a kind is drawn with: database/storage cylinder, queue stacked boxes, start/end disc, decision/choice cone, else box. */
export const shapeOfKind = (kind) => SHAPE_OF_KIND[kind] ?? 'box';

/**
 * The instances (without an item index) of one block of `kind` standing on `base` over a footprint
 * w x d centred on (x, z), and the y of its top. A queue is three stacked slabs of the same shape.
 */
export function blockOf(kind, { x, z, w, d, base }) {
  const fw = Math.max(w, MIN_FOOTPRINT);
  const fd = Math.max(d, MIN_FOOTPRINT);
  if (kind === 'queue') {
    const slabs = Array.from({ length: SLAB_COUNT }, (_, k) => [x, base + SLAB_HEIGHT / 2 + k * SLAB_PITCH, z, fw, SLAB_HEIGHT, fd]);
    return { instances: slabs, top: base + (SLAB_COUNT - 1) * SLAB_PITCH + SLAB_HEIGHT };
  }
  const height = { cylinder: CYLINDER_HEIGHT, disc: DISC_HEIGHT, cone: CONE_HEIGHT, box: BOX_HEIGHT }[shapeOfKind(kind)];
  return { instances: [[x, base + height / 2, z, fw, height, fd]], top: base + height };
}

// ---- legend groups: one per kind, in order of first appearance -------------

/** { groups, indexOf, batches }: graph.groups (name, colour) and one empty batch per kind. Batch i belongs to group i. */
export function kindGroups(kinds) {
  const order = [...new Set(kinds)];
  return {
    groups: order.map((name, i) => ({ name, colour: groupColour(i) })),
    indexOf: new Map(order.map((name, i) => [name, i])),
    batches: order.map((name, i) => ({ id: `b${i}`, shape: shapeOfKind(name), colour: groupColour(i), emissive: null, flat: false, instances: [] })),
  };
}

// ---- edges ---------------------------------------------------------------

const STYLE_COLOUR = { solid: 'text', sync: 'text', dashed: 'text2', reply: 'text2', async: 'accent' };
/** solid/sync -> text, dashed/reply -> text2, async -> accent. */
export const colourOfStyle = (style) => STYLE_COLOUR[style] ?? 'text';

/**
 * An orthogonal route with its corners cut: each interior vertex becomes an entry and an exit point
 * ROUND_CORNER away, so the spline the runtime draws through them bends there and runs straight elsewhere.
 */
export function rounded(points) {
  const out = [points[0]];
  const push = (p) => {
    const last = out.at(-1);
    if (Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) > MIN_SEGMENT) out.push(p);
  };
  for (let i = 1; i < points.length - 1; i++) {
    const [prev, at, next] = [points[i - 1], points[i], points[i + 1]];
    const lead = (to) => {
      const len = Math.hypot(to[0] - at[0], to[2] - at[2]);
      const reach = Math.min(ROUND_CORNER, len / 2);
      return len === 0 ? at : [at[0] + ((to[0] - at[0]) / len) * reach, at[1], at[2] + ((to[2] - at[2]) / len) * reach];
    };
    push(lead(prev));
    push(lead(next));
  }
  push(points.at(-1));
  return out;
}

// ---- views ---------------------------------------------------------------

const FIT = 2.4;
const unit = (v) => v.map((c) => c / Math.hypot(...v));

/** A camera that looks at the middle of `bounds` from `dir`, far enough to take in its bounding sphere. */
export function cameraFor({ min, max }, dir) {
  const centre = min.map((lo, a) => (lo + max[a]) / 2);
  const radius = Math.max(1, Math.hypot(...min.map((lo, a) => (max[a] - lo) / 2)));
  const d = unit(dir);
  return { position: centre.map((c, a) => c + d[a] * radius * FIT), target: centre };
}

/** A view of `target` from `dir` at `distance`. */
export function viewOf(target, dir, distance) {
  const d = unit(dir);
  return { position: target.map((c, a) => c + d[a] * distance), target };
}

const ROUTE_VIEW_MIN = 11;
const ROUTE_VIEW_PER_UNIT = 2.2; // a view is authored for a square viewport, the route's ends within 55% of the half-frame; the runtime widens it for a narrower one
const ROUTE_VIEW_MARGIN = 1.5; // room for the blocks at both ends

/** A view that takes in a whole route (both end blocks and everything between): its middle, from `dir`, far enough back for its extent. */
export function routeView(points, dir) {
  const lo = [0, 1, 2].map((a) => Math.min(...points.map((p) => p[a])));
  const hi = [0, 1, 2].map((a) => Math.max(...points.map((p) => p[a])));
  const reach = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  return viewOf(lo.map((c, a) => (c + hi[a]) / 2), dir, Math.max(ROUTE_VIEW_MIN, ROUTE_VIEW_PER_UNIT * (reach + ROUTE_VIEW_MARGIN)));
}

/** Focus keys: ids first (lowercased), then labels that are not already a key; the first view wins. */
export function focusFrom(idViews, labelViews) {
  const out = new Map();
  for (const [key, view] of [...idViews, ...labelViews]) {
    const lower = key.toLowerCase();
    if (!out.has(lower)) out.set(lower, view);
  }
  return Object.fromEntries(out);
}

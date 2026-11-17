// The `cover` cut (version 1's `slide`): the incoming shot slides in from an edge over the outgoing one, which stays
// where it is. The incoming shot brings its own backdrop (its background colour over the whole canvas) and its own
// copy of the shared background (the film's field, depth > 0), so it covers what it slides over as a new sheet would;
// the shared background under the outgoing shot stays put. On identical paper a sheet's edge does not show, so the look
// may give the sheet a visible leading edge (look.coverEdge): a keyline and a soft shadow just outside the side that
// leads, cast on the outgoing shot. Both lie outside the sheet, so they leave the canvas with it at the end.
// Registered by index.mjs, which this file imports only inside functions (the two import each other). Pure and DOM-free.
import { ease } from '../time/ease.mjs';
import { EDGES, shifted, edgeOffset, edgeTravel, backgroundIds, backgroundNode, backdropNode } from './index.mjs';
import { ENTRY_EDGE, OPPOSITE_EDGE } from './edges.mjs';
import { localMatrix } from '../page/bounds.mjs';

const SNAP_TIE = 1e-6; // px: two ends of a run this close to the eased offset go to the one nearer home
const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);

const COVER_EASE = 'inOutCubic';
const COVER_ID = 'cover'; // the backdrop and the copies of the shared background the incoming shot carries: <id>.cover
// The side of the sheet that leads, for a direction: the side across from the edge it enters by.
const LEADING = Object.freeze(Object.fromEntries(Object.entries(ENTRY_EDGE).map(([direction, edge]) => [direction, OPPOSITE_EDGE[edge]])));

// The shared background's copy that travels with the incoming shot: the same node under its own id.
const travelling = (n) => Object.freeze({ ...n, id: `${n.id}.${COVER_ID}` });

// A band just outside `side` of a sheet the size of the canvas, from `near` to `far` pixels out.
function band(side, near, far, { w, h }) {
  if (side === 'left') return `M${-far} 0H${-near}V${h}H${-far}Z`;
  if (side === 'right') return `M${w + near} 0H${w + far}V${h}H${w + near}Z`;
  if (side === 'top') return `M0 ${-far}H${w}V${-near}H0Z`;
  return `M0 ${h + near}H${w}V${h + far}H0Z`;
}

const bandNode = (id, d, fill, opacity) => Object.freeze({
  type: 'path', id, depth: 0, props: Object.freeze({ d, fill }),
  x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity, draw: 1, reveal: 1, blur: 0, visible: opacity > 0, children: Object.freeze([]),
});

/**
 * The leading edge of a cover sheet as nodes, from look.coverEdge = { line?: { color, width, alpha }, shadow?: { color,
 * width, alpha, steps } } (colours are palette keys): the keyline right at the edge, then the shadow in `steps` bands
 * that fade outwards. [] when the look gives none.
 */
export function coverEdgeNodes(edge, direction, canvas, palette) {
  if (!edge) return [];
  const side = LEADING[direction];
  const line = edge.line ? [bandNode(`${COVER_ID}.edge.line`, band(side, 0, edge.line.width, canvas), palette[edge.line.color], edge.line.alpha)] : [];
  const from = edge.line?.width ?? 0;
  const shadow = edge.shadow ? Array.from({ length: edge.shadow.steps }, (_, k) => {
    const step = edge.shadow.width / edge.shadow.steps;
    const fade = (1 - k / edge.shadow.steps) ** 2;
    return bandNode(`${COVER_ID}.edge.shadow${k}`, band(side, from + k * step, from + (k + 1) * step, canvas), palette[edge.shadow.color], edge.shadow.alpha * fade);
  }) : [];
  return [...shadow, ...line];
}

// ---- the snapped sheet (look.cutStyle.cover.snap, poster: gate-poster-2 ruling 7) ----

const times = (p, q) => [p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1], p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3], p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5]];
// A text's box through matrix m, as a canvas box: its layout box and its lines' ink reach (INK_UP ems over the first
// baseline, INK_DOWN under the last), which a display face set at line height 0.9 passes (gate render p9: capitals
// over a tight layout box were sliced).
const INK_UP = 1;
const INK_DOWN = 0.3;
function layoutBox(m, { width, height, lines = [] }, size = 0) {
  const top = lines.length > 0 ? Math.min(0, lines[0].y - INK_UP * size) : 0;
  const bottom = lines.length > 0 ? Math.max(height, lines.at(-1).y + INK_DOWN * size) : height;
  const pts = [[0, top], [width, top], [0, bottom], [width, bottom]].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
}

// The canvas boxes of every visible text in a sampled tree: its layout box through the node transforms draw.mjs applies
// (page/bounds.mjs localMatrix; no path is measured, so no page is needed).
function textBoxes(sampled) {
  const walk = (n, parent, alpha) => {
    const a = alpha * (n.opacity ?? 1);
    if (a <= 0) return [];
    const m = times(parent, localMatrix(n));
    const own = n.type === 'text' && n.props?.layout ? [layoutBox(m, n.props.layout, n.props.font?.size ?? 0)] : [];
    return [...own, ...n.children.flatMap((c) => walk(c, m, a))];
  };
  return sampled.flatMap((n) => walk(n, IDENTITY, 1));
}

// The open intervals of sheet offset (along `axis`, from its start `s0` to 0) at which a word would be cut: an outgoing
// text across the sheet's leading edge, an incoming one across the frame's far edge, and the last `tail` of the frame
// before home (the incoming chrome then stacks against the outgoing chrome).
function cutIntervals({ from, to, axis, s0, L, tail }) {
  const span = (b) => [b[axis], b[axis] + b[axis + 2]];
  const out = textBoxes(from).map(span).map(([lo, hi]) => (s0 > 0 ? [lo, hi] : [lo - L, hi - L]));
  const into = textBoxes(to).map(span).map(([lo, hi]) => (s0 > 0 ? [L - hi, L - lo] : [-hi, -lo]));
  const home = s0 > 0 ? [0, tail * L] : [-tail * L, 0];
  return [...out, ...into, home].filter(([lo, hi]) => hi > lo).sort((a, b) => a[0] - b[0]).reduce((merged, [lo, hi]) => {
    const last = merged.at(-1);
    return last && lo <= last[1] ? [...merged.slice(0, -1), [last[0], Math.max(last[1], hi)]] : [...merged, [lo, hi]];
  }, []);
}

/**
 * The sheet's offset at eased progress c, snapped (look data `snap: { tail }`): the eased offset, or, where a word would
 * be cut there, the nearer end of that run of offsets (toward home on a tie), so no frame holds a half-sliced word and
 * the sheet jumps the last `tail` of the frame. -> (c) => [dx, dy]
 */
export function snappedOffset({ from, to, canvas, direction, snap }) {
  const start = edgeOffset(direction, 0, canvas);
  const axis = Math.abs(start[0]) > Math.abs(start[1]) ? 0 : 1;
  const s0 = start[axis], L = axis === 0 ? canvas.w : canvas.h;
  const runs = cutIntervals({ from, to, axis, s0, L, tail: snap.tail ?? 0 });
  const [lo, hi] = [Math.min(s0, 0), Math.max(s0, 0)];
  return (c) => {
    const raw = edgeOffset(direction, c, canvas)[axis];
    const run = runs.find(([a, b]) => raw > a && raw < b);
    const ends = run === undefined ? [raw] : [run[0], run[1]].filter((e) => e >= lo && e <= hi);
    const to0 = (e) => Math.abs(e - raw) - (Math.abs(e) < Math.abs(raw) ? SNAP_TIE : 0);
    const o = ends.length === 0 ? raw : ends.reduce((best, e) => (to0(e) < to0(best) ? e : best));
    return axis === 0 ? [o, 0] : [0, o];
  };
}

/** The cover's parts (index.mjs defineCut: still, moving(q), travel, vector, over). */
export function coverParts({ from, to, p, canvas, look, background, direction }) {
  const curve = ease(COVER_EASE);
  const snap = look?.cutStyle?.cover?.snap;
  const offsetAt = snap ? snappedOffset({ from, to, canvas, direction, snap }) : (c) => edgeOffset(direction, c, canvas);
  const outgoing = new Map(from.map((n) => [n.id, n]));
  const shared = backgroundIds(from, to);
  const ground = to.filter((n) => shared.has(n.id));
  const still = [
    ...ground.map((n) => backgroundNode(outgoing.get(n.id), n, curve(p))),
    ...from.filter((n) => !shared.has(n.id)),
  ];
  const sheet = [
    ...(background === undefined ? [] : [backdropNode(`${COVER_ID}.backdrop`, canvas, background)]),
    ...ground.map(travelling),
    ...to.filter((n) => !shared.has(n.id)),
  ];
  const moving = (q) => shifted(sheet, ...offsetAt(curve(q)));
  // The leading edge rides with the sheet but is drawn over the smear, sharp at this frame's place: a thin keyline
  // averaged over the shutter loses its colour (look review gate-cuts-1, pop cover).
  const edge = shifted(coverEdgeNodes(look?.coverEdge, direction, canvas, look?.palette ?? {}), ...offsetAt(curve(p)));
  return { still, moving, travel: edgeTravel(curve, direction, canvas), vector: [...EDGES[direction]], over: edge };
}

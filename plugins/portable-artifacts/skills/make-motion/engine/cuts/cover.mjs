// The `cover` cut (version 1's `slide`): the incoming shot slides in from an edge over the outgoing one, which stays
// where it is. The incoming shot brings its own backdrop (its background colour over the whole canvas) and its own
// copy of the shared background (the film's field, depth > 0), so it covers what it slides over as a new sheet would;
// the shared background under the outgoing shot stays put. On identical paper a sheet's edge does not show, so the look
// may give the sheet a visible leading edge (look.coverEdge): a keyline and a soft shadow just outside the side that
// leads, cast on the outgoing shot. Both lie outside the sheet, so they leave the canvas with it at the end.
// Registered by index.mjs, which this file imports only inside functions (the two import each other). Pure and DOM-free.
import { ease } from '../time/ease.mjs';
import { EDGES, shifted, edgeOffset, edgeTravel, backgroundIds, backgroundNode, backdropNode } from './index.mjs';

const COVER_EASE = 'inOutCubic';
const COVER_ID = 'cover'; // the backdrop and the copies of the shared background the incoming shot carries: <id>.cover
// The side of the sheet that leads, for the edge the sheet comes from: it moves away from that edge.
const LEADING = Object.freeze({ right: 'left', left: 'right', up: 'bottom', down: 'top' });

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

/** The cover's parts (index.mjs defineCut: still, moving(q), travel, vector, over). */
export function coverParts({ from, to, p, canvas, look, background, direction }) {
  const curve = ease(COVER_EASE);
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
    ...coverEdgeNodes(look?.coverEdge, direction, canvas, look?.palette ?? {}),
  ];
  const moving = (q) => shifted(sheet, ...edgeOffset(direction, curve(q), canvas));
  return { still, moving, travel: edgeTravel(curve, direction, canvas), vector: [...EDGES[direction]], over: [] };
}

// The `cover` cut (version 1's `slide`): the incoming shot slides in from an edge over the outgoing one, which stays
// where it is. The incoming shot brings its own backdrop (its background colour over the whole canvas) and its own
// copy of the shared background (the film's field, depth > 0), so it covers what it slides over as a new sheet would;
// the shared background under the outgoing shot stays put. Registered by index.mjs, which this file imports only inside
// functions (the two import each other). Pure and DOM-free.
import { ease } from '../time/ease.mjs';
import { shifted, edgeOffset, backgroundIds, backgroundNode, backdropNode, smeared } from './index.mjs';

const COVER_EASE = 'inOutCubic';
const COVER_ID = 'cover'; // the backdrop and the copies of the shared background the incoming shot carries: <id>.cover

// The shared background's copy that travels with the incoming shot: the same node under its own id.
const travelling = (n) => Object.freeze({ ...n, id: `${n.id}.${COVER_ID}` });

/** The cover blend (index.mjs defineCut calls it for 0 < p < 1). */
export function cover({ from, to, p, canvas, frame, background, direction }) {
  const e = ease(COVER_EASE)(p);
  const outgoing = new Map(from.map((n) => [n.id, n]));
  const shared = backgroundIds(from, to);
  const ground = to.filter((n) => shared.has(n.id));
  const still = [
    ...ground.map((n) => backgroundNode(outgoing.get(n.id), n, e)),
    ...from.filter((n) => !shared.has(n.id)),
  ];
  const sheet = [
    ...(background === undefined ? [] : [backdropNode(`${COVER_ID}.backdrop`, canvas, background)]),
    ...ground.map(travelling),
    ...to.filter((n) => !shared.has(n.id)),
  ];
  const place = (q) => shifted(sheet, ...edgeOffset(direction, ease(COVER_EASE)(q), canvas));
  return smeared(place, still, { p, frame, canvas, background });
}

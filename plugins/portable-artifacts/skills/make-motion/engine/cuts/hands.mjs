// The one hand of a cut (looks-four, marker gate 2 rulings 1 and 2). In a look with a drawing hand the sampled frames of a
// cut each hold the hand (id 'hand') of their own shot. A cut never draws two: the outgoing hand leaves the frame by the
// right edge, and the incoming board's hand comes in from the same edge once and goes where that board's first stroke is
// (`landing`, the incoming shot as the cut ends, else the incoming frame itself). Pure and DOM-free; a frame without a hand
// is returned as it is, so a look without one (desk, pop, cosmos) draws exactly what it drew.
import { node } from '../graph/node.mjs';
import { sampleGraph } from '../graph/sample.mjs';
import { handNodes } from '../hand/shape.mjs';

export const HAND_ID = 'hand';
// the tip's x, as a share of the canvas width, when the marker hand is out of frame on the right: its body lies to the right of
// the tip, so the whole hand is beyond the edge
const OFF_RIGHT = 1.08;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (v) => v * v * (3 - 2 * v);
const lerp = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];

/** The hand node of a sampled frame, or undefined. */
export const handOf = (frame) => frame.find((n) => n.id === HAND_ID);
/** `frame` without its hand. */
export const withoutHand = (frame) => frame.filter((n) => n.id !== HAND_ID);

/** `hand` moved to (x, y). */
export const placed = (hand, [x, y]) => Object.freeze({ ...hand, x, y });

/** Where the hand is when out of frame on the right, at height y. */
export const offRight = (canvas, y, reach = 0) => [canvas.w * OFF_RIGHT + reach, y];

/** `hand` leaving by the right edge, `s` (0 to 1) of the way: where it was at 0, out of frame at 1. */
export function leaving(hand, s, canvas, reach = 0) {
  return placed(hand, lerp([hand.x, hand.y], offRight(canvas, hand.y, reach), smooth(clamp01(s))));
}

/** `hand` coming in from the right edge to `target` ({ x, y }), `s` of the way: out of frame at 0, on `target` at 1. */
export function arriving(hand, target, s, canvas, reach = 0) {
  return placed(hand, lerp(offRight(canvas, target.y, reach), [target.x, target.y], smooth(clamp01(s))));
}

/** The progress of a stretch [from, to] of p, held 0 before and 1 after. */
export const within = (p, from, to) => clamp01((p - from) / (to - from));

/**
 * The incoming board's hand during a cut at progress p: out of frame until `from`, then coming in to its landing place by `to`.
 * [] when the incoming shot has no hand.
 */
export function incomingHand({ to, landing, p, canvas, from, until }) {
  const hand = handOf(to);
  if (!hand || p < from) return [];
  const target = handOf(landing ?? to) ?? hand;
  return [arriving(hand, target, within(p, from, until), canvas)];
}

/**
 * The hand holding an eraser, a sampled node at the origin: the same hand with a felt board eraser in place of the marker. `size`
 * is the eraser's [long side, short side] in px.
 */
export function eraserHand(look, canvas, unit, size, like) {
  const group = node('group', HAND_ID, { role: 'hand', rotate: look.hand.eraserAngle ?? 0 }, { children: handNodes(look, unit, { tool: 'eraser', size }) });
  return Object.freeze({ ...sampleGraph([group], 0)[0], depth: like?.depth ?? 0 });
}

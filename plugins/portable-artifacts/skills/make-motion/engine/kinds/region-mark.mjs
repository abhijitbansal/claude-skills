// What a `highlight` aimed at a clipping region draws. A filled marker band disappears over a dark picture, so a region
// highlight is a marker frame around the region, drawn on side by side, with everything of the picture card around it
// (its mount, tape and shadow too) receding under a scrim of the look's paper that has the region cut out of it (the
// region itself stays clean). A hand look (desk) draws the frame as four marker strokes 7 units wide
// that hug the region with a 6-unit gap and overshoot the corners a little, each drawn twice, the second pass the same
// geometry moved a unit or so, so the stroke reads as marker rather than vector; stepped at its hand rate. A crisp look
// draws a ruled, square-cornered frame. Built from plain nodes in the picture's own space (the caller puts them in a
// group turned like the picture). Pure, DOM-free.
import { node } from '../graph/node.mjs';
import { landing, isHand, colourOf, deviceRng, spread, smoothPath, polyline } from '../devices/shared.mjs';
import { paperScrim, SCRIM } from './shared.mjs';

export { paperScrim, SCRIM } from './shared.mjs'; // where they live now

// units; gap is the clear space between the region and the stroke's inner edge, pass the second pass's offset and
// alpha each pass's opacity (where the two passes overlap the stroke reads denser, as marker ink does)
const HAND = Object.freeze({ width: 7, overshoot: 6, wobble: 1.5, gap: 6, cap: 'round', pass: [1.2, -1.2], alpha: 0.85 });
const CRISP = Object.freeze({ width: 10, overshoot: 0, wobble: 0, gap: 5, cap: 'square', pass: null, alpha: 1 });
// opacity of the paper scrim outside the region: the surroundings recede into the paper and a figure sliced at the frame
// edge fades toward the paper (look gate fix pass F1: tuned on the rendered desk proof within 0.6 to 0.8; at 0.72 a
// sliced "59" still read as a number)
const DRAW_SHARE = 2; // the frame takes this many of the look's draw moves, a quarter of it per side
const SIDES = 4;

/** How long a region frame takes to draw in `look`, all four sides. */
export const markDuration = (look) => DRAW_SHARE * look.moves.draw.dur;
const STROKE_POINTS = 4; // points along a hand stroke, ends included

// The points of one hand stroke from a to b: it runs `overshoot` past each corner, except past a corner at `floor` (the
// frame's bottom edge) on a stroke that runs down to it, so a side never reaches into the picture below the region;
// its points sit off the line by a seeded wobble.
function handPoints(a, b, spec, unit, rng, floor) {
  const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
  const along = [dx / length, dy / length], normal = [-along[1], along[0]];
  const side = dx === 0;
  const overAt = (p) => (side && p[1] === floor ? 0 : spec.overshoot * unit);
  const start = [a[0] - along[0] * overAt(a), a[1] - along[1] * overAt(a)];
  const span = length + overAt(a) + overAt(b);
  return Array.from({ length: STROKE_POINTS }, (_, i) => {
    const f = i / (STROKE_POINTS - 1), off = spread(rng, spec.wobble) * unit;
    return [start[0] + along[0] * span * f + normal[0] * off, start[1] + along[1] * span * f + normal[1] * off];
  });
}

/**
 * The nodes of a region highlight: [scrim, side0..side3], every coordinate in the space of the group the caller puts
 * them in.
 * @param {{ id: string, region: number[], cover?: number[][][], at: number, look: object, unit: number, seed: number }} p
 *   region is [x, y, w, h]; `cover` is the outlines the scrim lies on (the whole picture card), each a clockwise list of
 *   [x, y] points; the frame closes, and the scrim reaches SCRIM, on `at`. Without `cover` there is no scrim (a
 *   close-up that is all region has nothing around it).
 */
export function regionMark({ id, region, cover, at, look, unit, seed }) {
  const hand = isHand(look);
  const spec = hand ? HAND : CRISP;
  const pad = (spec.gap + spec.width / 2) * unit; // the stroke's centre line
  const [x, y, w, h] = region;
  const corners = [[x - pad, y - pad], [x + w + pad, y - pad], [x + w + pad, y + h + pad], [x - pad, y + h + pad]];
  const start = Math.max(0, at - DRAW_SHARE * look.moves.draw.dur);
  const seg = (at - start) / SIDES;
  const step = hand ? look.moves.draw.step : undefined;
  const rng = deviceRng(seed, id, 'region-mark');
  const sides = corners.flatMap((a, i) => {
    const b = corners[(i + 1) % SIDES];
    const points = hand ? handPoints(a, b, spec, unit, rng, corners[2][1]) : [a, b];
    const draw = landing(start + seg * (i + 1), { ease: look.moves.draw.ease, dur: seg }, 0, 1, step);
    const props = { stroke: colourOf(look, 'accent'), strokeWidth: spec.width * unit, lineCap: spec.cap, ...(spec.alpha < 1 ? { opacity: spec.alpha } : {}) };
    const pathOf = (pts) => (hand ? smoothPath(pts) : polyline(pts));
    const first = node('path', `${id}.side${i}`, { ...props, d: pathOf(points) }, { tracks: { draw }, step });
    if (!spec.pass) return [first];
    const moved = points.map(([x, y]) => [x + spec.pass[0] * unit, y + spec.pass[1] * unit]);
    return [first, node('path', `${id}.side${i}.pass2`, { ...props, d: pathOf(moved) }, { tracks: { draw }, step })];
  });
  if (cover === undefined) return sides;
  return [paperScrim({ id: `${id}.scrim`, cover, hole: region, at, dur: at - start, look }), ...sides];
}

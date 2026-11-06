// Browser-safe and DOM-free: when each stroke of a hand-drawn scene starts and ends. Natural pace only: elements draw in
// document order, one after another, the hand travelling between strokes. A narration-driven schedule (sentence windows)
// joins here later: `schedule` takes the length of a stroke from `secondsOf`, so a schedule that stretches strokes into a
// window passes its own, and `items` may grow a window beside `drawAt` without the caller changing.

// Speeds at 1080 on the canvas's short side (px per second; scaled by the canvas's `u`), and writing in characters per second.
export const LINE_SPEED = 2700;
export const ICON_SPEED = 2000;
export const FILL_SPEED = 9000;
export const WRITE_CPS = 22;
// A stroke never lasts less than this, however short: a barb of an arrow head, an icon's dot, any other line.
const MIN_SECONDS = Object.freeze({ line: 0.08, head: 0.07, icon: 0.06, fill: 0.08 });
const SPEEDS = Object.freeze({ line: LINE_SPEED, head: LINE_SPEED, icon: ICON_SPEED, fill: FILL_SPEED });

// The hand: it waits HAND_LEAD at the start, travels between strokes, and needs HAND_EXIT to leave once the last is drawn.
export const HAND_LEAD = 0.25;
export const HAND_EXIT = 0.65;
const TRAVEL_BASE = 0.04;
const TRAVEL_MAX = 0.3;
const TRAVEL_SPEED = 3600; // px per second at 1080 added to the base
const TRAVEL_SKIP = 4; // px at 1080: a hand this close to the next stroke does not move
const HOME_OFFSET = Object.freeze([380, 370]); // px at 1080 past the lower right corner: where the hand waits, off canvas

/** Where the hand enters from and leaves to: past the lower right corner of the canvas. */
export const handHome = (size, u) => [size[0] + HOME_OFFSET[0] * u, size[1] + HOME_OFFSET[1] * u];

/** Seconds the hand takes to move from `from` to `to` (canvas px) on a canvas whose unit is `u`. */
export function travelSeconds(from, to, u) {
  const dist = Math.hypot(to[0] - from[0], to[1] - from[1]);
  return dist < TRAVEL_SKIP * u ? 0 : Math.min(TRAVEL_MAX, TRAVEL_BASE + dist / (TRAVEL_SPEED * u));
}

/**
 * Seconds `stroke` takes at the natural pace times `pace`. `stroke` is a draft: `{ kind, speed, total, chars }` where `speed`
 * is one of line, head, icon or fill (how fast the pencil moves) and `chars` counts the characters of a writing stroke.
 */
export function naturalSeconds(stroke, { u, pace }) {
  if (stroke.kind === 'write') return stroke.chars / WRITE_CPS / pace;
  return Math.max(MIN_SECONDS[stroke.speed], stroke.total / (SPEEDS[stroke.speed] * u)) / pace;
}

/**
 * Starts and ends every stroke of `items`, in order: `[{ drawAt?, strokes: draft[] }]`. A stroke starts once the hand has
 * travelled to it from where the last one ended; the first stroke of an item with `drawAt` (seconds in the scene) waits for it
 * if it would start sooner. -> { times: [[{ t0, t1 }, ...], ...] one list per item, drawEnd, moves } (drawEnd is 0 with no
 * strokes). `moves` is where the hand goes between the strokes, as `{ kind, t0, t1, from, to }`: the first is the `enter` from
 * home to the first stroke, each later one a `travel` (none when the hand has not far to go), and the last the `exit`, which
 * starts the moment the last stroke ends and takes HAND_EXIT, so the hand is off the canvas HAND_EXIT after drawEnd. A move
 * ends when the stroke it leads to starts; between moves the hand stays where the last one left it.
 */
export function schedule(items, { size, u, pace, startAfter = 0, secondsOf = naturalSeconds }) {
  const home = handHome(size, u);
  let cursor = startAfter + HAND_LEAD;
  let hand = home;
  let drawEnd = 0;
  const moves = [];
  const times = items.map((item) => item.strokes.map((stroke, i) => {
    const first = stroke.points[0];
    const travel = travelSeconds(hand, first, u);
    let t0 = cursor + travel;
    if (i === 0 && typeof item.drawAt === 'number') t0 = Math.max(t0, item.drawAt);
    if (travel > 0) moves.push({ kind: moves.length ? 'travel' : 'enter', t0: t0 - travel, t1: t0, from: [...hand], to: [...first] });
    const t1 = t0 + secondsOf(stroke, { u, pace });
    cursor = t1;
    drawEnd = t1;
    hand = stroke.points.at(-1);
    return { t0, t1 };
  }));
  if (moves.length || drawEnd > 0) moves.push({ kind: 'exit', t0: drawEnd, t1: drawEnd + HAND_EXIT, from: [...hand], to: [...home] });
  return { times, drawEnd, moves };
}

// Browser-safe and DOM-free: when each stroke of a hand-drawn scene starts and ends. Elements draw in document order, one
// after another, the hand travelling between strokes, at the natural pace. In a scene with narration an item also has a
// window (`assignWindows`: the sentences it draws during), and its strokes stretch to fill it, to half pace at most, or
// speed up to fit it, to twice pace at most.

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
// A window stretches the strokes inside it to this many times their natural length at most (half pace), and squeezes them to
// this share of it at least (twice pace). Travel between strokes keeps its own length.
export const STRETCH_MAX = 2;
export const SQUEEZE_MIN = 0.5;
const FIT_EPSILON = 1e-9;

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
 * The sentence span (its slot of narration) of every item, in order: `items` is `[{ weight, sentence? }]` (weight: the seconds its drawing takes at
 * the natural pace; sentence: the 0-based sentence it is pinned to), `narration` is `[{ start, end }]` in scene seconds.
 * -> [{ start, end, pinned }] one per item. An item without a pin goes with the sentences in order; a pinned one starts a new
 * run at its sentence, so earlier items use only the sentences before it and it and the items after it use the sentences from
 * its own on (until the next pin). A run with as many items as sentences gives item k sentence k; with any other count its
 * items share the run's whole narration in proportion to their weights. A run left with no sentence (a pin that comes before
 * where the items ahead of it must end) gives its items an empty span at the pin, which the schedule then reports as one
 * that cannot be met.
 */
export function assignWindows(items, narration) {
  const runs = [];
  items.forEach((item, index) => {
    if (Number.isInteger(item.sentence) || !runs.length) runs.push({ from: item.sentence ?? 0, members: [] });
    runs.at(-1).members.push(index);
  });
  const windows = new Array(items.length);
  runs.forEach((run, r) => {
    const to = r + 1 < runs.length ? runs[r + 1].from : narration.length;
    const spans = spansOf(run.members.map((i) => items[i].weight), narration, run.from, to);
    run.members.forEach((i, j) => { windows[i] = { ...spans[j], pinned: j === 0 && Number.isInteger(items[i].sentence) }; });
  });
  return windows;
}

// Where `weights.length` consecutive items draw, during the sentences from..to-1 of `narration`.
function spansOf(weights, narration, from, to) {
  if (to <= from || from >= narration.length) {
    const at = narration[Math.min(from, narration.length - 1)].start;
    return weights.map(() => ({ start: at, end: at }));
  }
  if (weights.length === to - from) return weights.map((_, j) => ({ start: narration[from + j].start, end: narration[from + j].end }));
  const [begin, end] = [narration[from].start, narration[to - 1].end];
  const total = weights.reduce((a, b) => a + b, 0);
  let used = 0;
  return weights.map((weight) => {
    const share = total > 0 ? weight / total : 1 / weights.length;
    const span = { start: begin + (end - begin) * used, end: begin + (end - begin) * (used + share) };
    used += share;
    return span;
  });
}

/**
 * Starts and ends every stroke of `items`, in order: `[{ drawAt?, slot?, strokes: draft[] }]`. A stroke starts once the hand has
 * travelled to it from where the last one ended; the first stroke of an item with `drawAt` (seconds in the scene) waits for it
 * if it would start sooner, and so does the first of one with a `slot` (its sentence span, { start, end } in scene seconds, see assignWindows)
 * for the slot's start. The strokes of an item with a slot last STRETCH_MAX times their natural length at most, so as to
 * end when the slot does, and at least SQUEEZE_MIN times it, so a slot too short for them at twice pace is not met: the
 * item is reported in `fits`. -> { times: [[{ t0, t1 }, ...], ...] one list per item, drawEnd, moves, fits } (drawEnd is 0 with no
 * strokes). `fits` is `[{ item, needed, available }]`, one per item whose slot is too short even at twice pace: `needed` is
 * the seconds the slot would have to last from its start, `available` the seconds it lasts. `moves` is where the hand goes
 * between the strokes, as `{ kind, t0, t1, from, to }`: the first is the `enter` from
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
  const fits = [];
  const times = items.map((item, index) => {
    const stretch = item.slot ? fitWindow(item, { hand, cursor, u, pace, secondsOf, floor: item.drawAt }) : null;
    if (stretch && stretch.overrun) fits.push({ item: index, ...stretch.overrun });
    return item.strokes.map((stroke, i) => {
      const first = stroke.points[0];
      const travel = travelSeconds(hand, first, u);
      let t0 = cursor + travel;
      if (i === 0 && typeof item.drawAt === 'number') t0 = Math.max(t0, item.drawAt);
      if (i === 0 && item.slot) t0 = Math.max(t0, item.slot.start);
      if (travel > 0) moves.push({ kind: moves.length ? 'travel' : 'enter', t0: t0 - travel, t1: t0, from: [...hand], to: [...first] });
      const t1 = t0 + secondsOf(stroke, { u, pace }) * (stretch?.factor ?? 1);
      cursor = t1;
      drawEnd = t1;
      hand = stroke.points.at(-1);
      return { t0, t1 };
    });
  });
  if (moves.length || drawEnd > 0) moves.push({ kind: 'exit', t0: drawEnd, t1: drawEnd + HAND_EXIT, from: [...hand], to: [...home] });
  return { times, drawEnd, moves, fits };
}

// How much longer (STRETCH_MAX at most) or shorter (SQUEEZE_MIN at least) than its natural length each stroke of `item` lasts
// so that the item ends with its window, from where the hand is: { factor, overrun? }. `overrun` is set when even SQUEEZE_MIN is too long.
function fitWindow(item, { hand, cursor, u, pace, secondsOf, floor }) {
  if (!item.strokes.length) return { factor: 1 };
  let [at, travels, natural] = [hand, 0, 0];
  item.strokes.forEach((stroke, i) => {
    if (i > 0) travels += travelSeconds(at, stroke.points[0], u);
    natural += secondsOf(stroke, { u, pace });
    at = stroke.points.at(-1);
  });
  const start = Math.max(cursor + travelSeconds(hand, item.strokes[0].points[0], u), typeof floor === 'number' ? floor : 0, item.slot.start);
  const room = item.slot.end - start - travels;
  const raw = room / natural;
  const factor = Math.min(STRETCH_MAX, Math.max(SQUEEZE_MIN, raw));
  if (raw >= SQUEEZE_MIN - FIT_EPSILON) return { factor };
  return { factor, overrun: { needed: start - item.slot.start + travels + SQUEEZE_MIN * natural, available: item.slot.end - item.slot.start } };
}

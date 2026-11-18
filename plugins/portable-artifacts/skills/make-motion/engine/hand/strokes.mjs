// The drawing hand's stroke plan (looks-four Task 2): what a hand shot draws, in draw order, and when. Each top-level
// node the hand can draw is an element: a text is written a line at a time (one `write` stroke per line, left to right
// through the middle of its letters), a stroked polyline path is drawn along its own points (`line`), a filled one is
// hatched over its box (`fill`). An element starts on the first word of its sentence and its strokes share the time to
// that sentence's end (the last landed LANDED_BEFORE_END before the shot ends); the hand travels between strokes in one
// eased move. The first element is complete on the shot's first frame: the time-lapse joins after it is drawn.
// Timing is a per-element speed model (m2): a stroke's time comes from its own length and kind (a word at handwriting
// speed, a rule faster, a hatch fastest), stretched to fill its sentence or compressed toward the speed cap; a run that does
// not fit runs on into the shot's hold (DRAW_TAIL), never starving the sentences after it; and when even that is short the
// hand sets its lesser strokes (hatches, decorative marks, figures) and draws the heroes. The hand-speed finding is judged on
// what is left, so it is as strict as before.
// Pure and DOM-free.
import { makeStroke, boxHatch } from './geometry.mjs';
import { latestLanding } from '../kinds/arrivals.mjs';
import { REST_SPEED } from './pose.mjs';

const WRITE_MID = 0.37; // em above the baseline: the middle of a line's lower-case letters, where the tip writes
const REST_TRAVEL_MIN = 0.12; // s: the shortest sweep in from the rest point (pose.mjs TRAVEL_MIN)
const TRAVEL_MIN = 0.05; // s: the shortest move between two strokes (a board of many short strokes, a chart's labels, must fit its sentence)
const TRAVEL_SPEED = 3600; // units a second the hand sweeps between strokes (an eased move peaks near 1.5 times this: no frame jumps far)
const FALLBACK_START = 0.2; // s: an unnarrated shot draws from here
const HATCH_GAP = 26; // units between the lines of a fill's hatch (the hand draws it fast: a wider gap is a shorter stroke)
// The per-element speed model: units a second each kind of stroke is drawn at when the sentence allows (a word at handwriting
// speed, a bar or a rule faster, a hatch fastest), never above the look's hand.maxSpeed; the cap is the finding's threshold.
const NATURAL_SPEED = Object.freeze({ write: 1100, line: 2000, fill: 2600 });
const NATURAL_SHARE = 0.85; // a natural speed stays this share of the cap at most, so a calm stroke is never on the threshold
const FLOOR_SLACK = 0.999; // the floor sits a hair under the cap: rounding must never put a planned stroke over it
const DEFAULT_CAP = 2600;
const HEAD_START = 0.12; // s: a drawFirst look's first stroke is begun this long before frame 0 (the pen is down on frame 0)
const DRAW_TAIL = 0.3; // s: a shot's hold the hand may draw into at most (the finished board still holds this long)
const POLYLINE = /^\s*M[\s\d.,eE+-]*(?:[LZ][\s\d.,eE+-]*)*$/;
const NUMBER = /-?\d*\.?\d+(?:e[+-]?\d+)?/gi;

/** The points of an absolute M/L/Z path (a polyline), or null for any other path. A closing Z repeats the first point. */
export function polylinePoints(d) {
  if (typeof d !== 'string' || !POLYLINE.test(d) || /M.*M/s.test(d)) return null;
  const nums = (d.match(NUMBER) ?? []).map(Number);
  if (nums.length < 4 || nums.length % 2 !== 0) return null;
  const points = [];
  for (let i = 0; i < nums.length; i += 2) points.push([nums[i], nums[i + 1]]);
  return /Z\s*$/i.test(d) ? [...points, [...points[0]]] : points;
}

const offset = (points, dx, dy) => points.map(([x, y]) => [x + dx, y + dy]);
const boxOf = (points) => {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
};

// A figure: a one-line text of a glyph or two in a label size (a value, a tick, a bullet). The hand may set it when it has no
// time to write it; a word of meaning, or anything set larger, is never a figure.
const FIGURE_EM = 1.6; // a figure is at most this many em wide
const FIGURE_MAX_SIZE = 72; // units: the largest a figure is set (the look's secondary minimum is 60)
const isFigure = (n, line, unit) => n.props.layout.lines.length === 1 && n.props.font.size / unit <= FIGURE_MAX_SIZE && line.width <= FIGURE_EM * n.props.font.size;

// The strokes of one node without times: [] for a node the hand does not draw.
function nodeStrokes(n, unit) {
  const { x = 0, y = 0 } = n.props;
  if (n.type === 'text' && n.props.layout && n.props.font) {
    const size = n.props.font.size;
    return n.props.layout.lines.map((line, k) => {
      const mid = y + line.y - WRITE_MID * size;
      return makeStroke([[x + line.x, mid], [x + line.x + line.width, mid]], { kind: 'write', line: k, lesser: isFigure(n, line, unit) });
    });
  }
  if (n.type !== 'path') return [];
  const points = polylinePoints(n.props.d);
  if (points === null) return [];
  // a ground (flatten.mjs groundOf): put on the board whole, never drawn
  if (n.props.put === true) return [makeStroke(offset(points, x, y), { kind: 'line', put: true })];
  if (n.props.stroke)return [makeStroke(offset(points, x, y), { kind: n.props.hatch === true ? 'fill' : 'line', lesser: n.props.decor === true })];
  if (!n.props.fill) return [];
  const [bx, by, bw, bh] = boxOf(offset(points, x, y));
  const hatch = boxHatch(bx + bw / 2, by + bh / 2, bw, bh, HATCH_GAP * unit, unit);
  return hatch.length < 2 ? [] : [makeStroke(hatch, { kind: 'fill', lesser: true })];
}

/** The elements of a shot: each top-level node the hand draws, with its strokes, in draw order. */
export function elementsOf(nodes, unit) {
  return nodes.filter((n) => n.props?.role !== 'hand').map((n) => ({ node: n, strokes: nodeStrokes(n, unit) }))
    .filter((e) => e.strokes.length > 0);
}

// The [start, end] each sentence's elements draw in: from its first word to its end, the last capped so it lands
// LANDED_BEFORE_END before the shot ends; one window from FALLBACK_START for a shot with no narration.
function windowsOf(timing) {
  const last = latestLanding(timing);
  const sentences = timing.sentences ?? [];
  if (sentences.length === 0) return [[Math.min(FALLBACK_START, last), last]];
  return sentences.map((s) => [Math.min(s.start, last), Math.min(s.end, last)]);
}

const isFurniture = (n) => n.props.fixed === true || n.props.furniture === true;
const isWindow = (w) => Array.isArray(w) && w.length === 2 && w.every(Number.isFinite) && w[1] >= w[0];
// an element's own window held inside the shot like a sentence's: it lands by the latest landing
// and long enough to draw in: MIN_OWN_WINDOW before the landing at the least (a word spoken last lands with the shot)
const MIN_OWN_WINDOW = 0.9; // s: the hand travels to the word first, then draws
function windowFor([from, to], timing) {
  const last = latestLanding(timing);
  const end = Math.min(to, last);
  return [Math.max(0, Math.min(from, end - MIN_OWN_WINDOW)), end];
}

// Which sentence element i of `count` draws in: its node's props.sentence when given, else the elements spread in
// order over the sentences.
const sentenceOf = (element, i, count, sentences) => {
  const given = element.node.props.sentence;
  if (Number.isInteger(given) && given >= 0) return Math.min(given, sentences - 1);
  return Math.min(sentences - 1, Math.floor((i * sentences) / count));
};

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const sum = (values) => values.reduce((a, b) => a + b, 0);
const EPS = 1e-9;

// The travel to each stroke of a run drawn after `before` (the stroke drawn last, or null): one move each, long enough not to jump.
const travelsOf = (strokes, unit, before) => strokes.map((s, i) => {
  const prior = i === 0 ? before : strokes[i - 1];
  if (!prior) return 0;
  // from the rest point (hand.restAtStart) the hand sweeps in at pose.mjs's rest speed, at least its shortest move
  return Math.max(prior.rest ? REST_TRAVEL_MIN : TRAVEL_MIN, distance(prior.points.at(-1), s.points[0]) / ((prior.rest ? REST_SPEED : TRAVEL_SPEED) * unit));
});

// What each stroke needs, in seconds: at the floor (the speed cap) and at its kind's natural speed (never above the cap).
const floorOf = (s, unit, cap) => s.total / unit / (cap * FLOOR_SLACK);
const needOf = (s, unit, cap) => Math.max(floorOf(s, unit, cap), s.total / unit / Math.min(cap * NATURAL_SHARE, NATURAL_SPEED[s.kind] ?? cap));

// The seconds each stroke takes in `avail`: at natural speeds stretched to fill it; compressed toward the floor when short;
// shared by length (past the cap: the hand-speed finding) when even the floor does not fit.
function durations(strokes, avail, unit, cap) {
  const floor = strokes.map((s) => floorOf(s, unit, cap));
  const need = strokes.map((s) => needOf(s, unit, cap));
  const [needSum, floorSum] = [sum(need), sum(floor)];
  if (needSum <= EPS) return strokes.map(() => 0);
  if (avail >= needSum) return need.map((n) => (n * avail) / needSum);
  if (avail >= floorSum) return need.map((n, i) => floor[i] + ((avail - floorSum) / (needSum - floorSum)) * (n - floor[i]));
  const length = sum(strokes.map((s) => s.total));
  return strokes.map((s) => (length > 0 ? (s.total / length) * Math.max(0, avail) : 0));
}

// The latest each run (in drawing order) may end so that every later run still fits at the speed cap by `hardEnd`: a run that
// lengthens into the hold must not starve the sentences after it.
function latestEnds(runs, unit, cap, hardEnd) {
  // each run's cost counts the sweep in from where the run before it ends (a run's first stroke is not always near it)
  const cost = runs.map((run, k) => {
    if (run.length === 0) return 0;
    const prior = runs.slice(0, k).findLast((r) => r.length > 0);
    const lead = prior ? Math.max(TRAVEL_MIN, distance(prior.at(-1).points.at(-1), run[0].points[0]) / (TRAVEL_SPEED * unit)) : TRAVEL_MIN;
    return lead + sum(travelsOf(run, unit, null)) + sum(run.map((s) => floorOf(s, unit, cap)));
  });
  const ends = Array(runs.length).fill(hardEnd);
  for (let k = runs.length - 2; k >= 0; k--) ends[k] = Math.min(hardEnd, ends[k + 1] - cost[k + 1]);
  return ends;
}

// One sentence's strokes timed after `before`, each by its own length and kind (see durations). The window ends at `to`; a run
// that cannot be drawn by then at the speed cap runs on into the shot's hold (up to `hardEnd`), a run that cannot be drawn
// even then sets its lesser strokes (hatch fills, decorative marks), longest first, and draws the rest. Each stroke carries the
// drawing speed it ends up with (units a second); `skipped` holds the strokes the hand leaves to appear set.
function timeWindow(strokes, [opens, to], unit, before, { cap, hardEnd, noSet = false }) {
  const from = Math.max(opens, before?.end ?? opens);
  const limit = Math.max(to, hardEnd);
  const floorEnd = (run) => from + sum(travelsOf(run, unit, before)) + sum(run.map((s) => floorOf(s, unit, cap)));
  // look.hand.noSet (marker, gate-marker-2: nothing is on the board without the pen): no stroke is ever set at once for want of
  // time; a run that does not fit is the hand-speed finding
  const lesser = noSet ? [] : strokes.filter((s) => s.lesser && !s.put).sort((a, b) => b.total - a.total);
  // a ground is put on when its sentence opens, whatever the time: the hand writes onto it
  const skipped = strokes.filter((s) => s.put);
  let kept = strokes.filter((s) => !s.put);
  while (floorEnd(kept) > limit + EPS && lesser.length > 0) {
    const drop = lesser.shift();
    skipped.push(drop);
    kept = kept.filter((s) => s !== drop);
  }
  const travels = travelsOf(kept, unit, before);
  const natural = from + sum(travels) + sum(kept.map((s) => needOf(s, unit, cap)));
  const end = floorEnd(kept) <= to + EPS ? to : Math.min(limit, natural);
  const spans = durations(kept, end - from - sum(travels), unit, cap);
  let t = from;
  const timed = kept.map((s, i) => {
    const start = t + travels[i];
    t = start + spans[i];
    const speed = spans[i] > 0 ? s.total / unit / spans[i] : (s.total > 0 ? Infinity : 0);
    return { ...s, start, end: t, speed };
  });
  return { timed, skipped, opens };
}

/**
 * The shot's stroke plan and the elements it leaves to appear set: { plan, set } where plan is
 * [{ id, node, points, lengths, total, start, end, kind: 'line' | 'write' | 'fill', speed }] in draw order, times in shot
 * seconds, and set is [{ node, at }] (decorative strokes with no time to draw, put on at once when their sentence opens).
 * `opts.unit` is px per unit (default 1). The first element is complete at 0.
 */
export function strokePlanned(nodes, timing, look, { unit = 1, rest = null, lead: cutEnd = 0 } = {}) {
  const all = elementsOf(nodes, unit);
  if (all.length === 0) return { plan: [], set: [] };
  // look.hand.drawFirst (marker, gate-marker-1 ruling 1): the hand draws every element, furniture included, none is whole on
  // frame 0: the first stroke is already under way when the shot opens (HEAD_START before it) and the hand is on it
  const drawFirst = look?.hand?.drawFirst === true;
  // frame furniture (a slug, a kicker, a caption: pinned to the frame) is on the board from frame 0, never drawn by the hand
  const furniture = drawFirst ? [] : all.filter((e) => isFurniture(e.node));
  const elements = drawFirst ? all : all.filter((e) => !isFurniture(e.node));
  const standing = furniture.flatMap((e) => e.strokes.map((s, k) => ({ ...s, id: `${e.node.id}#${k}`, node: e.node.id, sentence: 0, start: 0, end: 0, speed: 0 })));
  if (elements.length === 0) return { plan: Object.freeze(standing.map((s) => Object.freeze(s))), set: [] };
  // `lead` (m5, gate-marker-2 rulings 1 and 2): the seconds the cut that opens the shot holds the board clear. Nothing is written
  // before it: every window opens at `lead` at the earliest, and a shot after a cut has no HEAD_START (its pen goes down as the
  // cut ends, the hand arriving on the cut's own frames)
  const held = ([from, to]) => [Math.max(from, cutEnd), Math.max(to, cutEnd)];
  const spoken = windowsOf(timing).map(held);
  const sentences = drawFirst ? [[cutEnd > 0 ? cutEnd : -HEAD_START, spoken[0][1]], ...spoken.slice(1)] : spoken;
  // an element that names its own window (props.window, [from, to] shot seconds: an underline drawn as its word is
  // spoken) gets one after the sentences'; windows are timed in order of their start
  const windows = [...sentences, ...elements.flatMap((e) => (isWindow(e.node.props.window) ? [held(windowFor(e.node.props.window, timing))] : []))];
  let own = sentences.length;
  const tagged = elements.map((e, i) => {
    const mine = isWindow(e.node.props.window) ? own++ : sentenceOf(e, i, elements.length, sentences.length);
    return e.strokes.map((s, k) => ({ ...s, id: `${e.node.id}#${k}`, node: e.node.id, sentence: mine }));
  });
  // the first element on the board is the first that does not name a time of its own: a ring drawn on its word is not on
  // the board when the shot opens
  const lead = drawFirst ? -1 : elements.findIndex((e) => !isWindow(e.node.props.window));
  const first = [...standing, ...(lead < 0 ? [] : tagged[lead].map((s) => ({ ...s, start: 0, end: 0, speed: 0 })))];
  const later = tagged.filter((_, i) => i !== lead).flat();
  // with look.hand.restAtStart the hand comes in from its rest point to the first stroke after the first element
  const origin = rest ? { points: [rest], end: 0, rest: true } : null;
  const order = windows.map((win, w) => w).sort((x, y) => windows[x][0] - windows[y][0] || x - y);
  const cap = look?.hand?.maxSpeed ?? DEFAULT_CAP;
  // look.hand.clearBy (marker, gate-marker-2 ruling 5): the last stroke ends this long before the shot does, so the hand has left
  // the finished writing for its rest point on the shot's last frame (the cut starts from that frame)
  const hardEnd = Math.max(latestLanding(timing), timing.duration - (look?.hand?.clearBy ?? DRAW_TAIL));
  const set = [];
  const runs = order.map((w) => later.filter((s) => s.sentence === w));
  const latest = latestEnds(runs, unit, cap, hardEnd);
  // a run is stretched to its window's end but never past where the next run opens (a mark with a window of its own opens
  // inside a sentence: the hand must be free for it then)
  const opensAfter = (k) => {
    const next = runs.findIndex((r, i) => i > k && r.length > 0);
    return next < 0 ? Infinity : windows[order[next]][0];
  };
  const timed = order.reduce((done, w, k) => {
    const mine = runs[k];
    if (mine.length === 0) return done;
    const run = timeWindow(mine, windows[w].map((v, i) => (i === 1 ? Math.min(v, Math.max(windows[w][0], opensAfter(k))) : v)), unit, origin && done.length === first.length ? origin : done.at(-1), { cap, hardEnd: latest[k], noSet: look?.hand?.noSet === true });
    set.push(...run.skipped.map((s) => ({ node: s.node, at: run.opens })));
    return [...done, ...run.timed];
  }, first);
  return { plan: Object.freeze(timed.map((s) => Object.freeze(s))), set };
}

/** The shot's stroke plan alone (see strokePlanned). */
export const strokePlan = (nodes, timing, look, opts) => strokePlanned(nodes, timing, look, opts).plan;

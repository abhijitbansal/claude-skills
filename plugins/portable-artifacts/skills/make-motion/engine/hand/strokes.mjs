// The drawing hand's stroke plan (looks-four Task 2): what a hand shot draws, in draw order, and when. Each top-level
// node the hand can draw is an element: a text is written a line at a time (one `write` stroke per line, left to right
// through the middle of its letters), a stroked polyline path is drawn along its own points (`line`), a filled one is
// hatched over its box (`fill`). An element starts on the first word of its sentence and its strokes share the time to
// that sentence's end (the last landed LANDED_BEFORE_END before the shot ends); the hand travels between strokes in one
// eased move. The first element is complete on the shot's first frame: the time-lapse joins after it is drawn.
// Pure and DOM-free.
import { makeStroke, boxHatch } from './geometry.mjs';
import { latestLanding } from '../kinds/arrivals.mjs';

const WRITE_MID = 0.37; // em above the baseline: the middle of a line's lower-case letters, where the tip writes
const TRAVEL_MIN = 0.05; // s: the shortest move between two strokes (a board of many short strokes, a chart's labels, must fit its sentence)
const TRAVEL_SPEED = 2400; // units a second the hand travels between strokes at most (so no frame jumps far)
const FALLBACK_START = 0.2; // s: an unnarrated shot draws from here
const HATCH_GAP = 26; // units between the lines of a fill's hatch (the hand draws it fast: a wider gap is a shorter stroke)
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

// The strokes of one node without times: [] for a node the hand does not draw.
function nodeStrokes(n, unit) {
  const { x = 0, y = 0 } = n.props;
  if (n.type === 'text' && n.props.layout && n.props.font) {
    const size = n.props.font.size;
    return n.props.layout.lines.map((line, k) => {
      const mid = y + line.y - WRITE_MID * size;
      return makeStroke([[x + line.x, mid], [x + line.x + line.width, mid]], { kind: 'write', line: k });
    });
  }
  if (n.type !== 'path') return [];
  const points = polylinePoints(n.props.d);
  if (points === null) return [];
  if (n.props.stroke) return [makeStroke(offset(points, x, y), { kind: 'line' })];
  if (!n.props.fill) return [];
  const [bx, by, bw, bh] = boxOf(offset(points, x, y));
  const hatch = boxHatch(bx + bw / 2, by + bh / 2, bw, bh, HATCH_GAP * unit, unit);
  return hatch.length < 2 ? [] : [makeStroke(hatch, { kind: 'fill' })];
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

// One sentence's strokes timed in [from, to], after `before` (the stroke drawn last, or null): the travel to each first
// (one eased move each, long enough not to jump), the rest shared by length. Each stroke carries the drawing speed the
// window asks of it (units a second).
function timeWindow(strokes, [opens, to], unit, before) {
  const from = Math.max(opens, before?.end ?? opens);
  const travels = strokes.map((s, i) => {
    const prior = i === 0 ? before : strokes[i - 1];
    return prior ? Math.max(TRAVEL_MIN, distance(prior.points.at(-1), s.points[0]) / (TRAVEL_SPEED * unit)) : 0;
  });
  const length = strokes.reduce((sum, s) => sum + s.total, 0);
  const drawing = Math.max(0, to - from - travels.reduce((a, b) => a + b, 0));
  const speed = drawing > 0 ? length / unit / drawing : Infinity;
  let t = from;
  return strokes.map((s, i) => {
    const start = t + travels[i];
    const end = start + (length > 0 ? (s.total / length) * drawing : 0);
    t = end;
    return { ...s, start, end, speed };
  });
}

/**
 * The shot's stroke plan: [{ id, node, points, lengths, total, start, end, kind: 'line' | 'write' | 'fill', speed }] in
 * draw order, times in shot seconds. `opts.unit` is px per unit (default 1). The first element is complete at 0.
 */
export function strokePlan(nodes, timing, look, { unit = 1 } = {}) {
  const all = elementsOf(nodes, unit);
  if (all.length === 0) return [];
  // frame furniture (a slug, a kicker, a caption: pinned to the frame) is on the board from frame 0, never drawn by the hand
  const furniture = all.filter((e) => isFurniture(e.node));
  const elements = all.filter((e) => !isFurniture(e.node));
  const standing = furniture.flatMap((e) => e.strokes.map((s, k) => ({ ...s, id: `${e.node.id}#${k}`, node: e.node.id, sentence: 0, start: 0, end: 0, speed: 0 })));
  if (elements.length === 0) return Object.freeze(standing.map((s) => Object.freeze(s)));
  const sentences = windowsOf(timing);
  // an element that names its own window (props.window, [from, to] shot seconds: an underline drawn as its word is
  // spoken) gets one after the sentences'; windows are timed in order of their start
  const windows = [...sentences, ...elements.flatMap((e) => (isWindow(e.node.props.window) ? [windowFor(e.node.props.window, timing)] : []))];
  let own = sentences.length;
  const tagged = elements.map((e, i) => {
    const mine = isWindow(e.node.props.window) ? own++ : sentenceOf(e, i, elements.length, sentences.length);
    return e.strokes.map((s, k) => ({ ...s, id: `${e.node.id}#${k}`, node: e.node.id, sentence: mine }));
  });
  const first = [...standing, ...tagged[0].map((s) => ({ ...s, start: 0, end: 0, speed: 0 }))];
  const rest = tagged.slice(1).flat();
  const order = windows.map((win, w) => w).sort((x, y) => windows[x][0] - windows[y][0] || x - y);
  const timed = order.reduce((done, w) => {
    const mine = rest.filter((s) => s.sentence === w);
    return mine.length === 0 ? done : [...done, ...timeWindow(mine, windows[w], unit, done.at(-1))];
  }, first);
  return Object.freeze(timed.map((s) => Object.freeze(s)));
}

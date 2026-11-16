// The duck: how far the music bed is lowered while the voice speaks, as breakpoints of a gain curve in film time
// (voice/master.mjs turns them into volume filters in series, up to 32 terms each). Pure: numbers in, numbers out.
//
// Each word span (joined with the next when they are closer than the release) is a trapezoid in decibels: 0 until
// `attack` before the span, a straight ramp down to `depthDb` at its start, held to its end, a straight ramp back up
// over `release`. Where a release and the next attack overlap, the deeper of the two holds; they meet where they cross.

export const DUCK_DEPTH_DB = -9;
export const DUCK_ATTACK = 0.06; // seconds
export const DUCK_RELEASE = 0.3; // seconds
const ROUNDING = 1e6;
const GAIN_ROUNDING = 1e4;

const isFiniteNumber = (n) => typeof n === 'number' && Number.isFinite(n);

function checkArgs(wordSpans, { depthDb, attack, release, seconds }) {
  if (!Array.isArray(wordSpans)) throw new TypeError('duckEnvelope: wordSpans must be an array of { start, end }');
  wordSpans.forEach((s, i) => {
    if (!isFiniteNumber(s?.start) || !isFiniteNumber(s?.end) || s.start > s.end) {
      throw new RangeError(`duckEnvelope: wordSpans[${i}] must be { start, end } with start <= end, got ${JSON.stringify(s)}`);
    }
  });
  if (!isFiniteNumber(seconds) || seconds <= 0) throw new RangeError(`duckEnvelope: seconds must be a positive number, got ${String(seconds)}`);
  if (!isFiniteNumber(depthDb) || depthDb > 0) throw new RangeError(`duckEnvelope: depthDb must be a number at or below 0, got ${String(depthDb)}`);
  for (const [name, value] of [['attack', attack], ['release', release]]) {
    if (!isFiniteNumber(value) || value <= 0) throw new RangeError(`duckEnvelope: ${name} must be a positive number of seconds, got ${String(value)}`);
  }
}

// The spans inside the film, sorted, joined when the gap to the next is under `release`: [{ a, b }].
function dips(wordSpans, release, seconds) {
  const inside = wordSpans.filter((s) => s.end >= 0 && s.start <= seconds)
    .map((s) => ({ a: Math.max(0, s.start), b: Math.min(seconds, s.end) }))
    .sort((x, y) => x.a - y.a);
  const joined = [];
  for (const d of inside) {
    const last = joined.at(-1);
    if (last && d.a - last.b < release) joined[joined.length - 1] = { a: last.a, b: Math.max(last.b, d.b) };
    else joined.push(d);
  }
  return joined;
}

// One dip's gain at `t`: 0 outside it, the ramps and the hold inside.
const trapezoid = ({ a, b }, t, { depthDb, attack, release }) => {
  if (t <= a - attack || t >= b + release) return 0;
  if (t < a) return (depthDb * (t - (a - attack))) / attack;
  if (t <= b) return depthDb;
  return depthDb * (1 - (t - b) / release);
};

// Where dip `p`'s release line meets dip `n`'s attack line, when they overlap (else null).
function crossing(p, n, { attack, release }) {
  if (n.a - attack >= p.b + release) return null;
  const t = (n.a + (attack * p.b) / release) / (1 + attack / release);
  return t > p.b && t < n.a ? t : null;
}

/**
 * The words of `timeline` as they are heard, in film seconds: [{ start, end }] from each word's sound times
 * (engine/script/timing.mjs soundStart, soundEnd: the voice's own, where the picture shows a shot's first word from the
 * shot's first frame) plus its shot's start. What the bed ducks under.
 */
export function heardWordSpans(timeline) {
  return timeline.shots.flatMap((s) => s.words.map((w) => ({ start: s.start + (w.soundStart ?? w.start), end: s.start + (w.soundEnd ?? w.end) })));
}

/**
 * Breakpoints [{ t, gainDb }] of the duck under `wordSpans` (film seconds, [{ start, end }]) in a film of `seconds`:
 * piecewise linear between them, from t = 0 to t = seconds, `depthDb` while any word sounds, spans closer than `release`
 * joined into one dip. No words: [] (no duck).
 */
export function duckEnvelope(wordSpans, { depthDb = DUCK_DEPTH_DB, attack = DUCK_ATTACK, release = DUCK_RELEASE, seconds } = {}) {
  const shape = { depthDb, attack, release };
  checkArgs(wordSpans, { ...shape, seconds });
  const list = dips(wordSpans, release, seconds);
  if (list.length === 0) return Object.freeze([]);
  const corners = list.flatMap((d) => [d.a - attack, d.a, d.b, d.b + release]);
  const crossings = list.slice(1).map((d, k) => crossing(list[k], d, shape)).filter((t) => t !== null);
  const times = [...new Set([0, seconds, ...corners, ...crossings].filter((t) => t >= 0 && t <= seconds).map((t) => Math.round(t * ROUNDING) / ROUNDING))]
    .sort((x, y) => x - y);
  const gainAt = (t) => Math.min(0, ...list.map((d) => trapezoid(d, t, shape)));
  return Object.freeze(times.map((t) => Object.freeze({ t, gainDb: Math.round(gainAt(t) * GAIN_ROUNDING) / GAIN_ROUNDING + 0 })));
}

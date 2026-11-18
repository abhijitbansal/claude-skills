// What the `timeline` kind's two looks share (timeline.mjs registers it): when each event arrives, the room each event's
// text has (a column on a wide editorial frame, a row on a tall one, the whole block in a one-at-a-time look), and the
// one pair of sizes for `when` and `what`: the largest `when` that holds three times `what` (the frame review's hero
// rule), `what` at or above the format's floor, every event fitting its room. Pure and DOM-free: text is measured by
// the `measure` given (the page's, or an estimate in the review).
import { layoutText } from '../text/layout.mjs';
import { sizeAt, setCase, isWide, isEditorial } from './shared.mjs';
import { landBy, latestLanding } from './arrivals.mjs';

const HALF = 2;
const HERO_RATIO = 3;
const EPS = 1e-6;

/** When each event arrives, in shot seconds: on sentence k when there are as many sentences as events; else spread over
 *  the spoken words; with no narration (or fewer words than events) evenly to the latest landing; the first at 0. */
export function eventTimes(shot, timing) {
  const n = shot.events.length;
  const { words, sentences } = timing;
  if (sentences.length === n) return sentences.map((s, k) => (k === 0 ? 0 : landBy(s.start, timing)));
  if (words.length < n) return Array.from({ length: n }, (_, k) => (k * latestLanding(timing)) / (n - 1));
  return Array.from({ length: n }, (_, k) => (k === 0 ? 0 : landBy(words[Math.min(words.length - 1, Math.round((k * words.length) / n))].start, timing)));
}

export const floorStep = (canvas) => (isWide(canvas) ? 1 : HALF);

/** The room one event's text has: { width, height } in px, for `n` events in `area` ({ x, y, w, h }). A wide editorial
 *  frame gives each a column; a tall one a row beside the line; a one-at-a-time look the whole block beside its rail. */
export function eventRoom(look, data, canvas, area, n, unit) {
  const gap = data.gap * unit;
  if (!isEditorial(look)) return { width: area.w - (isWide(canvas) ? 0 : data.rail * unit), height: area.h - (isWide(canvas) ? data.rail * unit : 0) };
  // with the title as the hero (data.underTitle) the date and event share the room's height as placed (both parts and
  // the two gaps round the line, centred: timeline-desk.mjs), not half each
  if (isWide(canvas)) return { width: (area.w - (n - 1) * gap) / n - data.inset * unit, height: data.underTitle ? area.h - HALF * data.lineGap * unit : area.h / HALF - data.lineGap * unit };
  return { width: area.w - data.lineX * unit - data.textGap * unit, height: area.h / n - gap };
}

const fontOf = (look, role, size, unit) => ({ ...look.fonts[role], size, tracking: look.tracking(size / unit, role) });

// Every event's `when` (display face) and `what` (the look's `whatFace`, else the text face) set at the two sizes,
// wrapped to `width`.
function setAt(events, env, whenSize, whatSize) {
  const { look, unit, measure, room, data } = env;
  const face = data.whatFace ?? 'text';
  const set = (role, size, text) => layoutText({ text: setCase(look, role, text), font: fontOf(look, role, size, unit), maxWidth: Math.max(1, room.width), measure });
  return { when: events.map((e) => set('display', whenSize, e.when)), what: events.map((e) => set(face, whatSize, e.what)), whenFont: fontOf(look, 'display', whenSize, unit), whatFont: fontOf(look, face, whatSize, unit) };
}

// Does every event hold in its room: lines within the look's limits, no wider than the room, both parts in its height?
function holds(sets, env) {
  const { data, room, unit } = env;
  return sets.when.every((w, k) => {
    const t = sets.what[k];
    const tall = w.height + data.partGap * unit + t.height;
    return w.lines.length <= data.whenLines && t.lines.length <= data.whatLines && w.width <= room.width + EPS && t.width <= room.width + EPS && tall <= room.height + EPS;
  });
}

// The title as the hero (data.underTitle, ledger: gate-ledger-2 ruling 3): `when` and `what` one size class, a third of
// the title's size at most and the format's floor at least, tried by whole units from the largest down.
function titlePairs(titleSize, floor, unit) {
  const most = Math.floor(titleSize / HERO_RATIO / unit), least = Math.ceil(floor / unit - EPS);
  return Array.from({ length: Math.max(1, most - least + 1) }, (_, i) => Math.max(least, most - i) * unit).map((s) => [s, s]);
}

/**
 * The pair of sizes and the events set at them: the largest `when` of data.whenSteps with a `what` of data.whatSteps at
 * or above the floor and at most a third of it, where every event holds; else the smallest such pair, fits false.
 * env: { look, data, unit, measure, room, floorStep }.
 */
export function fitEvents(events, env) {
  const { look, data, unit } = env;
  const floor = sizeAt(look, env.floorStep, unit);
  // data.whenSizes (cosmos): explicit date sizes in units, for a scale with no step between three times the events' words
  // and its largest (136 against 46: the dates would be 232 and fill the column); else the steps of data.whenSteps
  const whens = data.whenSizes === undefined ? [...data.whenSteps].sort((a, b) => b - a).map((ws) => sizeAt(look, ws, unit)) : [...data.whenSizes].sort((a, b) => b - a).map((s) => s * unit);
  const pairs = data.underTitle && env.titleSize ? titlePairs(env.titleSize, floor, unit) : whens.flatMap((w) => [...data.whatSteps].sort((a, b) => b - a)
    .map((ts) => [w, sizeAt(look, ts, unit)])
    .filter(([wide, t]) => t >= floor - EPS && wide >= HERO_RATIO * t - EPS));
  const tries = pairs.map(([w, t]) => ({ ...setAt(events, env, w, t), whenSize: w, whatSize: t }));
  const fit = tries.find((s) => holds(s, env));
  return fit ? { ...fit, fits: true } : { ...(tries.at(-1) ?? setAt(events, env, HERO_RATIO * floor, floor)), fits: false };
}

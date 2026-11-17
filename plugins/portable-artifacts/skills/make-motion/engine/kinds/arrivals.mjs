// When the second-wave kinds show what they reveal: words with the narration (kinds/words.mjs wordTimes), the first on
// frame 0, every one landed LANDED_BEFORE_END seconds before the shot ends so the finished frame holds; each reveal is a
// step (never part-way, so frame 0 is whole and no reveal is half drawn on a sampled frame). Pure and DOM-free.
import { track } from '../time/track.mjs';
import { wordTimes, wordForm } from './words.mjs';
import { compositionRect, captionTop, isEditorial, isWide } from './shared.mjs';
import { gridX } from '../looks/index.mjs';

export const LANDED_BEFORE_END = 0.6; // s: the last reveal lands at least this long before the shot ends

/** The latest a reveal may land in a shot of `timing`: LANDED_BEFORE_END before its end (0 for a shot shorter than that). */
export const latestLanding = (timing) => Math.max(0, timing.duration - LANDED_BEFORE_END);

/** `at` held inside [0, latestLanding]. */
export const landBy = (at, timing) => Math.min(Math.max(0, at), latestLanding(timing));

/** When each word of `layout` (in word-index order) is shown: on its spoken word, the first on frame 0, in order, each
 *  landed by latestLanding. */
export function revealTimes(layout, timing) {
  const words = layout.lines.flatMap((line) => line.words).sort((a, b) => a.index - b.index);
  let last = 0;
  return wordTimes(words.map((w) => w.text), timing).map(({ at }, i) => {
    last = i === 0 ? 0 : Math.max(last, landBy(at, timing));
    return last;
  });
}

/** The room a shot composes in, { x, y, w, h } in px: the platform safe band (a look composing in it on 9:16, its
 *  captions' room taken off), else the canvas inside the look's margins, over a captions band. */
export function roomOf(ctx) {
  const { look, canvas, unit } = ctx;
  const rect = compositionRect(ctx);
  if (rect.safe) return { x: rect.left, y: rect.top, w: rect.w, h: rect.h };
  const margin = look.grid.margin * unit;
  const bottom = Math.min(canvas.h - margin, captionTop(ctx) - look.grid.gutter * unit);
  const left = editorialLeft(look, canvas, unit);
  return { x: left, y: margin, w: canvas.w - 2 * left, h: bottom - margin };
}

export const EDITORIAL_WIDE_COLUMN = 2; // where an editorial composition's text starts on a wide frame (statement, chart, end)

/** The left edge every kind's text keeps in an editorial look on a wide frame: column EDITORIAL_WIDE_COLUMN, where
 *  the statement, the chart and the end card start (gate-kinds-b-1: one left margin per format); the grid margin
 *  otherwise. */
export function editorialLeft(look, canvas, unit) {
  return isEditorial(look) && isWide(canvas) ? gridX(look, canvas, EDITORIAL_WIDE_COLUMN) : look.grid.margin * unit;
}

/** When each name of `names` lands: on the first spoken word that is its first word; else (none matched) one per sentence
 *  when there are as many sentences, else evenly from 0 to latestLanding; every time landed by latestLanding. */
export function namedTimes(names, timing) {
  const n = names.length;
  const spoken = timing.words.map((w) => ({ form: wordForm(w.text), start: w.start }));
  return names.map((name, k) => {
    const first = wordForm(String(name).split(/\s+/)[0]);
    const said = spoken.find((w) => w.form === first);
    if (said) return landBy(said.start, timing);
    if (timing.sentences?.length === n) return k === 0 ? 0 : landBy(timing.sentences[k].start, timing);
    return n <= 1 ? 0 : (k * latestLanding(timing)) / (n - 1);
  });
}

/** An opacity that steps from 0 to 1 at `at` (shown from the start when `at` is 0). */
export const arrivalTrack = (at) => track(at <= 0 ? [{ t: 0, v: 1 }] : [{ t: 0, v: 0 }, { t: at, v: 0 }, { t: at, v: 1 }]);

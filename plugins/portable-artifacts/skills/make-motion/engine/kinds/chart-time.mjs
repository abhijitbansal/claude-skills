// When a chart's parts happen (chart.mjs and its compositions): its marks grow, or draw, over the first sentence; the
// highlighted mark takes the accent, and the others dim, on the word that names it, else at the second sentence; its
// value lands then (the kind's `landing`, the cue plan's land event). Every time is in shot seconds and inside the
// shot, narrated or held. Pure and DOM-free.

const MIN_GROW = 0.6; // seconds: marks never grow faster than this
const GROW_SHARE = 0.45; // of the shot, when there is no first sentence to grow over
const LATEST_GROW = 0.75; // of the shot: marks have grown by then
const HIGHLIGHT_SHARE = 0.6; // of the shot, when nothing names the highlight and there is no second sentence
const LATEST_HIGHLIGHT = 0.9; // of the shot
const NOT_WORD = /[^\p{L}\p{N}]/gu;

const plain = (text) => String(text).toLowerCase().replace(NOT_WORD, '');

// The start of the first spoken word that is the highlight's first word, or null.
function namingWord(highlight, words) {
  const first = plain(String(highlight).split(/\s+/)[0]);
  if (first === '') return null;
  const word = words.find((w) => plain(w.text) === first);
  return word === undefined ? null : word.start;
}

/** { growEnd, highlightAt } in shot seconds; highlightAt is null without a highlight. */
export function chartTimes(shot, timing) {
  const { words, sentences, duration } = timing;
  const spoken = sentences.length > 0 ? sentences[0].end : duration * GROW_SHARE;
  const growEnd = Math.min(Math.max(spoken, Math.min(MIN_GROW, duration)), duration * LATEST_GROW);
  if (shot.highlight === undefined) return { growEnd, highlightAt: null };
  const named = namingWord(shot.highlight, words) ?? (sentences.length > 1 ? sentences[1].start : duration * HIGHLIGHT_SHARE);
  return { growEnd, highlightAt: Math.min(Math.max(named, growEnd), duration * LATEST_HIGHLIGHT) };
}

/** The chart's land event: its highlighted value landing, else the marks done growing. */
export const chartLanding = (shot, timing) => {
  const { growEnd, highlightAt } = chartTimes(shot, timing);
  return highlightAt ?? growEnd;
};

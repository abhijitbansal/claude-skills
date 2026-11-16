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

// The start of the first spoken run of words that is the whole highlight ("North America", not an earlier "north"), or
// null.
function namingWord(highlight, words) {
  const parts = String(highlight).split(/\s+/).map(plain).filter((p) => p !== '');
  if (parts.length === 0) return null;
  const at = words.findIndex((_, i) => parts.every((p, j) => words[i + j] !== undefined && plain(words[i + j].text) === p));
  return at < 0 ? null : words[at].start;
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

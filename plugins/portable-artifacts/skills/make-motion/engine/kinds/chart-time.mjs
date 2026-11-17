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

// The latest a chart's marks may finish growing and its highlight may start in a look that holds its finished chart
// (look.kinds.chart.settle, ledger: gate-ledger-1 ruling 4, the values on screen at least that long before the cut):
// `settle` seconds plus the enter move its values and colours arrive over (chart-labels.mjs arriveAt) before the end,
// never under MIN_GROW. Infinity in a look without `settle` (every time as before).
function settledBy(look, duration) {
  const settle = look?.kinds?.chart?.settle;
  if (settle === undefined) return Infinity;
  return Math.max(Math.min(MIN_GROW, duration), duration - settle - look.moves.enter.dur);
}

/** { growEnd, highlightAt } in shot seconds; highlightAt is null without a highlight. `look` (optional): a look that
 *  holds its finished chart (settledBy) lands both earlier. */
export function chartTimes(shot, timing, look) {
  const { words, sentences, duration } = timing;
  const latest = settledBy(look, duration);
  const spoken = sentences.length > 0 ? sentences[0].end : duration * GROW_SHARE;
  const growEnd = Math.min(Math.max(spoken, Math.min(MIN_GROW, duration)), duration * LATEST_GROW, latest);
  if (shot.highlight === undefined) return { growEnd, highlightAt: null };
  const named = namingWord(shot.highlight, words) ?? (sentences.length > 1 ? sentences[1].start : duration * HIGHLIGHT_SHARE);
  return { growEnd, highlightAt: Math.min(Math.max(named, growEnd), duration * LATEST_HIGHLIGHT, Math.max(growEnd, latest)) };
}

/** The chart's land event: its highlighted value landing, else the marks done growing (in `look`, chartTimes). */
export const chartLanding = (shot, timing, look) => {
  const { growEnd, highlightAt } = chartTimes(shot, timing, look);
  return highlightAt ?? growEnd;
};

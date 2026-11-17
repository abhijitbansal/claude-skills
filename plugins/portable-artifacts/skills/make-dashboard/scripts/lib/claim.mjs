// What a chart's title (its claim, "East earns the most revenue") names in the chart's own rows. Pure: no Vega.
// views.mjs accents a claimed bar and annotates a claimed month. Matching is literal, by case and whole word, and
// only ever against values the rows hold, so a title that names nothing leaves the chart as it was.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A whole word: no letter or digit right before or after (so East is not found in Northeast).
const wholeWord = (text, word) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(word)}(?![\\p{L}\\p{N}])`, 'u').test(text);

/** The distinct string `values` (in their order) that `title` names as whole words, matched by case. */
export function namedCategories(title, values) {
  const seen = new Set();
  for (const v of values) {
    if (typeof v !== 'string' || v === '' || seen.has(v)) continue;
    if (wholeWord(String(title), v)) seen.add(v);
  }
  return [...seen];
}

/**
 * The one time in `times` (ms since epoch, UTC) whose month `title` names, by its capitalised full or three-letter
 * name ("August", "Aug"; never "may" the verb), or null: no month named, the month is not in the rows, or it is
 * there more than once (two years, or daily rows), so the claim does not pick one point.
 */
export function namedMonth(title, times) {
  const index = MONTHS.findIndex((m) => wholeWord(String(title), m) || wholeWord(String(title), m.slice(0, 3)));
  if (index < 0) return null;
  const hits = [...new Set(times)].filter((t) => Number.isFinite(t) && new Date(t).getUTCMonth() === index);
  return hits.length === 1 ? hits[0] : null;
}

// The `timeline` kind's dates: whether every event's `when` reads as a date (a month name, a year, a month and year, or
// yyyy-mm) and where events sit along the line by date, each at least its gap from the one before so its words fit.
// Events that are not all dates, mix a bare month with a year, or are out of order are a sequence: evenly spaced.
// Pure and DOM-free.

const MONTH_NAMES = Object.freeze(['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']);
const MONTHS_PER_YEAR = 12;
const MIN_MONTH_LETTERS = 3;
const ISO_RE = /^(\d{4})(?:-(\d{1,2}))?$/;
const MONTH_RE = /^([A-Za-z]+)\.?(?:,?\s+(\d{4}))?$/;
const EPSILON = 1e-9;

// One `when` as { value (months), hasYear }, or null when it is not a date.
function dateOf(when) {
  const text = String(when).trim();
  const iso = ISO_RE.exec(text);
  if (iso) {
    const month = iso[2] === undefined ? 1 : Number(iso[2]);
    return month >= 1 && month <= MONTHS_PER_YEAR ? { value: Number(iso[1]) * MONTHS_PER_YEAR + month - 1, hasYear: true } : null;
  }
  const named = MONTH_RE.exec(text);
  if (!named || named[1].length < MIN_MONTH_LETTERS) return null;
  const index = MONTH_NAMES.findIndex((m) => m.startsWith(named[1].toLowerCase()));
  if (index < 0) return null;
  return { value: (named[2] === undefined ? 0 : Number(named[2]) * MONTHS_PER_YEAR) + index, hasYear: named[2] !== undefined };
}

/** Each event's date in months, in order, or null when the events are a sequence rather than dates. */
export function dateValues(events) {
  const dates = events.map((e) => dateOf(e.when));
  if (dates.some((d) => d === null) || new Set(dates.map((d) => d.hasYear)).size > 1) return null;
  const values = dates.map((d) => d.value);
  if (values.some((v, k) => k > 0 && v < values[k - 1]) || values.at(-1) === values[0]) return null;
  return values;
}

/**
 * Positions from `lo` (the first event) to `hi` (the last): by `values` when given, each next at least gaps[k] after
 * the one before (a gap that pushes past `hi` is taken back from the right); evenly when `values` is null or the gaps
 * cannot fit between lo and hi.
 */
export function spreadPositions(values, lo, hi, gaps) {
  const n = gaps.length + 1;
  const even = Array.from({ length: n }, (_, k) => (n === 1 ? lo : lo + ((hi - lo) * k) / (n - 1)));
  if (values === null || n < 2) return even;
  const span = values.at(-1) - values[0];
  const p = values.map((v) => lo + ((hi - lo) * (v - values[0])) / span);
  for (let k = 1; k < n; k++) p[k] = Math.max(p[k], p[k - 1] + gaps[k - 1]);
  if (p[n - 1] > hi) {
    p[n - 1] = hi;
    for (let k = n - 2; k >= 0; k--) p[k] = Math.min(p[k], p[k + 1] - gaps[k]);
  }
  return p[0] < lo - EPSILON ? even : p;
}

// race: a bar chart race. Rows of { period, name, value } become, for every name that is ever in the top N, a bar, a name
// and a counter that move to a new rank and length at each period, and one big period label that changes with them.
import { unit, contentWidth, textWidth, fitText, fitHeight, sizeLadder, fitSchedule, textPart, linePart, enter, blockGroup, stack, freeBand, roomAt, ENTER_SECONDS, LINE_HEIGHT, MIN_TEXT, abovePlace } from './layout.mjs';

const LIMIT = 999999999999;
const short = { type: 'string', minLength: 1, maxLength: 6 };
const row = {
  type: 'object',
  additionalProperties: false,
  required: ['period', 'name', 'value'],
  properties: {
    period: { type: 'string', minLength: 1, maxLength: 80 },
    name: { type: 'string', minLength: 1, maxLength: 24 },
    value: { type: 'number', minimum: 0, maximum: LIMIT },
  },
};
const params = {
  type: 'object',
  additionalProperties: false,
  required: ['rows'],
  properties: {
    rows: { type: 'array', minItems: 4, maxItems: 200, items: row },
    top: { type: 'integer', minimum: 3, maximum: 10, default: 5 },
    periodSeconds: { type: 'number', minimum: 0.5, maximum: 4, default: 1 },
    title: { type: 'string', minLength: 1, maxLength: 80 },
    prefix: short,
    suffix: short,
    decimals: { type: 'integer', minimum: 0, maximum: 4, default: 0 },
  },
};

const BAR_SHARE = 0.7; // of a row: the bar's thickness
const ROW_MAX = 120; // px at 1080: the tallest a row is
const GAP = 24; // px at 1080 between the title, the rows and the period label, and across between name, bar and counter
const TITLE_SIZES = [64, 56, 48, MIN_TEXT]; // px at 1080, largest first
const NAME_SIZE = 56; // px at 1080: the largest name and counter
const PERIOD_SIZE = 96; // px at 1080
const NAME_SHARE = { min: 0.2, max: 0.46 }; // of the width: the name column
const VALUE_SHARE_MAX = 0.28; // of the width: the counter column
const VALUE_SLACK = 1.25; // a bold number with a wide suffix such as M is wider than the shared glyph estimate
const DRAW_DIGITS = 4; // decimals kept of a bar's draw (its share of the largest value)
const EPSILON = 1e-9;
const COLOURS = ['cat1', 'cat2', 'cat3', 'cat4', 'cat5', 'cat6'];

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
const num = (n) => Number(n.toFixed(2));
const longest = (strings) => strings.reduce((a, b) => (Array.from(b).length > Array.from(a).length ? b : a), '');

/**
 * The periods of `rows`, in the order each first appears, each with its top `top` names: value descending, ties by name,
 * `rank` from 0. A name repeated inside one period keeps its last row. -> [{ period, ranked: [{ name, value, rank }] }].
 */
export function rankByPeriod(rows, top) {
  const periods = new Map();
  for (const { period, name, value } of rows) {
    if (!periods.has(period)) periods.set(period, new Map());
    periods.get(period).set(name, value);
  }
  return [...periods].map(([period, values]) => ({
    period,
    ranked: [...values].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value || byName(a, b)).slice(0, top).map((r, rank) => ({ ...r, rank })),
  }));
}

const periodCount = (p) => new Set(p.rows.map((r) => r.period)).size;
const periodSeconds = (p) => p.periodSeconds ?? params.properties.periodSeconds.default;
// The scene must hold every period for periodSeconds (and the title's entrance, when one period is shorter than that).
const minDuration = (p) => Math.max(periodCount(p) * periodSeconds(p), ENTER_SECONDS);

function validate(p, { sceneDuration }) {
  if (sceneDuration + EPSILON >= minDuration(p)) return [];
  return [{ path: 'periodSeconds', message: `${periodCount(p)} periods × ${num(periodSeconds(p))}s need a scene of at least ${num(minDuration(p))}s` }];
}

// Each name's track: for every period, its rank and value when it is in the top, else null.
function tracksOf(table, order) {
  return order.map((name) => table.map(({ ranked }) => ranked.find((r) => r.name === name) ?? null));
}

// The value a name shows at period i: its own when it is in the top, else the nearest one before it, else the first after.
function heldValues(track) {
  const first = track.find(Boolean)?.value ?? 0;
  let held = first;
  return track.map((state) => { if (state) held = state.value; return held; });
}

// The periods a name needs a keyframe at: where it is in the top, and the period before and after each stretch in it
// (where it fades in below the last row, and where it drops out). Between those it holds still, hidden.
const keyframePeriods = (track) => track.map((state, i) => Boolean(state || track[i - 1] || track[i + 1]));

function expand(el, ctx) {
  const { size, sceneDuration } = ctx;
  const p = el.params;
  const u = unit(size);
  const top = p.top ?? params.properties.top.default;
  const step = periodSeconds(p);
  const decimals = p.decimals ?? 0;
  const id = (part) => `${el.id}/${part}`;
  const table = rankByPeriod(p.rows, top);
  const order = [];
  for (const { ranked } of table) for (const { name } of ranked) if (!order.includes(name)) order.push(name);
  const tracks = tracksOf(table, order);
  const maxValue = Math.max(...p.rows.map((r) => r.value));
  const shown = Math.min(top, order.length);

  const width = Math.max(1, contentWidth(size, 1500 * u, 0, ctx.insets));
  const room = roomAt(freeBand(ctx), el.y);
  const gap = GAP * u;
  const floor = Math.max(1, Math.round(MIN_TEXT * u));
  const titleFit = p.title && fitHeight(p.title, { sizes: sizeLadder(TITLE_SIZES, u), maxWidth: width, maxHeight: room / 6, lineHeight: LINE_HEIGHT.title });
  const periodFit = fitText(longest(table.map((t) => t.period)), { size: PERIOD_SIZE * u, min: floor, maxWidth: width, maxLines: 2 });
  const reserved = (titleFit ? titleFit.height + gap : 0) + periodFit.height + gap;
  // One row more than the bars: the spot a name waits in, hidden, below the last bar, which the period label stays clear of.
  const rowH = Math.max(1, Math.floor(Math.min(ROW_MAX * u, (room - reserved) / (shown + 1))));
  const heights = [...(titleFit ? [titleFit.height] : []), (shown + 1) * rowH, periodFit.height];
  const ys = stack(heights, [gap, gap]);
  const rowsTop = ys.at(-2) - ((shown + 1) * rowH) / 2;
  const rowY = (rank) => Math.round(rowsTop + rank * rowH + rowH / 2);

  // Name column, bar, counter column: each as wide as its text needs, the name at most NAME_SHARE.max of the width.
  const target = Math.min(NAME_SIZE * u, 0.62 * rowH);
  const longestName = longest(order);
  const lines = rowH >= 2 * floor * LINE_HEIGHT.sans ? 2 : 1;
  const nameNeed = textWidth(longestName, floor);
  const nameW = Math.min(NAME_SHARE.max * width, Math.max(NAME_SHARE.min * width, nameNeed)); // one line when it fits; a longer name wraps to `lines`
  const nameSize = fitText(longestName, { size: target, min: floor, maxWidth: nameW, maxLines: lines }).fontSize;
  const widest = `${p.prefix ?? ''}${maxValue.toFixed(decimals)}${p.suffix ?? ''}`;
  const valueNeed = VALUE_SLACK * textWidth(widest, nameSize);
  const valueW = Math.min(VALUE_SHARE_MAX * width, valueNeed);
  const valueSize = valueNeed > valueW ? Math.max(floor, Math.floor((nameSize * valueW) / valueNeed)) : nameSize;
  const barW = Math.max(1, width - nameW - valueW - 2 * gap);
  const nameX = -width / 2 + nameW / 2;
  const barX = -width / 2 + nameW + gap + barW / 2;
  const valueX = width / 2 - valueW / 2;

  const nominalEnd = Math.max(ENTER_SECONDS, (table.length - 1) * step + fadeOf(step));
  const at = fitSchedule(sceneDuration, nominalEnd, minDuration(p));
  const draw = (v) => (maxValue > 0 ? Number((v / maxValue).toFixed(DRAW_DIGITS)) : 0);

  const bars = [];
  const names = [];
  const values = [];
  order.forEach((name, k) => {
    const track = tracks[k];
    const held = heldValues(track);
    const wanted = keyframePeriods(track);
    const frames = track.flatMap((state, i) => {
      if (!wanted[i]) return [];
      const y = rowY(state ? state.rank : shown);
      return [{ i, y, opacity: state ? 1 : 0, value: held[i] }];
    });
    const first = frames[0];
    const move = (kf, extra) => ({ t: at(kf.i * step), y: kf.y, opacity: kf.opacity, ...extra, ...(kf === first ? {} : { ease: 'move' }) });
    const k1 = k + 1;
    bars.push({
      ...linePart(id(`bar-${k1}`), barX, first.y, barW, { stroke: COLOURS[k % COLOURS.length], strokeWidth: Math.max(1, Math.round(BAR_SHARE * rowH)) }),
      keyframes: frames.map((kf) => move(kf, { draw: draw(kf.value) })),
    });
    names.push({ ...textPart(id(`name-${k1}`), name, nameX, first.y, { fontSize: nameSize, maxWidth: nameW, fontWeight: 600, color: 'text' }), keyframes: frames.map((kf) => move(kf, {})) });
    const counter = { id: id(`value-${k1}`), type: 'counter', x: Math.round(valueX), y: first.y, from: first.value, to: held.at(-1), decimals, fontSize: valueSize, fontWeight: 700, color: 'text' };
    if (p.prefix !== undefined) counter.prefix = p.prefix;
    if (p.suffix !== undefined) counter.suffix = p.suffix;
    values.push({ ...counter, keyframes: frames.map((kf) => move(kf, { value: kf.value })) });
  });

  const labelY = ys.at(-1);
  const fade = fadeOf(step);
  const labels = table.map(({ period }, i) => {
    const label = textPart(id(`period-${i + 1}`), period, 0, labelY, { fontSize: periodFit.fontSize, maxWidth: width, fontWeight: 800, color: 'text2' });
    const into = i === 0 ? [{ t: at(0), opacity: 1 }] : [{ t: at(i * step), opacity: 0 }, { t: at(i * step + fade), opacity: 1, ease: 'enter' }];
    const out = i === table.length - 1 ? [] : [{ t: at((i + 1) * step - fade), opacity: 1 }, { t: at((i + 1) * step), opacity: 0 }];
    return { ...label, keyframes: [...into, ...out] };
  });

  const parts = [...bars, ...names, ...values, ...labels];
  if (titleFit) parts.push(enter(textPart(id('title'), p.title, 0, ys[0], { fontSize: titleFit.fontSize, maxWidth: width, fontWeight: 700, role: 'title', color: 'text' }), [0, ENTER_SECONDS].map(at), { dy: 24 * u }));
  return blockGroup(el, parts);
}

// How long a period label takes to fade in or out: a fifth of a second, and at most a quarter of a period.
function fadeOf(step) {
  return Math.min(0.2, step / 4);
}

export default Object.freeze({
  summary: 'a bar chart race: names ranked by value that swap places as the periods (years, quarters) go by, with counters',
  params,
  describe: {
    rows: '4 to 200 of { period, name (up to 24 characters), value (0 or more) }: one row per name per period; periods run in the order they first appear; a name missing from a period holds its last value, hidden unless it is in the top',
    top: 'how many bars show at once, 3 to 10 (default 5)',
    periodSeconds: 'seconds each period is on screen, 0.5 to 4 (default 1); the scene must last periods × periodSeconds',
    title: 'a line above the bars (up to 80 characters)',
    prefix: 'text before each counter, such as $ (up to 6 characters)',
    suffix: 'text after each counter, such as M (up to 6 characters)',
    decimals: 'digits after the point in each counter, 0 to 4',
  },
  example: {
    title: 'Streaming subscribers',
    suffix: 'M',
    top: 4,
    periodSeconds: 1.5,
    rows: [
      ['2021', [['Nova', 38], ['Lumen', 31], ['Orbit', 22], ['Pixel', 12], ['Quill', 6]]],
      ['2022', [['Nova', 49], ['Lumen', 43], ['Orbit', 31], ['Pixel', 24], ['Quill', 15]]],
      ['2023', [['Nova', 58], ['Lumen', 56], ['Orbit', 47], ['Pixel', 41], ['Quill', 33]]],
      ['2024', [['Nova', 63], ['Lumen', 71], ['Orbit', 66], ['Pixel', 58], ['Quill', 61]]],
    ].flatMap(([period, items]) => items.map(([name, value]) => ({ period, name, value }))),
  },
  place: (size, format, _side, insets) => abovePlace(size, format, insets),
  minDuration,
  validate,
  paramOf: (part) => (part === 'title' ? 'title' : /^(bar|name|value|period)-\d+$/.test(part) ? 'rows' : null),
  expand,
});

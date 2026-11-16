// The chart kind's marks as geometry in a plot rectangle, with no look in them (chart-draw.mjs styles and times them):
// the value scale and its reference lines, columns and bars from the baseline, lines and areas through their points,
// and donut segments clockwise from twelve o'clock. Pure and DOM-free.
import { niceTicks } from './chart-scale.mjs';

const TICK_COUNT = 3; // about this many steps on the value scale
export const MAX_REFERENCE_LINES = 3; // light lines beyond the baseline
const BAND_FILL = 0.62; // a column or bar takes this share of its band
const DONUT_HOLE = 0.6; // the hole's radius, of the outer radius
const ARC_STEP = Math.PI / 90; // a donut arc is sampled at most every 2 degrees
const TURN = 2 * Math.PI;
const TWELVE = -Math.PI / 2; // twelve o'clock
const HALF = 2;

/** The shot's data as { items: [{ key, value }] } (bar, column, donut) or { series: [{ name, points: [{ x, y }] }] } (line, area). */
export function chartData(shot) {
  if (shot.type === 'line' || shot.type === 'area') {
    const series = Array.isArray(shot.data) ? [{ name: null, points: shot.data }] : (shot.data?.series ?? []);
    return { series: series.map((s) => ({ name: s.name ?? null, points: Array.isArray(s.points) ? s.points : [] })) };
  }
  return { items: (Array.isArray(shot.data) ? shot.data : []).map((d) => ({ key: String(d.label), value: d.value })) };
}

// Every value a chart plots, finite ones only (the honesty finding names the rest).
const valuesOf = (data) => (data.items ? data.items.map((i) => i.value) : data.series.flatMap((s) => s.points.map((p) => p.y))).filter(Number.isFinite);

/**
 * The value scale: { lo, hi, decimals, ticks, references }. Bars, columns and areas start at the baseline: with a
 * baseline that is not 0 the scale starts exactly there (the broken axis says so), never at a nice tick below it. A
 * line's scale fits its values. At most MAX_REFERENCE_LINES references, the top tick always among them.
 */
export function valueScale(shot, data) {
  const values = valuesOf(data);
  const baseline = shot.baseline ?? 0;
  const fromBase = shot.type !== 'line';
  const lo = values.length === 0 ? 0 : Math.min(...values), hi = values.length === 0 ? 0 : Math.max(...values);
  const nice = fromBase ? niceTicks(Math.min(baseline, lo), Math.max(baseline, hi), TICK_COUNT) : niceTicks(lo, hi, TICK_COUNT);
  const bottom = fromBase && baseline !== 0 ? baseline : nice.lo;
  const ticks = nice.ticks.filter((t) => t >= bottom);
  const rule = fromBase ? Math.max(baseline, bottom) : bottom; // where the baseline rule is drawn (0 inside a scale with negatives)
  let references = ticks.filter((t) => t > bottom && t !== rule);
  while (references.length > MAX_REFERENCE_LINES) references = references.filter((_, i) => (references.length - 1 - i) % HALF === 0);
  return { lo: bottom, hi: Math.max(nice.hi, bottom + nice.step), decimals: nice.decimals, ticks, references, baseline: rule };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const along = (scale, v) => (clamp(v, scale.lo, scale.hi) - scale.lo) / (scale.hi - scale.lo);

/** Columns: { key, value, index, x (centre), width, base, tip } in px, growing up from the baseline (down for a value under it). */
export function columnMarks(items, plot, scale) {
  const band = plot.w / Math.max(1, items.length);
  const yOf = (v) => plot.y + plot.h - along(scale, v) * plot.h;
  return items.map((it, index) => ({
    key: it.key, value: it.value, index, x: plot.x + band * (index + 1 / HALF), width: band * BAND_FILL, band,
    base: yOf(scale.baseline), tip: yOf(Number.isFinite(it.value) ? it.value : scale.baseline),
  }));
}

/** Bars: { key, value, index, y (centre), height, base, tip } in px, growing right from the baseline (left for a value under it). */
export function barMarks(items, plot, scale) {
  const band = plot.h / Math.max(1, items.length);
  const xOf = (v) => plot.x + along(scale, v) * plot.w;
  return items.map((it, index) => ({
    key: it.key, value: it.value, index, y: plot.y + band * (index + 1 / HALF), height: band * BAND_FILL, band,
    base: xOf(scale.baseline), tip: xOf(Number.isFinite(it.value) ? it.value : scale.baseline),
  }));
}

/**
 * Lines: { name, index, points: [[x, y]] } in px. Numbers on x are placed on a linear axis over their range; anything
 * else is a category, placed evenly in the order the series first name it. `xs` lists the x labels in axis order.
 */
export function lineMarks(series, plot, scale) {
  const all = series.flatMap((s) => s.points.map((p) => p.x));
  const numeric = all.length > 0 && all.every((x) => typeof x === 'number' && Number.isFinite(x));
  const order = numeric ? [...new Set(all)].sort((a, b) => a - b) : [...new Set(all.map(String))];
  const lo = numeric ? order[0] : 0, hi = numeric ? order.at(-1) : order.length - 1;
  const xOf = (x) => plot.x + (hi === lo ? 1 / HALF : ((numeric ? x : order.indexOf(String(x))) - lo) / (hi - lo)) * plot.w;
  const yOf = (v) => plot.y + plot.h - along(scale, v) * plot.h;
  const lines = series.map((s, index) => ({
    name: s.name, index, points: s.points.filter((p) => Number.isFinite(p.y)).map((p) => [xOf(p.x), yOf(p.y)]), values: s.points.map((p) => p.y),
  }));
  return { lines, xs: order.map((x) => ({ x, at: xOf(x) })), baseY: yOf(scale.baseline) };
}

/** Donut segments: { key, value, index, share, from, to, mid } (radians, clockwise from twelve o'clock) and the ring. */
export function donutMarks(items, plot) {
  const r = Math.min(plot.w, plot.h) / HALF;
  const thickness = r * (1 - DONUT_HOLE);
  const values = items.map((it) => (Number.isFinite(it.value) && it.value > 0 ? it.value : 0));
  const total = values.reduce((a, b) => a + b, 0);
  let from = TWELVE;
  const segments = items.map((it, index) => {
    const share = total > 0 ? values[index] / total : 1 / Math.max(1, items.length);
    const seg = { key: it.key, value: it.value, index, share, from, to: from + share * TURN, mid: from + (share * TURN) / HALF };
    from = seg.to;
    return seg;
  });
  return { segments, cx: plot.x + plot.w / HALF, cy: plot.y + plot.h / HALF, r, thickness, centre: r - thickness / HALF };
}

/** The points of an arc of radius `r` about (cx, cy) from angle `from` to `to`, at least every ARC_STEP. */
export function arcPoints(cx, cy, r, from, to) {
  const steps = Math.max(1, Math.ceil(Math.abs(to - from) / ARC_STEP));
  return Array.from({ length: steps + 1 }, (_, k) => {
    const a = from + ((to - from) * k) / steps;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
}

// The chart kind's `race` type (plan 2026-11-16-pa2-shot-kinds-b, Task 10): `data` { periods, rows: [{ name, values }] },
// the top `top` rows of each period as bars from zero on one scale for every period, ranked by value (ties keep the given
// order; ranking adapted from version 1's race block, template/blocks/race.mjs rankByPeriod, which broke ties by name).
// The periods are spread over the narration; at each the bars change length and rank with the look's settle move and
// the values step to the period's (set in fixed advances); the period shows top right, a numeral in the display face
// in a stack look (pop) and a label in the label face otherwise (desk). The land event is the last period's arrival.
// Pure and DOM-free.
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';
import { CAP_HEIGHT, WORD_DESCENT, fontFor, isEditorial, rectPath, shownFrom } from './shared.mjs';
import { valueText, numeralLayout } from './chart-scale.mjs';
import { label, labelWidth } from './chart-labels.mjs';
import { valueDecimals } from './chart-draw.mjs';
import { latestLanding, landBy } from './arrivals.mjs';
import { MIN_HERO_RATIO } from '../review/frame.mjs';

export const TOP_MAX = 6;
const BAND_FILL = 0.62; // a bar takes this share of its row
const HALF = 2;
const MECHANICAL = 'mechanical';

const rowsOf = (shot) => (Array.isArray(shot.data?.rows) ? shot.data.rows : []);
const periodsOf = (shot) => (Array.isArray(shot.data?.periods) ? shot.data.periods : []);
/** How many rows a period shows: `top`, else the smaller of TOP_MAX and the row count. */
export const topOf = (shot) => Math.min(shot.top ?? TOP_MAX, rowsOf(shot).length);

/** The rows' names, in data order (the marks a highlight may name). */
export const raceNames = (shot) => rowsOf(shot).map((r) => String(r.name));

/**
 * Each period's top `top` rows: [{ period, ranked: [{ index, value, rank }] }], value descending, ties in the given
 * order (a stable sort), non-finite values left out.
 */
export function rankByPeriod(shot, top = topOf(shot)) {
  return periodsOf(shot).map((period, p) => ({
    period,
    ranked: rowsOf(shot).map((row, index) => ({ index, value: row.values?.[p] })).filter((r) => Number.isFinite(r.value))
      .sort((a, b) => b.value - a.value).slice(0, top).map((r, rank) => ({ ...r, rank })),
  }));
}

// s a period keeps after it arrives for its bars to settle and its values to show (the longest settle of a look, desk
// 0.6): the same in every look, so the sound plan, which knows no look, cues the land event as the picture shows it
const SETTLE_ROOM = 0.6;

/** When each period arrives: the first on frame 0, the rest evenly to the narration's end, early enough that the last
 *  period's values (shown once its bars settle) land by the latest landing. */
export function raceTimes(shot, timing) {
  const n = periodsOf(shot).length;
  const last = timing.words?.at(-1);
  const latest = Math.max(0, latestLanding(timing) - SETTLE_ROOM);
  const end = Math.min(latest, last ? landBy(last.end ?? last.start, timing) : latest);
  return Array.from({ length: n }, (_, p) => (n <= 1 ? 0 : (p * end) / (n - 1)));
}

/** The land event: the last period's arrival. */
export const raceLanding = (shot, timing) => raceTimes(shot, timing).at(-1) ?? 0;

/** Input rules: each row its own name, and as many values as periods (a row cut short is not a row). */
export function raceProblems(shot) {
  const periods = periodsOf(shot).length;
  return rowsOf(shot).flatMap((row, i) => {
    const first = rowsOf(shot).findIndex((r) => r.name === row.name);
    const twice = first !== i ? [{ path: `data.rows[${i}].name`, message: `"${row.name}" is already the name of data.rows[${first}]: each row needs its own` }] : [];
    const n = Array.isArray(row.values) ? row.values.length : 0;
    const length = n !== periods ? [{ path: `data.rows[${i}].values`, message: `${n} values for ${periods} periods: give one value for each period` }] : [];
    return [...twice, ...length];
  });
}

/** Honesty: bars start at zero (no value below it), every value finite; `top` hides rows only when the highlight stays shown. */
export function raceHonesty(shot) {
  const finding = (kind, path, message) => ({ kind, path, at: 0, message });
  const values = rowsOf(shot).flatMap((row, i) => (Array.isArray(row.values) ? row.values : []).flatMap((v, j) => {
    if (!Number.isFinite(v)) return [finding(MECHANICAL, `data.rows[${i}].values[${j}]`, 'a chart value must be a finite number')];
    return v < 0 ? [finding(MECHANICAL, `data.rows[${i}].values[${j}]`, `${v} is below zero: a race bar is a length from zero, so it cannot show it; use a line chart for values that go negative`)] : [];
  }));
  const hidden = rowsOf(shot).length - topOf(shot);
  if (hidden <= 0) return values;
  const last = rankByPeriod(shot).at(-1)?.ranked ?? [];
  const kept = shot.highlight !== undefined && last.some((r) => rowsOf(shot)[r.index].name === shot.highlight);
  return kept ? values : [...values, finding('creative', 'top', `top ${topOf(shot)} hides ${hidden} of ${rowsOf(shot).length} rows at the end: name the row the story is about with highlight (shown at the end), or raise top`)];
}

/** The field a race node shows. */
export function raceField(shot, rest) {
  let m = /^name\.(\d+)$/.exec(rest);
  if (m) return `data.rows[${m[1]}].name`;
  m = /^value\.(\d+)\.(\d+)$/.exec(rest);
  if (m) return shot.unit === undefined ? `data.rows[${m[1]}].values[${m[2]}]` : 'unit'; // a value label shows the unit too
  m = /^period\.(\d+)(\.|$)/.exec(rest);
  if (m) return 'data.periods';
  if (rest === 'counts') return 'valueLabel';
  return /^(row|mark)\.\d+$/.test(rest) ? 'data' : null; // the bars show the data
}

// A track that holds values[0] and moves to each next value with `move`, starting at times[i].
function moving(values, times, move) {
  const keys = [{ t: 0, v: values[0] }];
  values.slice(1).forEach((v, i) => {
    const from = keys.at(-1).v;
    if (v !== from) keys.push({ t: times[i + 1], v: from }, { t: times[i + 1] + move.dur, v, ease: move.ease });
  });
  return track(keys);
}

// A row's opacity: shown while it is in the top rows (a step at each period), and dimmed to OVERTAKEN while it moves
// down a rank, so the row passing over it reads and the two names never sit on each other at full strength.
const OVERTAKEN = 0.35;
function rowOpacity(ranks, ys, times, move) {
  const shownAt = (p) => (ranks[p] ? 1 : 0);
  const keys = [{ t: 0, v: shownAt(0) }];
  for (let p = 1; p < ranks.length; p++) {
    keys.push({ t: times[p], v: shownAt(p - 1) }, { t: times[p], v: shownAt(p) });
    if (ranks[p - 1] && ranks[p] && ys[p] > ys[p - 1]) {
      keys.push({ t: times[p] + move.dur / HALF, v: OVERTAKEN, ease: 'inOutQuad' }, { t: times[p] + move.dur, v: 1, ease: 'inOutQuad' });
    }
  }
  return track(keys);
}

// The period shown top right: a numeral in the display face at three times the labels (stack look), else a label.
function periodNodes(shot, ctx, style, { area, times }) {
  const { look, unit, measure } = ctx;
  const editorial = isEditorial(look);
  const font = editorial ? style.font : fontFor(look, 'display', Math.ceil(MIN_HERO_RATIO * style.font.size), unit);
  const height = (CAP_HEIGHT + WORD_DESCENT) * font.size;
  const nodes = periodsOf(shot).map((text, p) => {
    const until = times[p + 1];
    const tracks = { opacity: shownFrom(times[p], until) };
    if (editorial) return label(ctx, { id: `${shot.id}.period.${p}`, text, font, x: area.x + area.w, y: area.y + CAP_HEIGHT * font.size, align: 'right', fill: style.text, asWritten: true, tracks }).node;
    const layout = numeralLayout(text, font, measure);
    return node('text', `${shot.id}.period.${p}`, { x: area.x + area.w - layout.width, y: area.y + CAP_HEIGHT * font.size - layout.lines[0].y, layout, font, fill: look.palette.accent, role: 'hero' }, { tracks });
  });
  return { nodes, height };
}

/** The race in `area`: { nodes, boxes, plot, highlight }. */
export function drawRace(shot, ctx, style, area, { headroom = 0 } = {}) {
  const { look } = ctx;
  const { font, gap } = style;
  const times = raceTimes(shot, ctx.timing);
  const table = rankByPeriod(shot);
  const shown = topOf(shot);
  const period = periodNodes(shot, ctx, style, { area: { ...area, y: area.y + headroom }, times });
  const all = rowsOf(shot).flatMap((r) => (Array.isArray(r.values) ? r.values : [])).filter(Number.isFinite);
  const max = Math.max(1e-9, ...all);
  const decimals = valueDecimals(all);
  const gutter = Math.max(...raceNames(shot).map((n) => labelWidth(ctx, font, n))) + gap;
  const valueRoom = Math.max(...all.map((v) => labelWidth(ctx, font, valueText(v, decimals, shot.unit), true))) + gap;
  const plot = { x: area.x + gutter, y: area.y + headroom + period.height + gap, w: Math.max(1, area.w - gutter - valueRoom), h: 0 };
  plot.h = Math.max(1, area.y + area.h - plot.y);
  const rowH = plot.h / shown;
  const thick = rowH * BAND_FILL;
  const rows = rowsOf(shot).map((row, k) => {
    const ranks = table.map((t) => t.ranked.find((r) => r.index === k) ?? null);
    const ys = ranks.map((r) => (r === null ? shown : r.rank) * rowH);
    const lengths = ranks.map((r) => (r === null ? 0 : r.value / max));
    const visible = rowOpacity(ranks, ys, times, look.moves.settle);
    const hl = row.name === shot.highlight;
    const mid = plot.y + rowH / HALF;
    const bar = node('path', `${shot.id}.mark.${k}`, { d: rectPath(plot.w, thick), x: plot.x, y: mid - thick / HALF, fill: hl ? (style.hlFill ?? style.accent) : style.mark }, { tracks: { scaleX: moving(lengths, times, look.moves.settle) } });
    const name = label(ctx, { id: `${shot.id}.name.${k}`, text: String(row.name), font, x: plot.x - gap, y: mid + (CAP_HEIGHT * font.size) / HALF, align: 'right', fill: hl ? style.strong : style.text, tracks: {} }).node;
    const values = valueNodes(shot, ctx, { ranks, lengths, times, plot, gap, font, decimals, k, y: mid + (CAP_HEIGHT * font.size) / HALF, fill: style.text });
    return node('group', `${shot.id}.row.${k}`, {}, { tracks: { y: moving(ys, times, look.moves.settle), opacity: visible }, children: [bar, name, ...values] });
  });
  const boxes = Object.fromEntries(rowsOf(shot).map((_, k) => [`mark:${k}`, [plot.x, plot.y + k * rowH, plot.w, rowH]]));
  const counts = countsNode(shot, ctx, style, { x: area.x, y: area.y + headroom + CAP_HEIGHT * style.font.size });
  return { nodes: [...period.nodes, ...counts, ...rows], boxes: { plot: [plot.x, plot.y, plot.w, plot.h], ...boxes }, plot, highlight: null };
}

// A row's value labels, one per period: each rides its bar's end (the same move as the bar) and stays until the next
// period's bars have settled, so a value is never off screen while its bar moves (gate-kinds-b-1: values vanished
// mid-reorder); the next value takes over as the bar lands.
function valueNodes(shot, ctx, { ranks, lengths, times, plot, gap, font, decimals, k, y, fill }) {
  const settle = ctx.look.moves.settle;
  const x = moving(lengths.map((len) => plot.x + plot.w * len + gap / HALF), times, settle);
  const until = (p) => (times[p + 1] === undefined ? undefined : times[p + 1] + settle.dur);
  return ranks.map((r, p) => (r === null ? null : label(ctx, {
    id: `${shot.id}.value.${k}.${p}`, text: valueText(r.value, decimals, shot.unit), font, x: plot.x + plot.w * lengths[p] + gap / HALF, y, fill, numeric: true,
    tracks: { x, opacity: shownFrom(p === 0 ? 0 : times[p] + settle.dur, until(p)) },
  }).node)).filter(Boolean);
}

// What the values count (`valueLabel`, "orders to date" for a running total), in the label face on the period's row at
// the left, so the clock and its measure read together.
function countsNode(shot, ctx, style, { x, y }) {
  if (shot.valueLabel === undefined) return [];
  return [label(ctx, { id: `${shot.id}.counts`, text: shot.valueLabel, font: style.font, x, y, fill: style.text, tracks: {} }).node];
}

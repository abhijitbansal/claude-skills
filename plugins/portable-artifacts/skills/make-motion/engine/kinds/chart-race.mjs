// The chart kind's `race` type (plan 2026-11-16-pa2-shot-kinds-b, Task 10): `data` { periods, rows: [{ name, values }] },
// the top `top` rows of each period as bars from zero on one scale for every period, ranked by value (ties keep the given
// order; ranking adapted from version 1's race block, rankByPeriod in template/blocks/race.mjs (deleted at cut-over), which broke ties by name).
// The periods are spread over the narration; at each the values count to the period's over the look's settle move (set
// in fixed advances), and the bars' lengths and ranks follow the values shown, step for step; the period shows top right, a numeral in the display face
// in a stack look (pop) and a label in the label face otherwise (desk). The land event is the last period's arrival.
// Pure and DOM-free.
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';
import { ease } from '../time/ease.mjs';
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
  m = /^value\.(\d+)\.(\d+)(\.\d+)?$/.exec(rest); // a count step (value.row.period.step) shows the period's value counting

  if (m) return shot.unit === undefined ? `data.rows[${m[1]}].values[${m[2]}]` : 'unit'; // a value label shows the unit too
  m = /^period\.(\d+)(\.|$)/.exec(rest);
  if (m) return 'data.periods';
  if (rest === 'counts') return 'valueLabel';
  return /^(row|mark)\.\d+$/.test(rest) ? 'data' : null; // the bars show the data
}

// ---- the count (lead ruling f4-1) ----
// One schedule drives every part of a row, so the value it shows, its bar's length and its place never disagree, and
// none of them shows the last period's value once the new period is up (gate-kinds-b-2: the values used to wait for the
// bars to settle, so at Q2 they still read Q1 and a lower value ranked above a higher one). At each period the values
// count from the last shown to the period's in fixed steps over the look's settle move, at the look's own rhythm (desk
// on its 12 fps step, pop every frame), the first step on the period's arrival; at every step the rows are ranked on
// the values shown, so a row changes place on the step its value passes the other's.
const STEP_EPSILON = 1e-9; // keeps 0.6 s * 12 from flooring to 7 for float noise, and a whole value from rounding up

// A step part way from `from` to `to`, rounded toward `to` at `decimals`: it leaves `from` on the first step and never
// passes `to`.
function toward(from, to, share, decimals) {
  const scale = 10 ** decimals;
  const x = (from + (to - from) * share) * scale;
  const v = (to >= from ? Math.ceil(x - STEP_EPSILON) : Math.floor(x + STEP_EPSILON)) / scale;
  return to >= from ? Math.min(v, to) : Math.max(v, to);
}

// Each row's place at one step: its rank among the values shown (ties in the given order), null outside the top.
function slotsOf(shown, top) {
  const order = shown.map((v, k) => ({ v, k })).filter((r) => Number.isFinite(r.v)).sort((a, b) => b.v - a.v).slice(0, top);
  const slots = shown.map(() => null);
  order.forEach((r, rank) => { slots[r.k] = rank; });
  return slots;
}

/**
 * The race's steps: [{ t, shown: [value per row], slots: [rank per row or null] }], the first at 0 (period 0's values),
 * then at each later period's arrival a count over `move` (the share eased by its ease, clamped and never going back,
 * so a spring's overshoot never shows a value past the period's), cut short by the next period's arrival.
 */
export function raceSteps(shot, times, { move, rate, decimals }) {
  const top = topOf(shot);
  const at = (p) => rowsOf(shot).map((r) => r.values?.[p]);
  const curve = ease(move.ease);
  const count = Math.max(1, Math.floor(move.dur * rate + STEP_EPSILON));
  let shown = at(0);
  const steps = [{ t: 0, shown, slots: slotsOf(shown, top) }];
  for (let p = 1; p < times.length; p++) {
    const from = shown;
    const to = at(p);
    let share = 0;
    for (let k = 1; k <= count; k++) {
      const t = times[p] + (move.dur * (k - 1)) / count;
      if (times[p + 1] !== undefined && t >= times[p + 1]) break;
      share = k === count ? 1 : Math.max(share, Math.min(1, curve(k / count)));
      shown = to.map((v, r) => (Number.isFinite(v) && Number.isFinite(from[r]) ? toward(from[r], v, share, decimals) : v));
      steps.push({ t, shown, slots: slotsOf(shown, top) });
    }
  }
  return steps;
}

// A stepped track of `valueAt(step)` over the steps: each value holds until the step that changes it.
function stepped(steps, valueAt) {
  const keys = [{ t: 0, v: valueAt(steps[0]) }];
  for (const step of steps.slice(1)) {
    const v = valueAt(step);
    if (v !== keys.at(-1).v) keys.push({ t: step.t, v: keys.at(-1).v }, { t: step.t, v });
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
  const steps = raceSteps(shot, times, { move: look.moves.settle, rate: look.moves.draw.step ?? ctx.fps, decimals });
  const rows = rowsOf(shot).map((row, k) => {
    const shownOf = (step) => (step.slots[k] === null ? 0 : step.shown[k]);
    const hl = row.name === shot.highlight;
    const mid = plot.y + rowH / HALF;
    const bar = node('path', `${shot.id}.mark.${k}`, { d: rectPath(plot.w, thick), x: plot.x, y: mid - thick / HALF, fill: hl ? (style.hlFill ?? style.accent) : style.mark }, { tracks: { scaleX: stepped(steps, (s) => shownOf(s) / max) } });
    const name = label(ctx, { id: `${shot.id}.name.${k}`, text: String(row.name), font, x: plot.x - gap, y: mid + (CAP_HEIGHT * font.size) / HALF, align: 'right', fill: hl ? style.strong : style.text, tracks: {} }).node;
    const values = valueNodes(shot, ctx, { steps, times, plot, gap, font, decimals, k, max, y: mid + (CAP_HEIGHT * font.size) / HALF, fill: style.text });
    const tracks = { y: stepped(steps, (s) => (s.slots[k] ?? shown) * rowH), opacity: stepped(steps, (s) => (s.slots[k] === null ? 0 : 1)) };
    return node('group', `${shot.id}.row.${k}`, {}, { tracks, children: [bar, name, ...values] });
  });
  const boxes = Object.fromEntries(rowsOf(shot).map((_, k) => [`mark:${k}`, [plot.x, plot.y + k * rowH, plot.w, rowH]]));
  const counts = countsNode(shot, ctx, style, { x: area.x, y: area.y + headroom + CAP_HEIGHT * style.font.size });
  return { nodes: [...period.nodes, ...counts, ...rows], boxes: { plot: [plot.x, plot.y, plot.w, plot.h], ...boxes }, plot, highlight: null };
}

// The period a time falls in: the last one that has arrived.
const periodAt = (times, t) => times.findLastIndex((at) => at <= t + STEP_EPSILON);

// A row's value labels, one for each value the steps show it, at its bar's end (the bar is that long on the same
// steps), so the row always shows exactly one value, never off screen while its bar moves (gate-kinds-b-1: values
// vanished mid-reorder). A period's own value is `value.<row>.<period>`; a count step on the way to it adds the step.
function valueNodes(shot, ctx, { steps, times, plot, gap, font, decimals, k, max, y, fill }) {
  const valueAt = (s) => (s.slots[k] === null ? null : s.shown[k]);
  const runs = steps.filter((s, i) => i === 0 || valueAt(s) !== valueAt(steps[i - 1]));
  const ids = new Set();
  return runs.map((s, i) => {
    const v = valueAt(s);
    if (v === null) return null;
    const p = periodAt(times, s.t);
    const own = `${shot.id}.value.${k}.${p}`;
    const id = v === rowsOf(shot)[k].values[p] && !ids.has(own) ? own : `${own}.${i}`;
    ids.add(id);
    return label(ctx, {
      id, text: valueText(v, decimals, shot.unit), font, x: plot.x + plot.w * (v / max) + gap / HALF, y, fill, numeric: true,
      tracks: { opacity: shownFrom(s.t, runs[i + 1]?.t) },
    }).node;
  }).filter(Boolean);
}

// What the values count (`valueLabel`, "orders to date" for a running total), in the label face on the period's row at
// the left, so the clock and its measure read together.
function countsNode(shot, ctx, style, { x, y }) {
  if (shot.valueLabel === undefined) return [];
  return [label(ctx, { id: `${shot.id}.counts`, text: shot.valueLabel, font: style.font, x, y, fill: style.text, tracks: {} }).node];
}

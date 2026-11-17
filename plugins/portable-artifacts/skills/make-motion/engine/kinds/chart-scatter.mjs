// The chart kind's `scatter` type (plan 2026-11-16-pa2-shot-kinds-b, Task 10): 3 to 40 points { x, y, label? } on two
// named axes that fit the data (chart-scale.mjs niceTicks, ticks labelled, so a range that does not start at 0 says so
// on its axis); at most 6 points labelled, their labels spread apart (chart-labels.mjs spread). The points arrive
// together over the first sentence, one after another as steps (one cue, not one per point); the highlighted point
// turns accent and takes the `label` device on the word that names it, while the others dim. Drawn by both looks'
// compositions through chart-plot.mjs. Pure and DOM-free.
import { node } from '../graph/node.mjs';
import { registries } from '../registry.mjs';
import { polyline, roundedRect } from '../devices/shared.mjs';
import { CAP_HEIGHT, WORD_DESCENT } from './shared.mjs';
import { niceTicks, valueText } from './chart-scale.mjs';
import { label, labelWidth, arriveAt } from './chart-labels.mjs';
import { chartTimes } from './chart-time.mjs';
import { dimTracks } from './chart-draw.mjs';
import { arrivalTrack } from './arrivals.mjs';

export const SCATTER_MIN = 3;
export const SCATTER_MAX = 40;
export const SCATTER_LABELS_MAX = 6;
const TICKS = 3;
const HALF = 2;
const MECHANICAL = 'mechanical';

// Do two boxes share some area?
const meets = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
// Is a w x h label at `spot` clear of every dot and every label placed before it?
const clearOf = ([x, y], dots, taken, w, h) => ![...dots, ...taken].some((b) => meets(b, [x, y, w, h]));

/** The labelled points' labels, in data order (the marks a highlight may name). */
export const scatterNames = (shot) => (Array.isArray(shot.data) ? shot.data.filter((p) => p?.label !== undefined).map((p) => String(p.label)) : []);

/** Input rules: at most SCATTER_LABELS_MAX labelled points, each label its own. */
export function scatterProblems(shot) {
  const data = Array.isArray(shot.data) ? shot.data : [];
  const labelled = data.map((p, i) => [p?.label, i]).filter(([l]) => l !== undefined);
  const many = labelled.length > SCATTER_LABELS_MAX ? [{ path: 'data', message: `${labelled.length} points carry a label; a scatter labels at most ${SCATTER_LABELS_MAX}: keep the labels of the points the narration names` }] : [];
  const twice = labelled.filter(([l], k) => labelled.findIndex(([m]) => m === l) !== k)
    .map(([l, i]) => ({ path: `data[${i}].label`, message: `"${l}" is already the label of data[${labelled.find(([m]) => m === l)[1]}]: each point needs its own` }));
  return [...many, ...twice];
}

/** Honesty: every value finite, and at least SCATTER_MIN points (two points are a line). */
export function scatterHonesty(shot) {
  const data = Array.isArray(shot.data) ? shot.data : [];
  const finding = (path, message) => ({ kind: MECHANICAL, path, at: 0, message });
  const few = data.length < SCATTER_MIN ? [finding('data', `a scatter of ${data.length} points is a line: give at least ${SCATTER_MIN}, or use a line chart`)] : [];
  const bad = data.flatMap((p, i) => ['x', 'y'].filter((k) => !Number.isFinite(p?.[k])).map((k) => finding(`data[${i}].${k}`, 'a chart value must be a finite number')));
  return [...few, ...bad];
}

/** The field a scatter node shows: a point's label, an axis name, or null for a tick or a mark. */
export function scatterField(shot, rest) {
  if (rest === 'xLabel' || rest === 'yLabel') return rest;
  const m = /^label\.(\d+)(\.|$)/.exec(rest);
  if (m) return `data[${m[1]}].label`;
  return /^(point|mark)\.\d+(\.|$)/.test(rest) ? 'data' : null; // the points show the data
}

// The two axes: ticks (each a label), the rules along the left and the foot of the plot.
function axes(shot, ctx, style, { plot, xs, ys, xOf, yOf }) {
  const { font, gap } = style;
  const rule = (id, a, b) => node('path', `${shot.id}.${id}`, { d: polyline([a, b]), stroke: style.strong, strokeWidth: style.axisWidth, lineCap: 'butt' });
  const foot = plot.y + plot.h;
  const ticksY = ys.ticks.map((t, k) => label(ctx, { id: `${shot.id}.tick.y${k}`, text: valueText(t, ys.decimals), font, x: plot.x - gap, y: yOf(t) + (CAP_HEIGHT * font.size) / HALF, align: 'right', fill: style.text, numeric: true }).node);
  const ticksX = xs.ticks.map((t, k) => label(ctx, { id: `${shot.id}.tick.x${k}`, text: valueText(t, xs.decimals), font, x: xOf(t), y: foot + gap + CAP_HEIGHT * font.size, align: 'center', fill: style.text, numeric: true }).node);
  return [rule('axis.y', [plot.x, plot.y], [plot.x, foot]), rule('axis.x', [plot.x, foot], [plot.x + plot.w, foot]), ...ticksY, ...ticksX];
}

// The plot inside `area` once the axis names and ticks have their room: { plot, xs, ys, xOf, yOf, rowH }.
function frame(shot, ctx, style, area, headroom) {
  const { font, gap } = style;
  const pts = shot.data.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const xs = niceTicks(Math.min(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.x)), TICKS);
  const ys = niceTicks(Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.y)), TICKS);
  const rowH = (CAP_HEIGHT + WORD_DESCENT) * font.size;
  const gutter = Math.max(...ys.ticks.map((t) => labelWidth(ctx, font, valueText(t, ys.decimals), true))) + gap;
  const right = Math.max(labelWidth(ctx, font, valueText(xs.hi, xs.decimals), true) / HALF, gap);
  const top = area.y + headroom + rowH + gap + rowH / HALF; // the y axis's name over the plot, clear of the top tick's half
  const plot = { x: area.x + gutter, y: top, w: Math.max(1, area.w - gutter - right), h: Math.max(1, area.y + area.h - top - HALF * (rowH + gap)) };
  const xOf = (v) => plot.x + ((v - xs.lo) / (xs.hi - xs.lo)) * plot.w;
  const yOf = (v) => plot.y + plot.h - ((v - ys.lo) / (ys.hi - ys.lo)) * plot.h;
  return { plot, xs, ys, xOf, yOf, rowH, pts };
}

/** The scatter in `area`: { nodes, boxes, plot, highlight }. */
export function drawScatter(shot, ctx, style, area, { headroom = 0 } = {}) {
  const { look, unit } = ctx;
  const { font, gap } = style;
  const f = frame(shot, ctx, style, area, headroom);
  const times = chartTimes(shot, ctx.timing);
  const r = (look.kinds?.chart?.point ?? style.line) * unit;
  const hl = shot.highlight === undefined ? -1 : shot.data.findIndex((p) => String(p.label) === shot.highlight);
  const n = shot.data.length;
  const marks = shot.data.flatMap((p, k) => {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return [];
    const at = (times.growEnd * (k + 1)) / n;
    const d = roundedRect(f.xOf(p.x) - r, f.yOf(p.y) - r, HALF * r, HALF * r, r);
    const dims = hl >= 0 && k !== hl ? dimTracks(look, times.highlightAt, style.dim) : {};
    const point = node('path', `${shot.id}.mark.${k}`, { d, fill: style.mark }, { tracks: { opacity: arrivalTrack(at) } });
    const out = [node('group', `${shot.id}.point.${k}`, {}, { tracks: dims, children: [point] })];
    if (k === hl) out.push(node('path', `${shot.id}.mark.${k}.accent`, { d, fill: style.hlFill ?? style.accent }, { tracks: arriveAt(look, times.highlightAt) }));
    return out;
  });
  const names = [
    label(ctx, { id: `${shot.id}.yLabel`, text: shot.yLabel, font, x: area.x, y: area.y + headroom + CAP_HEIGHT * font.size, fill: style.text }).node,
    label(ctx, { id: `${shot.id}.xLabel`, text: shot.xLabel, font, x: f.plot.x + f.plot.w, y: area.y + area.h - WORD_DESCENT * font.size, align: 'right', fill: style.text }).node,
  ];
  const labels = pointLabels(shot, ctx, style, f, { r, hl, times, n });
  const boxes = Object.fromEntries(shot.data.map((p, k) => [`mark:${k}`, [f.xOf(p.x) - r, f.yOf(p.y) - r, HALF * r, HALF * r]]));
  return { nodes: [...axes(shot, ctx, style, f), ...marks, ...labels, ...names], boxes: { plot: [f.plot.x, f.plot.y, f.plot.w, f.plot.h], ...boxes }, plot: f.plot, highlight: null };
}

// The labelled points' labels: right of their points, spread so none meets the next; the highlighted one by the label
// device (a leader to its point) on the word that names it. A label that cannot be kept apart says so (crowded).
function pointLabels(shot, ctx, style, f, { r, hl, times, n }) {
  const { font, gap } = style;
  const { look, unit, seed, measure } = ctx;
  const labelled = shot.data.map((p, k) => ({ p, k })).filter(({ p, k }) => p.label !== undefined && k !== hl && Number.isFinite(p.x) && Number.isFinite(p.y));
  const h = (CAP_HEIGHT + WORD_DESCENT) * font.size;
  const pad = r + gap / HALF;
  // every point's box, kept clear by each label (a label over a dot hides it: the contrast rule caught ink2 on ink)
  const dots = shot.data.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)).map((p) => [f.xOf(p.x) - r, f.yOf(p.y) - r, HALF * r, HALF * r]);
  const taken = [];
  const out = labelled.map(({ p, k }) => {
    const text = String(p.label), w = labelWidth(ctx, font, text), cx = f.xOf(p.x), cy = f.yOf(p.y);
    const tries = [[cx + pad, cy - h / HALF], [cx - pad - w, cy - h / HALF], [cx - w / HALF, cy - pad - h], [cx - w / HALF, cy + pad]];
    const inside = ([x, y]) => x >= f.plot.x && x + w <= f.plot.x + f.plot.w + pad && y >= f.plot.y - h && y + h <= f.plot.y + f.plot.h;
    const clear = (spot) => clearOf(spot, dots, taken, w, h);
    const spot = tries.find((t) => inside(t) && clear(t)) ?? tries.find(inside) ?? tries[0];
    taken.push([spot[0], spot[1], w, h]);
    return label(ctx, { id: `${shot.id}.label.${k}`, text, font, x: spot[0], y: spot[1] + CAP_HEIGHT * font.size, fill: style.text, crowded: !(inside(spot) && clearOf(spot, dots, taken.slice(0, -1), w, h)), tracks: { opacity: arrivalTrack((times.growEnd * (k + 1)) / n) } }).node;
  });
  if (hl >= 0 && shot.data[hl].label !== undefined) {
    const p = shot.data[hl];
    // the side clear of the dots and the other labels (the device's own leader gap is wider than `pad`, so this is a floor)
    const w = labelWidth(ctx, font, String(p.label)) * 1.2, cx = f.xOf(p.x), cy = f.yOf(p.y), lead = 28 * unit + r;
    const sides = [['right', [cx + lead, cy - h / HALF]], ['left', [cx - lead - w, cy - h / HALF]], ['above', [cx - w / HALF, cy - lead - h]], ['below', [cx - w / HALF, cy + lead]]];
    const side = (sides.find(([, s]) => clearOf(s, dots.filter((_, i) => i !== hl), taken, w, h)) ?? sides[0])[0];
    const built = registries.devices.get('label').build({ id: `${shot.id}.label.${hl}`, box: [f.plot.x, f.plot.y, f.plot.w, f.plot.h], at: times.highlightAt, look, unit, seed, measure, text: String(p.label), anchor: [cx, cy], size: font.size, side });
    out.push(...built.nodes);
  }
  return out;
}

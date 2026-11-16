// The chart kind's plot, drawn into an area by both compositions (chart-desk.mjs, chart-pop.mjs): the style read from
// the look, the timing of every mark, and columns and bars (lines and areas: chart-series.mjs; donuts: chart-donut.mjs).
// Marks are ink, the highlighted one gets an accent copy over it on the word that names it and the others dim; light
// reference lines (at most three) and a baseline rule are the only lines; labels sit on the marks (direct, never a
// legend). A bar or column scale that does not start at 0 draws a broken-axis mark and says its baseline. Pure, DOM-free.
import { node } from '../graph/node.mjs';
import { layoutText } from '../text/layout.mjs';
import { landing, isHand, colourOf, polyline } from '../devices/shared.mjs';
import { CAP_HEIGHT, WORD_DESCENT, sizeAt, fontFor, setCase } from './shared.mjs';
import { valueText } from './chart-scale.mjs';
import { chartData, valueScale, columnMarks, barMarks } from './chart-marks.mjs';
import { chartTimes } from './chart-time.mjs';
import { label, labelWidth, arriveAt } from './chart-labels.mjs';

const MAX_STAGGER = 0.08; // seconds between one mark starting to grow and the next
const STAGGER_SHARE = 0.3; // of the growth, at most, taken by the staggers together
const LABEL_SHARE = 0.94; // of a column's band, the widest its label may be
const BAR_LABELS_MAX = 0.32; // of the area, the widest the bar labels' column may be
const CATEGORY_LINES = 2;
const FIT_EPSILON = 0.5;
const CLAMP_ROOM = 1.5; // widths between two thinned labels' centres: room for an end label moved in
const BREAK = Object.freeze({ size: 9, gap: 5 }); // units: the two strokes of a broken-axis mark
const MAX_DECIMALS = 3;
const HALF = 2;

/** The plot's style from look.kinds.chart (`data`) and the palette. */
export function chartStyle(ctx, data) {
  const { look, unit } = ctx;
  return {
    font: fontFor(look, 'label', sizeAt(look, data.labelStep, unit), unit),
    gap: data.gap * unit, line: data.line * unit, refWidth: data.ref * unit, axisWidth: data.axis * unit, dim: data.dim, refs: data.refs,
    mark: colourOf(look, 'ink'), accent: colourOf(look, 'accent'), text: colourOf(look, 'ink2'), strong: colourOf(look, 'ink'), rule: colourOf(look, 'rule'),
    step: isHand(look) ? look.moves.draw.step : undefined,
  };
}

/** The decimals a set of values is shown with: the most any of them has, at most three. */
export const valueDecimals = (values) => Math.min(MAX_DECIMALS, Math.max(0, ...values.filter(Number.isFinite).map((v) => (String(v).split('.')[1] ?? '').length)));

/** When mark k of n grows, all done by `growEnd`: { start, end, dur }. */
export function growWindow(k, n, growEnd) {
  const stagger = n > 1 ? Math.min(MAX_STAGGER, (growEnd * STAGGER_SHARE) / (n - 1)) : 0;
  const dur = growEnd - (n - 1) * stagger;
  return { start: k * stagger, end: k * stagger + dur, dur };
}

/** Opacity for a mark or value that dims from 1 at `at` (the highlight); none without one. */
export const dimTracks = (look, at, dim) => (at === null ? {} : { opacity: landing(at + look.moves.enter.dur, look.moves.enter, 1, dim) });

/** The highlighted mark's index (a label for categories, a series name for lines), or -1. */
export function highlightIndex(shot, data) {
  if (shot.highlight === undefined) return -1;
  return data.items ? data.items.findIndex((i) => i.key === shot.highlight) : data.series.findIndex((s) => s.name === shot.highlight);
}

// A rule from a to b in `colour`.
const rule = (id, [a, b], colour, width) => node('path', id, { d: polyline([a, b]), stroke: colour, strokeWidth: width, lineCap: 'butt' });

/** The broken-axis mark: two short parallel strokes across an axis at (x, y), slanted, drawn in ink. */
export function breakMark(id, ctx, [x, y], width) {
  const s = BREAK.size * ctx.unit, g = BREAK.gap * ctx.unit;
  const d = `${polyline([[x - g - s / HALF, y + s], [x - g + s / HALF, y - s]])}${polyline([[x + g - s / HALF, y + s], [x + g + s / HALF, y - s]])}`;
  return node('path', id, { d, stroke: colourOf(ctx.look, 'ink'), strokeWidth: width, lineCap: 'butt' });
}

/** The text a scale's baseline label says when the scale does not start at 0. */
export const baselineText = (scale, unit) => `from ${valueText(scale.lo, scale.decimals, unit)}`;

// A mark's rectangle about its own origin (the baseline point), as a closed path: `along` px across, `length` px out
// (negative up or left), horizontal for a bar.
function markPath(across, length, horizontal) {
  const h = across / HALF;
  return polyline(horizontal ? [[0, -h], [length, -h], [length, h], [0, h]] : [[-h, 0], [h, 0], [h, length], [-h, length]], true);
}

// One column or bar: the ink mark growing from the baseline (dimming at the highlight unless it is the highlighted one)
// and, for the highlighted one, its accent copy arriving then.
function markNodes(shot, ctx, style, { k, n, x, y, across, length, horizontal, times, hl }) {
  const { look } = ctx;
  const win = growWindow(k, n, times.growEnd);
  const grow = landing(win.end, { ease: look.moves.enter.ease, dur: win.dur }, 0, 1, style.step);
  const d = markPath(across, length, horizontal);
  const scale = horizontal ? { scaleX: grow } : { scaleY: grow };
  const dims = hl >= 0 && k !== hl ? dimTracks(look, times.highlightAt, style.dim) : {};
  const out = [node('path', `${shot.id}.mark.${k}`, { d, fill: style.mark, x, y }, { tracks: { ...scale, ...dims }, step: style.step })];
  if (k === hl) out.push(node('path', `${shot.id}.mark.${k}.accent`, { d, fill: style.accent, x, y }, { tracks: arriveAt(look, times.highlightAt) }));
  return out;
}

/** Does the shot's scale break from 0: a bar or column chart with a baseline that is not 0. */
export const isBroken = (shot) => (shot.type === 'bar' || shot.type === 'column') && (shot.baseline ?? 0) !== 0;

/**
 * The value scale's furniture along a vertical value axis (columns, lines, areas): reference lines across the plot with
 * their ticks in the left gutter, the baseline rule, and the broken-axis mark and its label when the scale breaks.
 */
export function valueAxis(shot, ctx, style, { plot, scale, yOf, gutterX, refs }) {
  const { font, gap } = style;
  const nodes = [];
  if (refs) {
    scale.references.forEach((t, k) => {
      const y = yOf(t);
      nodes.push(rule(`${shot.id}.ref.${k + 1}`, [[plot.x, y], [plot.x + plot.w, y]], style.rule, style.refWidth));
      nodes.push(label(ctx, { id: `${shot.id}.tick.${k + 1}`, text: valueText(t, scale.decimals, shot.unit), font, x: gutterX, y: y + (CAP_HEIGHT * font.size) / HALF, align: 'right', fill: style.text, numeric: true }).node);
    });
  }
  const base = yOf(scale.baseline);
  nodes.push(rule(`${shot.id}.axis`, [[plot.x, base], [plot.x + plot.w, base]], style.strong, style.axisWidth));
  const broken = isBroken(shot);
  if (broken) nodes.push(breakMark(`${shot.id}.break`, ctx, [plot.x, base], style.axisWidth));
  if (broken || refs) {
    const id = broken ? `${shot.id}.baseline` : `${shot.id}.tick.0`;
    const text = broken ? baselineText(scale, shot.unit) : valueText(scale.baseline, scale.decimals, shot.unit);
    nodes.push(label(ctx, { id, text, font, x: gutterX - (broken ? gap : 0), y: base + (CAP_HEIGHT * font.size) / HALF, align: 'right', fill: style.text, numeric: !broken }).node);
  }
  return nodes;
}

/** The left gutter a value axis needs: its widest tick (and baseline label), and a gap. */
export function axisGutter(shot, ctx, style, scale, refs) {
  const texts = [...(refs ? [scale.baseline, ...scale.references].map((t) => valueText(t, scale.decimals, shot.unit)) : [])];
  const widths = texts.map((t) => labelWidth(ctx, style.font, t, true));
  if (isBroken(shot)) widths.push(labelWidth(ctx, style.font, baselineText(scale, shot.unit)) + style.gap);
  return widths.length === 0 ? 0 : Math.max(...widths) + style.gap + (isBroken(shot) ? BREAK.size * ctx.unit : 0);
}

/** Columns in `area`: { nodes, boxes, plot, highlight } (highlight: { index, text } of the highlighted value, or null). */
export function drawColumns(shot, ctx, style, area, { valueOnHighlight }) {
  const data = chartData(shot), scale = valueScale(shot, data), times = chartTimes(shot, ctx.timing);
  const { font, gap } = style;
  const ink = (CAP_HEIGHT + WORD_DESCENT) * font.size;
  const hl = highlightIndex(shot, data), decimals = valueDecimals(data.items.map((i) => i.value));
  const gutter = axisGutter(shot, ctx, style, scale, style.refs);
  const plotW = area.w - gutter, band = plotW / Math.max(1, data.items.length);
  const catLayouts = data.items.map((it) => layoutText({ text: setCase(ctx.look, 'label', it.key), font, maxWidth: band * LABEL_SHARE, measure: ctx.measure }));
  // labels that cannot fit their band are thinned, not stacked on each other: every `stride`-th, flagged as not fitting
  const fits = catLayouts.every((l) => l.lines.length <= CATEGORY_LINES && l.width <= band * LABEL_SHARE + FIT_EPSILON);
  const widest = Math.max(...data.items.map((it) => labelWidth(ctx, font, it.key)));
  const stride = fits ? 1 : Math.ceil((CLAMP_ROOM * widest + gap) / band);
  const catLines = fits ? Math.min(CATEGORY_LINES, Math.max(1, ...catLayouts.map((l) => l.lines.length))) : 1;
  const catH = ink + (catLines - 1) * (catLayouts.find((l) => l.lines.length > 1)?.lines[1].y ?? 0);
  const negative = data.items.some((it) => it.value < scale.baseline);
  const top = ink + gap, bottom = gap + catH + (negative ? ink + gap : 0);
  const plot = { x: area.x + gutter, y: area.y + top, w: plotW, h: Math.max(1, area.h - top - bottom) };
  const yOf = (v) => plot.y + plot.h - ((Math.min(scale.hi, Math.max(scale.lo, v)) - scale.lo) / (scale.hi - scale.lo)) * plot.h;
  const marks = columnMarks(data.items, plot, scale);
  const nodes = [...valueAxis(shot, ctx, style, { plot, scale, yOf, gutterX: plot.x - gap, refs: style.refs })];
  const values = [], labels = [], boxes = {};
  marks.forEach((m) => {
    nodes.push(...markNodes(shot, ctx, style, { k: m.index, n: marks.length, x: m.x, y: m.base, across: m.width, length: m.tip - m.base, horizontal: false, times, hl }));
    boxes[`mark:${m.index}`] = [m.x - m.width / HALF, Math.min(m.base, m.tip), m.width, Math.abs(m.tip - m.base)];
    const up = m.tip <= m.base;
    const y = up ? m.tip - gap - WORD_DESCENT * font.size : m.tip + gap + CAP_HEIGHT * font.size;
    const highlighted = m.index === hl;
    if (!highlighted || valueOnHighlight) {
      const grown = growWindow(m.index, marks.length, times.growEnd).end;
      const tracks = highlighted ? arriveAt(ctx.look, times.highlightAt) : arriveAt(ctx.look, grown);
      values.push(label(ctx, { id: `${shot.id}.value.${m.index}`, text: valueText(m.value, decimals, shot.unit), font, x: m.x, y, align: 'center', fill: highlighted ? style.strong : style.text, numeric: true, maxWidth: band, tracks }).node);
    }
    const catY = plot.y + plot.h + (negative ? ink + gap : 0) + gap + CAP_HEIGHT * font.size;
    if (fits) labels.push(label(ctx, { id: `${shot.id}.label.${m.index}`, text: m.key, font, x: m.x, y: catY, align: 'center', fill: style.text, maxWidth: band * LABEL_SHARE, lines: CATEGORY_LINES }).node);
    else if (m.index % stride === 0) {
      const half = labelWidth(ctx, font, m.key) / HALF; // kept on the plot: the end labels move in, never off the frame
      const x = Math.min(Math.max(m.x, plot.x + half), plot.x + plot.w - half);
      labels.push(label(ctx, { id: `${shot.id}.label.${m.index}`, text: m.key, font, x, y: catY, align: 'center', fill: style.text, crowded: true }).node);
    }
  });
  return { nodes: [...nodes, ...values, ...labels], boxes, plot, highlight: hl >= 0 ? { index: hl, text: valueText(data.items[hl].value, decimals, shot.unit) } : null, times };
}

/** Bars in `area`, labels in a left column, values at the bar ends: { nodes, boxes, plot, highlight }. */
export function drawBars(shot, ctx, style, area, { valueOnHighlight }) {
  const data = chartData(shot), scale = valueScale(shot, data), times = chartTimes(shot, ctx.timing);
  const { font, gap } = style;
  const ink = (CAP_HEIGHT + WORD_DESCENT) * font.size;
  const hl = highlightIndex(shot, data), decimals = valueDecimals(data.items.map((i) => i.value));
  const labelCol = Math.min(area.w * BAR_LABELS_MAX, Math.max(...data.items.map((it) => labelWidth(ctx, font, it.key))));
  const valueCol = Math.max(...data.items.map((it) => labelWidth(ctx, font, valueText(it.value, decimals, shot.unit), true)));
  const rows = (style.refs ? 1 : 0) + (isBroken(shot) ? 1 : 0); // tick labels, then the baseline label on a row of its own
  const below = rows === 0 ? 0 : gap + rows * ink + (rows - 1) * (gap / HALF);
  const plot = { x: area.x + labelCol + gap, y: area.y, w: Math.max(1, area.w - labelCol - gap - valueCol - gap), h: Math.max(1, area.h - below) };
  const xOf = (v) => plot.x + ((Math.min(scale.hi, Math.max(scale.lo, v)) - scale.lo) / (scale.hi - scale.lo)) * plot.w;
  const marks = barMarks(data.items, plot, scale);
  const nodes = [], values = [], labels = [], boxes = {};
  const tickY = plot.y + plot.h + gap + CAP_HEIGHT * font.size;
  if (style.refs) {
    scale.references.forEach((t, k) => {
      const x = xOf(t);
      nodes.push(rule(`${shot.id}.ref.${k + 1}`, [[x, plot.y], [x, plot.y + plot.h]], style.rule, style.refWidth));
      nodes.push(label(ctx, { id: `${shot.id}.tick.${k + 1}`, text: valueText(t, scale.decimals, shot.unit), font, x, y: tickY, align: 'center', fill: style.text, numeric: true }).node);
    });
  }
  const base = xOf(scale.baseline);
  nodes.push(rule(`${shot.id}.axis`, [[base, plot.y], [base, plot.y + plot.h]], style.strong, style.axisWidth));
  if (isBroken(shot)) {
    nodes.push(breakMark(`${shot.id}.break`, ctx, [base, plot.y + plot.h], style.axisWidth));
    const row = style.refs ? ink + gap / HALF : 0;
    nodes.push(label(ctx, { id: `${shot.id}.baseline`, text: baselineText(scale, shot.unit), font, x: base, y: tickY + row, align: 'left', fill: style.text }).node);
  }
  const rowH = marks[0]?.band ?? plot.h;
  marks.forEach((m) => {
    nodes.push(...markNodes(shot, ctx, style, { k: m.index, n: marks.length, x: m.base, y: m.y, across: m.height, length: m.tip - m.base, horizontal: true, times, hl }));
    boxes[`mark:${m.index}`] = [Math.min(m.base, m.tip), m.y - m.height / HALF, Math.abs(m.tip - m.base), m.height];
    const mid = m.y + (CAP_HEIGHT * font.size) / HALF;
    const highlighted = m.index === hl;
    if (!highlighted || valueOnHighlight) {
      const grown = growWindow(m.index, marks.length, times.growEnd).end;
      const tracks = highlighted ? arriveAt(ctx.look, times.highlightAt) : arriveAt(ctx.look, grown);
      values.push(label(ctx, { id: `${shot.id}.value.${m.index}`, text: valueText(m.value, decimals, shot.unit), font, x: Math.max(m.tip, m.base) + gap, y: mid, fill: highlighted ? style.strong : style.text, numeric: true, tracks }).node);
    }
    const piece = label(ctx, { id: `${shot.id}.label.${m.index}`, text: m.key, font, x: plot.x - gap, y: mid, align: 'right', fill: style.text, maxWidth: labelCol, lines: rowH >= HALF * ink ? CATEGORY_LINES : 1 });
    labels.push(piece.node);
  });
  return { nodes: [...nodes, ...values, ...labels], boxes, plot, highlight: hl >= 0 ? { index: hl, text: valueText(data.items[hl].value, decimals, shot.unit) } : null, times };
}

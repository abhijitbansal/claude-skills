// The chart kind's plot, drawn into an area by both compositions (chart-desk.mjs, chart-pop.mjs): the style read from
// the look, the timing of every mark, and columns and bars (lines and areas: chart-series.mjs; donuts: chart-donut.mjs).
// Marks are ink, the highlighted one gets an accent copy over it on the word that names it and the others dim; light
// reference lines (at most three) and a baseline rule are the only lines; labels sit on the marks (direct, never a
// legend). A bar, column or area scale that does not start at 0 draws a broken-axis mark and says its baseline. Pure,
// DOM-free.
import { node } from '../graph/node.mjs';
import { layoutText } from '../text/layout.mjs';
import { landing, isHand, colourOf, polyline, at2, roundedRect } from '../devices/shared.mjs';
import { CAP_HEIGHT, WORD_DESCENT, sizeAt, fontFor, setCase, unionBox, markerAccent, isWide } from './shared.mjs';
import { valueText } from './chart-scale.mjs';
import { chartData, valueScale, columnMarks, barMarks } from './chart-marks.mjs';
import { chartTimes } from './chart-time.mjs';
import { label, labelWidth, arriveAt } from './chart-labels.mjs';
import { secondarySize, secondaryFloor } from './secondary.mjs';
import { shownDecimals } from './values.mjs';

const MAX_STAGGER = 0.08; // seconds between one mark starting to grow and the next
const STAGGER_SHARE = 0.3; // of the growth, at most, taken by the staggers together
const LABEL_SHARE = 0.94; // of a column's band, the widest its label may be
const BAR_LABELS_MAX = 0.32; // of the area, the widest the bar labels' column may be
const CATEGORY_LINES = 2;
const FIT_EPSILON = 0.5;
const CLAMP_ROOM = 1.5; // widths between two thinned labels' centres: room for an end label moved in
const BREAK = Object.freeze({ size: 9, gap: 5 }); // units: the two strokes of a broken-axis mark
const HALF = 2;
const GLOW_ALPHA = 0.6; // the highlighted mark's light at its edge, before the blur spreads it (screened, so it only brightens)

/** The plot's style from look.kinds.chart (`data`) and the palette. */
export function chartStyle(ctx, data) {
  const { look, unit } = ctx;
  return {
    // labelScale on a wide frame: look review 2 found the desk's step-2 labels unreadable on the 16:9 phone tile
    // never under the look's secondary floor (kinds/secondary.mjs)
    font: fontFor(look, 'label', secondarySize(look, unit, (isWide(ctx.canvas) ? data.labelScale ?? 1 : 1) * sizeAt(look, data.labelStep, unit)), unit),
    gap: data.gap * unit, line: data.line * unit, refWidth: data.ref * unit, axisWidth: data.axis * unit, dim: data.dim, refs: data.refs,
    mark: colourOf(look, 'ink'), accent: markerAccent(look), text: colourOf(look, 'ink2'), strong: colourOf(look, 'ink'), rule: colourOf(look, 'rule'),
    step: isHand(look) ? look.moves.draw.step : undefined,
    // look data a chart may carry (cosmos): `marks`, palette keys the columns and bars take in turn (else ink); `round`,
    // the far ends' corner radius in units; `glow`, units of soft accent light round the highlighted column or bar
    marks: data.marks ? data.marks.map((key) => colourOf(look, key)) : null, round: data.round ? data.round * unit : 0, glow: data.glow ? data.glow * unit : 0,
    // `direct`: every mark carries its value, so no baseline rule is drawn (refs off drops the gridlines and ticks);
    // `fill`, the share of its band a column or bar takes
    // (`fillTall`, cosmos: a thinner bar on a tall frame, so a label over it has room above it to sit with its own bar)
    axis: data.direct !== true, fill: !isWide(ctx.canvas) && data.fillTall !== undefined ? data.fillTall : data.fill,
    // `dimTo`: a palette key the other marks turn to at the highlight (cosmos: the one lavender dim), not an alpha
    dimTo: data.dimTo ? colourOf(look, data.dimTo) : null,
    // `labelsAbove` 'tall' (cosmos): on a tall frame each bar's label sits over it, so the bars take the full width
    labelsAbove: data.labelsAbove === 'tall' && !isWide(ctx.canvas),
    // `hlFill`: a palette key the highlighted mark lights in (cosmos: ink, gold being only the light round it), else the
    // accent
    hlFill: data.hlFill ? colourOf(look, data.hlFill) : null,
    // `minPlot`: the least share of its box a donut (of the short side) or a line plot (of the width) keeps, however long
    // its labels; under it the labels are flagged as not fitting (the review's fit finding), never cut
    minPlot: data.minPlot ?? 0,
    // `startFinal` (ledger): columns and bars grow in their final colours, never ink before the dim grey
    startFinal: data.startFinal === true,
    growFrom: data.growFrom ?? 0,
    tight: data.tight === true,
    together: data.together === true,
  };
}

/** The decimals a set of values is shown with: the most any of them needs, at most three (from the number, not its string). */
export const valueDecimals = (values) => Math.max(0, ...values.filter(Number.isFinite).map((v) => shownDecimals(v)));

/** When mark k of n grows, all done by `growEnd`: { start, end, dur }. `together` (look data, poster): every mark grows
 *  over the same window, so no frame shows the bars out of the data's order (gate-poster-1 ruling 2). */
export function growWindow(k, n, growEnd, together = false) {
  const stagger = n > 1 && !together ? Math.min(MAX_STAGGER, (growEnd * STAGGER_SHARE) / (n - 1)) : 0;
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

// The same rectangle with its far end rounded (both far corners at `radius`, at most half the width or the length).
function roundPath(across, length, horizontal, radius) {
  const h = across / HALF, s = Math.sign(length) || -1, r = Math.min(radius, h, Math.abs(length));
  if (horizontal) {
    return `M${at2([0, -h])}L${at2([length - s * r, -h])}Q${at2([length, -h])} ${at2([length, -h + r])}L${at2([length, h - r])}Q${at2([length, h])} ${at2([length - s * r, h])}L${at2([0, h])}Z`;
  }
  return `M${at2([-h, 0])}L${at2([-h, length - s * r])}Q${at2([-h, length])} ${at2([-h + r, length])}L${at2([h - r, length])}Q${at2([h, length])} ${at2([h, length - s * r])}L${at2([h, 0])}Z`;
}

// The highlighted mark's light (style.glow, px of blur): its full-grown box with an accent canvas shadow (draw.mjs path
// glow, a smooth falloff), screened, arriving with it; the accent copy covers its fill.
function markGlow(id, look, style, { x, y, across, length, horizontal }, at) {
  const box = horizontal ? [x + Math.min(0, length), y - across / HALF, Math.abs(length), across] : [x - across / HALF, y + Math.min(0, length), across, Math.abs(length)];
  const d = roundedRect(...box, Math.min(style.round, across / HALF));
  return node('path', id, { d, fill: style.accent, blend: 'screen', glow: { color: style.accent, alpha: GLOW_ALPHA, radius: style.glow } }, { tracks: arriveAt(look, at) });
}

// One column or bar: the mark growing from the baseline (dimming at the highlight unless it is the highlighted one), in
// ink or the look's mark colours in turn, and, for the highlighted one, its accent copy (and its light) arriving then.
function markNodes(shot, ctx, style, { k, n, x, y, across, length, horizontal, times, hl }) {
  const { look } = ctx;
  const win = growWindow(k, n, times.growEnd, style.together);
  // `growFrom` (poster, gate-poster-1 ruling 2): a mark grows from this share of its length, so the shot opens on every
  // bar's base; 0 (from nothing) in every other look
  const grow = landing(win.end, { ease: look.moves.enter.ease, dur: win.dur }, style.growFrom, 1, style.step);
  const d = style.round > 0 ? roundPath(across, length, horizontal, style.round) : markPath(across, length, horizontal);
  const scale = horizontal ? { scaleX: grow } : { scaleY: grow };
  const dimmed = hl >= 0 && k !== hl;
  const dims = dimmed && !style.dimTo ? dimTracks(look, times.highlightAt, style.dim) : {};
  const lit = style.hlFill ?? style.accent;
  // `startFinal` (ledger, gate-ledger-2 ruling 5): with a highlight each mark grows in its final colour (the dim grey, or
  // the accent), its overlay growing with it, never ink first
  const final = style.startFinal && hl >= 0;
  const base = style.marks ? style.marks[k % style.marks.length] : style.mark;
  const fill = !final ? base : k === hl ? lit : style.dimTo ?? base;
  const overlay = (at) => (final ? { tracks: scale, step: style.step } : { tracks: arriveAt(look, at) });
  const out = [node('path', `${shot.id}.mark.${k}`, { d, fill, x, y }, { tracks: { ...scale, ...dims }, step: style.step })];
  if (k === hl && style.glow > 0) out.push(markGlow(`${shot.id}.mark.${k}.glow`, look, style, { x, y, across, length, horizontal }, times.highlightAt));
  if (dimmed && style.dimTo) out.push(node('path', `${shot.id}.mark.${k}.dim`, { d, fill: style.dimTo, x, y }, final ? overlay() : { tracks: arriveAt(look, times.highlightAt), step: style.step }));
  if (k === hl) out.push(node('path', `${shot.id}.mark.${k}.accent`, { d, fill: lit, x, y }, overlay(times.highlightAt)));
  return out;
}

// `tight` (poster, gate-poster-1 ruling 2: the bars fill the plot): with no reference lines drawn, the scale's top is
// the largest value rather than the nice tick over it, so the tallest mark reaches the plot's top. Only when every value
// is at or over the baseline; else the scale as it is.
function fitScale(scale, data, style) {
  if (!style.tight || style.refs) return scale;
  const values = (data.items ?? []).map((i) => i.value).filter(Number.isFinite);
  if (values.length === 0 || values.some((v) => v < scale.lo)) return scale;
  const hi = Math.max(...values);
  return hi > scale.lo ? { ...scale, hi } : scale;
}

/** Does the shot's scale break from 0: a bar, column or area chart (drawn from its baseline) with a baseline that is not 0. */
export const isBroken = (shot) => ['bar', 'column', 'area'].includes(shot.type) && (shot.baseline ?? 0) !== 0;

// The references a vertical value axis has room to label: every other one dropped (the top kept) until each tick label,
// the baseline's among them, is at least `pitch` px from the next (a short plot's labels sat on top of each other).
function roomyReferences(scale, yOf, pitch) {
  const crowded = (refs) => {
    const ys = [scale.baseline, ...refs].map(yOf).sort((a, b) => a - b);
    return ys.some((y, i) => i > 0 && y - ys[i - 1] < pitch);
  };
  let refs = scale.references;
  while (refs.length > 1 && crowded(refs)) refs = refs.filter((_, i) => (refs.length - 1 - i) % HALF === 0);
  return refs;
}

/**
 * The value scale's furniture along a vertical value axis (columns, lines, areas): reference lines across the plot with
 * their ticks in the left gutter, the baseline rule, and the broken-axis mark and its label when the scale breaks.
 */
export function valueAxis(shot, ctx, style, { plot, scale, yOf, gutterX, refs }) {
  const { font, gap } = style;
  const nodes = [];
  if (refs) {
    roomyReferences(scale, yOf, (CAP_HEIGHT + WORD_DESCENT) * font.size + gap).forEach((t, k) => {
      const y = yOf(t);
      nodes.push(rule(`${shot.id}.ref.${k + 1}`, [[plot.x, y], [plot.x + plot.w, y]], style.rule, style.refWidth));
      nodes.push(label(ctx, { id: `${shot.id}.tick.${k + 1}`, text: valueText(t, scale.decimals, shot.unit), font, x: gutterX, y: y + (CAP_HEIGHT * font.size) / HALF, align: 'right', fill: style.text, numeric: true }).node);
    });
  }
  const base = yOf(scale.baseline);
  if (style.axis) nodes.push(rule(`${shot.id}.axis`, [[plot.x, base], [plot.x + plot.w, base]], style.strong, style.axisWidth));
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

// A direct-labelled chart's label font (style.axis false, cosmos): its size set down in proportion until the widest
// category fits `width`, so every column keeps its label (thinning them dropped every other one at 9:16).
function directFont(ctx, font, keys, width) {
  const widest = Math.max(...keys.map((key) => labelWidth(ctx, font, key)));
  return widest <= width ? font : { ...font, size: Math.max(secondaryFloor(ctx.look, ctx.unit), (font.size * width) / widest) };
}

// The line pitch of the first layout that wraps (its second baseline less its first), or 0 when none does.
function linePitch(layouts) {
  const wrapped = layouts.find((l) => l.lines.length > 1);
  return wrapped ? wrapped.lines[1].y - wrapped.lines[0].y : 0;
}

/** Columns in `area`: { nodes, boxes, plot, highlight } (highlight: { index, text } of the highlighted value, or null). */
export function drawColumns(shot, ctx, style, area, { valueOnHighlight, headroom = 0 }) {
  const data = chartData(shot), scale = fitScale(valueScale(shot, data), data, style), times = chartTimes(shot, ctx.timing, ctx.look);
  const { gap } = style;
  const hl = highlightIndex(shot, data), decimals = valueDecimals(data.items.map((i) => i.value));
  const gutter = axisGutter(shot, ctx, style, scale, style.refs);
  const plotW = area.w - gutter, band = plotW / Math.max(1, data.items.length);
  const font = style.axis ? style.font : directFont(ctx, style.font, data.items.map((it) => it.key), band * LABEL_SHARE);
  const ink = (CAP_HEIGHT + WORD_DESCENT) * font.size;
  const catLayouts = data.items.map((it) => layoutText({ text: setCase(ctx.look, 'label', it.key), font, maxWidth: band * LABEL_SHARE, measure: ctx.measure }));
  // labels that cannot fit their band are thinned, not stacked on each other: every `stride`-th, flagged as not fitting
  const fits = catLayouts.every((l) => l.lines.length <= CATEGORY_LINES && l.width <= band * LABEL_SHARE + FIT_EPSILON);
  const widest = Math.max(...data.items.map((it) => labelWidth(ctx, font, it.key)));
  const stride = fits ? 1 : Math.ceil((CLAMP_ROOM * widest + gap) / band);
  const catLines = fits ? Math.min(CATEGORY_LINES, Math.max(1, ...catLayouts.map((l) => l.lines.length))) : 1;
  const catH = ink + (catLines - 1) * linePitch(catLayouts); // one line pitch per extra line
  const negative = data.items.some((it) => it.value < scale.baseline);
  const top = ink + gap + headroom, bottom = gap + catH + (negative ? ink + gap : 0);
  const plot = { x: area.x + gutter, y: area.y + top, w: plotW, h: Math.max(1, area.h - top - bottom) };
  const yOf = (v) => plot.y + plot.h - ((Math.min(scale.hi, Math.max(scale.lo, v)) - scale.lo) / (scale.hi - scale.lo)) * plot.h;
  const marks = columnMarks(data.items, plot, scale, style.fill);
  const nodes = [...valueAxis(shot, ctx, style, { plot, scale, yOf, gutterX: plot.x - gap, refs: style.refs })];
  const values = [], labels = [], boxes = {};
  marks.forEach((m) => {
    nodes.push(...markNodes(shot, ctx, style, { k: m.index, n: marks.length, x: m.x, y: m.base, across: m.width, length: m.tip - m.base, horizontal: false, times, hl }));
    const parts = [[m.x - m.width / HALF, Math.min(m.base, m.tip), m.width, Math.abs(m.tip - m.base)]]; // the mark and, below, its labels
    const up = m.tip <= m.base;
    const y = up ? m.tip - gap - WORD_DESCENT * font.size : m.tip + gap + CAP_HEIGHT * font.size;
    const highlighted = m.index === hl;
    if (!highlighted || valueOnHighlight) {
      const grown = growWindow(m.index, marks.length, times.growEnd, style.together).end;
      const tracks = highlighted ? arriveAt(ctx.look, times.highlightAt) : arriveAt(ctx.look, grown);
      const v = label(ctx, { id: `${shot.id}.value.${m.index}`, text: valueText(m.value, decimals, shot.unit), font, x: m.x, y, align: 'center', fill: highlighted ? style.strong : style.text, numeric: true, maxWidth: band, tracks });
      values.push(v.node);
      parts.push(v.box);
    }
    const catY = plot.y + plot.h + (negative ? ink + gap : 0) + gap + CAP_HEIGHT * font.size;
    if (fits) {
      const c = label(ctx, { id: `${shot.id}.label.${m.index}`, text: m.key, font, x: m.x, y: catY, align: 'center', fill: style.text, maxWidth: band * LABEL_SHARE, lines: CATEGORY_LINES });
      labels.push(c.node);
      parts.push(c.box);
    }
    else if (m.index % stride === 0) {
      const half = labelWidth(ctx, font, m.key) / HALF; // kept on the plot: the end labels move in, never off the frame
      const x = Math.min(Math.max(m.x, plot.x + half), plot.x + plot.w - half);
      labels.push(label(ctx, { id: `${shot.id}.label.${m.index}`, text: m.key, font, x, y: catY, align: 'center', fill: style.text, crowded: true }).node);
    }
    boxes[`mark:${m.index}`] = unionBox(parts); // a device around the mark goes around its labels, never through them
  });
  return { nodes: [...nodes, ...values, ...labels], boxes, plot, highlight: hl >= 0 ? { index: hl, text: valueText(data.items[hl].value, decimals, shot.unit) } : null, times };
}

// A bar with its label over it (style.labelsAbove): its band split into the label's row and, under it, the bar at
// `fill` of the rest; the band's spare room goes ABOVE_SHARE over the label and the rest between the label and its own
// bar, so a label reads with its bar, not with the one above it (gate review 3); labelY is the label's baseline.
const ABOVE_SHARE = 2 / 3; // of the room over the label and under it together (the label's own descent counts as under)
function liftBar(m, size, gap, fill) {
  const under = WORD_DESCENT * size + gap / HALF; // the label row's own room under its baseline
  const top = m.y - m.band / HALF, row = CAP_HEIGHT * size + under, room = m.band - row;
  const height = room * fill, spare = room - height;
  const above = Math.min(spare, ABOVE_SHARE * (spare + under));
  const labelTop = top + above;
  return { ...m, y: labelTop + row + (spare - above) + height / HALF, height, labelY: labelTop + CAP_HEIGHT * size };
}

/** Bars in `area`, labels in a left column (or over each bar), values at the bar ends: { nodes, boxes, plot, highlight }. */
export function drawBars(shot, ctx, style, area, { valueOnHighlight, headroom = 0 }) {
  const data = chartData(shot), scale = fitScale(valueScale(shot, data), data, style), times = chartTimes(shot, ctx.timing, ctx.look);
  const { font, gap } = style;
  const ink = (CAP_HEIGHT + WORD_DESCENT) * font.size;
  const hl = highlightIndex(shot, data), decimals = valueDecimals(data.items.map((i) => i.value));
  const above = style.labelsAbove;
  // with labels over the bars (and values on their row) the bars take the area's whole width
  const labelCol = above ? -gap : Math.min(area.w * BAR_LABELS_MAX, Math.max(...data.items.map((it) => labelWidth(ctx, font, it.key))));
  const valueCol = Math.max(...data.items.map((it) => labelWidth(ctx, font, valueText(it.value, decimals, shot.unit), true)));
  const rows = (style.refs ? 1 : 0) + (isBroken(shot) ? 1 : 0); // tick labels, then the baseline label on a row of its own
  const below = rows === 0 ? 0 : gap + rows * ink + (rows - 1) * (gap / HALF);
  const plot = { x: area.x + labelCol + gap, y: area.y + headroom, w: Math.max(1, area.w - labelCol - gap - (above ? 0 : valueCol + gap)), h: Math.max(1, area.h - below - headroom) };
  const xOf = (v) => plot.x + ((Math.min(scale.hi, Math.max(scale.lo, v)) - scale.lo) / (scale.hi - scale.lo)) * plot.w;
  const grown = barMarks(data.items, plot, scale, style.fill);
  const marks = above ? grown.map((m) => liftBar(m, font.size, gap, style.fill)) : grown;
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
  if (style.axis) nodes.push(rule(`${shot.id}.axis`, [[base, plot.y], [base, plot.y + plot.h]], style.strong, style.axisWidth));
  if (isBroken(shot)) {
    nodes.push(breakMark(`${shot.id}.break`, ctx, [base, plot.y + plot.h], style.axisWidth));
    const row = style.refs ? ink + gap / HALF : 0;
    nodes.push(label(ctx, { id: `${shot.id}.baseline`, text: baselineText(scale, shot.unit), font, x: base, y: tickY + row, align: 'left', fill: style.text }).node);
  }
  const rowH = marks[0]?.band ?? plot.h;
  marks.forEach((m) => {
    nodes.push(...markNodes(shot, ctx, style, { k: m.index, n: marks.length, x: m.base, y: m.y, across: m.height, length: m.tip - m.base, horizontal: true, times, hl }));
    const parts = [[Math.min(m.base, m.tip), m.y - m.height / HALF, Math.abs(m.tip - m.base), m.height]];
    const mid = m.y + (CAP_HEIGHT * font.size) / HALF;
    const highlighted = m.index === hl;
    if (!highlighted || valueOnHighlight) {
      const grown = growWindow(m.index, marks.length, times.growEnd, style.together).end;
      const tracks = highlighted ? arriveAt(ctx.look, times.highlightAt) : arriveAt(ctx.look, grown);
      const text = valueText(m.value, decimals, shot.unit);
      // with the label over the bar, the value on the label's row right after the label, one rule for every bar (gate
      // review 3: values at some bar ends and after other labels read as two rules)
      const at = above ? { x: plot.x + labelWidth(ctx, font, m.key) + gap * HALF, y: m.labelY } : { x: Math.max(m.tip, m.base) + gap, y: mid };
      const v = label(ctx, { id: `${shot.id}.value.${m.index}`, text, font, x: at.x, y: at.y, fill: highlighted ? style.strong : style.text, numeric: true, tracks });
      values.push(v.node);
      parts.push(v.box);
    }
    // over its bar, the highlighted bar's label is lit in ink with its value (it stands in that bar's light)
    const piece = above ? label(ctx, { id: `${shot.id}.label.${m.index}`, text: m.key, font, x: plot.x, y: m.labelY, fill: highlighted ? style.strong : style.text })
      : label(ctx, { id: `${shot.id}.label.${m.index}`, text: m.key, font, x: plot.x - gap, y: mid, align: 'right', fill: style.text, maxWidth: labelCol, lines: rowH >= HALF * ink ? CATEGORY_LINES : 1 });
    labels.push(piece.node);
    boxes[`mark:${m.index}`] = unionBox([...parts, piece.box]); // a device around the bar goes around its labels
  });
  return { nodes: [...nodes, ...values, ...labels], boxes, plot, highlight: hl >= 0 ? { index: hl, text: valueText(data.items[hl].value, decimals, shot.unit) } : null, times };
}

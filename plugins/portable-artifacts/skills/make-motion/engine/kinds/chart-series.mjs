// The chart kind's lines and areas (chart-draw.mjs draws columns and bars): each series drawn left to right over the
// first sentence, an area filled under its line as the line draws, the series named at its end (direct labels, spread so
// they never meet) with its last value, and the x labels that fit under the plot. Pure and DOM-free.
import { node } from '../graph/node.mjs';
import { landing, polyline } from '../devices/shared.mjs';
import { CAP_HEIGHT, WORD_DESCENT } from './shared.mjs';
import { valueText } from './chart-scale.mjs';
import { chartData, valueScale, lineMarks } from './chart-marks.mjs';
import { chartTimes } from './chart-time.mjs';
import { label, labelWidth, arriveAt, spread } from './chart-labels.mjs';
import { valueDecimals, dimTracks, highlightIndex, valueAxis, axisGutter } from './chart-draw.mjs';
import { tipReveal, tipTimes } from './chart-tip.mjs';

const AREA_INK = 0.22; // an area is its line's colour mixed this far into the paper
const AREA_ACCENT = 0.5; // the highlighted area is the accent mixed this far into the paper
const HEX_RADIX = 16;
const CHANNELS = [1, 3, 5];
const CHANNEL_DIGITS = 2;
const HIGHLIGHT_LINE = 1.4; // the highlighted line, of the line width
const HIGHLIGHT_EDGE = 2.2; // its ink edge under it
const HALF = 2;

/** `a` mixed `share` of the way from `b` (both #rrggbb): share 1 is a, 0 is b. */
export function mix(a, b, share) {
  const channel = (hex, i) => parseInt(hex.slice(i, i + CHANNEL_DIGITS), HEX_RADIX);
  return `#${CHANNELS.map((i) => Math.round(channel(a, i) * share + channel(b, i) * (1 - share)).toString(HEX_RADIX).padStart(CHANNEL_DIGITS, '0')).join('')}`;
}

// The look's chart data flags read here (ledger, gate-ledger-1 ruling 3): `pointLabels` (every point's value set over
// it as the line reaches it), `fillFollowsLine` (an area's fill edge on the line's tip), `rowDrop` (em).
const seriesFlags = (ctx) => ctx.look.kinds?.chart ?? {};
const rowDrop = (ctx, font) => (seriesFlags(ctx).rowDrop ?? 0) * font.size;

// Every point's value over it (seriesFlags pointLabels): set flush right to end a half gap left of the point, so it
// sits over the climb that reaches it, the first flush left a half gap right of it; each shown, as a step, when the
// line's tip reaches its point (chart-tip.mjs tipTimes).
function pointLabels(shot, ctx, style, { lines, times, decimals }) {
  if (seriesFlags(ctx).pointLabels !== true) return [];
  const { font, gap } = style;
  const draw = { ease: ctx.look.moves.draw.ease, dur: times.growEnd };
  const grown = landing(times.growEnd, draw, 0, 1, style.step);
  return lines.filter((l) => l.points.length > 0).flatMap((l) => {
    const at = tipTimes(l.points, grown, times.growEnd);
    const shown = l.values.filter(Number.isFinite);
    return l.points.map(([px, py], k) => {
      const first = k === 0;
      const text = valueText(shown[k], decimals, shot.unit);
      const x = first ? px + gap / HALF : px - gap / HALF - labelWidth(ctx, font, text, true);
      const tracks = { opacity: landing(at[k], { ease: 'linear', dur: 0 }, 0, 1) };
      const id = lines.length > 1 ? `${shot.id}.s${l.index}.point.${k}` : `${shot.id}.point.${k}`;
      return label(ctx, { id, text, font, x, y: py - gap, fill: style.text, numeric: true, tracks }).node;
    });
  });
}

// The x labels that fit under the plot without meeting: all of them, else the first, middle and last, else the first
// and last. The first sits flush left on the plot's left edge, the last flush right, the rest centred on their x; a set
// fits when every neighbour is at least a gap clear of the next.
function xLabels(shot, ctx, style, { xs, plot }) {
  const { font, gap } = style;
  const text = (x) => (typeof x === 'number' ? String(x) : x);
  const widths = xs.map((p) => labelWidth(ctx, font, text(p.x)));
  const last = xs.length - 1;
  const leftOf = (i) => (i === 0 ? plot.x : i === last ? plot.x + plot.w - widths[i] : xs[i].at - widths[i] / HALF);
  const clear = (set) => set.every((i, k) => k === 0 || leftOf(i) >= leftOf(set[k - 1]) + widths[set[k - 1]] + gap);
  const middle = Math.floor(last / HALF);
  const sets = [xs.map((_, i) => i), [...new Set([0, middle, last])], [...new Set([0, last])]];
  const pick = sets.find(clear) ?? [0];
  // a look may drop the row under the value axis's lowest tick (look.kinds.chart.rowDrop em, ledger: "0" and "Q1"
  // read as one string, gate-ledger-1 ruling 3)
  const y = plot.y + plot.h + gap + CAP_HEIGHT * font.size + rowDrop(ctx, font);
  return pick.map((i) => {
    const align = i === 0 ? 'left' : i === last ? 'right' : 'center';
    const x = i === 0 ? plot.x : i === last ? plot.x + plot.w : xs[i].at;
    return label(ctx, { id: `${shot.id}.x.${i}`, text: text(xs[i].x), font, x, y, align, fill: style.text }).node;
  });
}

// A series' line (drawn on, dimming unless highlighted) and, for the highlighted one, its accent copy; in an area, its
// fill under the line (revealed with it) first.
function seriesNodes(shot, ctx, style, { line, baseY, times, hl, area }) {
  const { look } = ctx;
  if (line.points.length === 0) return { fills: [], strokes: [] };
  const draw = { ease: look.moves.draw.ease, dur: times.growEnd };
  const grown = landing(times.growEnd, draw, 0, 1, style.step);
  const dims = hl >= 0 && line.index !== hl ? dimTracks(look, times.highlightAt, style.dim) : {};
  const id = `${shot.id}.mark.${line.index}`;
  const d = polyline(line.points);
  const stroke = { d, strokeWidth: style.line, lineCap: 'round', lineJoin: 'round' };
  const strokes = [node('path', id, { ...stroke, stroke: style.mark }, { tracks: { draw: grown, ...dims }, step: style.step })];
  if (line.index === hl) {
    // the accent over an ink edge: a light accent (desk's highlighter yellow) still reads as a line on the paper
    const arrive = arriveAt(look, times.highlightAt);
    strokes.push(node('path', `${id}.edge`, { ...stroke, strokeWidth: style.line * HIGHLIGHT_EDGE, stroke: style.strong }, { tracks: arrive }));
    strokes.push(node('path', `${id}.accent`, { ...stroke, strokeWidth: style.line * HIGHLIGHT_LINE, stroke: style.accent }, { tracks: arrive }));
  }
  if (!area) return { fills: [], strokes };
  const under = polyline([...line.points, [line.points.at(-1)[0], baseY], [line.points[0][0], baseY]], true);
  const paper = look.palette.paper;
  // the fill's edge on the line's tip (seriesFlags fillFollowsLine), else revealed on the line's own track
  const reveal = seriesFlags(ctx).fillFollowsLine === true ? tipReveal(line.points, grown, times.growEnd) : grown;
  const fills = [node('path', `${id}.fill`, { d: under, fill: mix(style.mark, paper, AREA_INK) }, { tracks: { reveal, ...dims }, step: style.step })];
  if (line.index === hl) fills.push(node('path', `${id}.fill.accent`, { d: under, fill: mix(style.accent, paper, AREA_ACCENT) }, { tracks: arriveAt(look, times.highlightAt) }));
  return { fills, strokes };
}

// Each series' end: its name and its last value, after its last point, spread down the right so none meets the next.
function endLabels(shot, ctx, style, { lines, plot, times, hl, decimals, squeezed }) {
  const { font, gap } = style;
  const ink = (CAP_HEIGHT + WORD_DESCENT) * font.size;
  const live = lines.filter((l) => l.points.length > 0);
  const { ys, fits } = spread(live.map((l) => ({ y: l.points.at(-1)[1], h: ink })), plot.y - ink / HALF, plot.y + plot.h + ink / HALF, gap / HALF);
  return live.flatMap((l, j) => {
    const x = l.points.at(-1)[0] + gap, y = ys[j] - ink / HALF + CAP_HEIGHT * font.size; // the block's centre to its baseline
    const out = [];
    let after = x;
    if (l.name !== null) {
      const name = label(ctx, { id: `${shot.id}.series.${l.index}`, text: l.name, font, x, y, fill: l.index === hl ? style.strong : style.text, crowded: !fits || squeezed });
      out.push(name.node);
      after = x + name.box[2] + gap;
    }
    const last = l.values.filter(Number.isFinite).at(-1);
    // with every point labelled (seriesFlags pointLabels) the last value is already over its point
    const labelled = seriesFlags(ctx).pointLabels === true;
    if (last !== undefined && !labelled && (l.index !== hl || style.valueOnHighlight)) {
      const tracks = l.index === hl ? arriveAt(ctx.look, times.highlightAt) : arriveAt(ctx.look, times.growEnd);
      out.push(label(ctx, { id: `${shot.id}.value.${l.index}`, text: valueText(last, decimals, shot.unit), font, x: after, y, fill: l.index === hl ? style.strong : style.text, numeric: true, tracks }).node);
    }
    return out;
  });
}

/** Lines (or areas, `area`) in `area`: { nodes, boxes, plot, highlight }. */
export function drawSeries(shot, ctx, style, box, { valueOnHighlight, area, headroom = 0 }) {
  const data = chartData(shot), scale = valueScale(shot, data), times = chartTimes(shot, ctx.timing, ctx.look);
  const { font, gap } = style;
  const ink = (CAP_HEIGHT + WORD_DESCENT) * font.size;
  const hl = highlightIndex(shot, data), decimals = valueDecimals(data.series.flatMap((s) => s.points.map((p) => p.y)));
  const ends = data.series.map((s) => {
    const last = s.points.map((p) => p.y).filter(Number.isFinite).at(-1);
    return (s.name === null ? 0 : labelWidth(ctx, font, s.name) + gap) + (last === undefined ? 0 : labelWidth(ctx, font, valueText(last, decimals, shot.unit), true));
  });
  const gutter = axisGutter(shot, ctx, style, scale, style.refs);
  const right = Math.max(0, ...ends) + gap;
  // never narrower than the look's minimum (style.minPlot of the box): end labels too long for it say so instead
  const floor = style.minPlot * box.w;
  const squeezed = box.w - gutter - right < floor;
  const plot = { x: box.x + gutter, y: box.y + ink / HALF + headroom, w: Math.max(1, floor, box.w - gutter - right), h: Math.max(1, box.h - ink / HALF - gap - ink - headroom - rowDrop(ctx, font)) };
  const { lines, xs, baseY } = lineMarks(data.series, plot, scale);
  const yOf = (v) => plot.y + plot.h - ((Math.min(scale.hi, Math.max(scale.lo, v)) - scale.lo) / (scale.hi - scale.lo)) * plot.h;
  const parts = lines.map((line) => seriesNodes(shot, ctx, style, { line, baseY, times, hl, area }));
  const boxes = Object.fromEntries(lines.filter((l) => l.points.length > 0).map((l) => {
    const xsOf = l.points.map((p) => p[0]), ysOf = l.points.map((p) => p[1]);
    return [`mark:${l.index}`, [Math.min(...xsOf), Math.min(...ysOf), Math.max(...xsOf) - Math.min(...xsOf), Math.max(...ysOf) - Math.min(...ysOf)]];
  }));
  const last = hl >= 0 ? data.series[hl].points.map((p) => p.y).filter(Number.isFinite).at(-1) : undefined;
  return {
    nodes: [
      ...valueAxis(shot, ctx, style, { plot, scale, yOf, gutterX: plot.x - gap, refs: style.refs }),
      ...parts.flatMap((p) => p.fills), ...parts.flatMap((p) => p.strokes),
      ...xLabels(shot, ctx, style, { xs, plot }),
      ...pointLabels(shot, ctx, style, { lines, times, decimals }),
      ...endLabels(shot, ctx, { ...style, valueOnHighlight }, { lines, plot, times, hl, decimals, squeezed }),
    ],
    boxes, plot, times,
    highlight: last === undefined ? null : { index: hl, text: valueText(last, decimals, shot.unit) },
  };
}

// The chart kind in a stack composition (pop): the claim as a kicker tag at the top of the stack area, the highlighted
// value under it as a numeral in the display face that punches in (an object entrance) on the word that names it, and
// big marks filling the area's width under that, labelled directly; no reference lines (look.kinds.chart.refs). The
// source line, when given, small at the bottom. The plot keeps clear of the caption band. Pure and DOM-free.
import { node } from '../graph/node.mjs';
import { entrance } from '../devices/shared.mjs';
import { CAP_HEIGHT, WORD_DESCENT, fontFor, plainTag } from './shared.mjs';
import { stackArea } from './stack.mjs';
import { numeralLayout, valueText } from './chart-scale.mjs';
import { chartStyle, valueDecimals } from './chart-draw.mjs';
import { drawPlot, captionTop } from './chart-plot.mjs';
import { label } from './chart-labels.mjs';
import { chartTimes } from './chart-time.mjs';
import { chartData } from './chart-marks.mjs';
import { MIN_HERO_RATIO } from '../review/frame.mjs';

const HALF = 2;

// The highlighted value's text, or null (the same text the plot would have labelled it with).
function highlightedText(shot) {
  if (shot.highlight === undefined) return null;
  const data = chartData(shot);
  if (data.items) {
    const item = data.items.find((i) => i.key === shot.highlight);
    return item === undefined ? null : valueText(item.value, valueDecimals(data.items.map((i) => i.value)), shot.unit);
  }
  const series = data.series.find((s) => s.name === shot.highlight);
  const last = series?.points.map((p) => p.y).filter(Number.isFinite).at(-1);
  return last === undefined ? null : valueText(last, valueDecimals(data.series.flatMap((s) => s.points.map((p) => p.y))), shot.unit);
}

// The numeral: as large as data.numeralMax, the area's width and data.numeralShare of its height allow (never under
// three times the labels), flush left, its cap line at `top`; it pops in at the highlight. { nodes, bottom } or none.
function numeralNodes(shot, ctx, data, { area, top, labelSize, at }) {
  const text = highlightedText(shot);
  if (text === null) return { nodes: [], bottom: top };
  const { look, unit, measure } = ctx;
  const at1 = fontFor(look, 'display', 1, unit);
  const perUnit = numeralLayout(text, { ...at1, size: 1 }, measure).width;
  const size = Math.max(MIN_HERO_RATIO * labelSize, Math.min(data.numeralMax * unit, area.w / perUnit, (data.numeralShare * area.h) / (CAP_HEIGHT + WORD_DESCENT)));
  const font = fontFor(look, 'display', size, unit);
  const layout = numeralLayout(text, font, measure);
  const baseline = top + CAP_HEIGHT * size;
  const cx = area.left + layout.width / HALF, cy = baseline - (CAP_HEIGHT * size) / HALF;
  const textNode = node('text', `${shot.id}.numeral`, { x: area.left - cx, y: baseline - layout.lines[0].y - cy, layout, font, fill: look.palette.accent, role: 'hero' });
  return { nodes: [entrance({ id: `${shot.id}.numeral.punch`, at: at + look.moves.enter.dur, look, unit, cx, cy, children: [textNode] })], bottom: baseline + WORD_DESCENT * size };
}

/** The pop chart: { nodes, boxes } with the chart group carrying the hero id. */
export function expandPopChart(shot, ctx, data, hero) {
  const { look, unit } = ctx;
  const style = chartStyle(ctx, data);
  const { font, gap } = style;
  const area = stackArea(ctx);
  const bottom = Math.min(area.top + area.h, captionTop(ctx) - gap);
  const tagStyle = look.devices.tag ?? {};
  const tag = plainTag(ctx, `${shot.id}.title`, shot.title, {
    left: area.left, top: area.top, maxWidth: area.w, at: 0, fromStep: Math.min(...data.tagSteps), toStep: Math.max(...data.tagSteps), fill: tagStyle.fill ?? 'ink', text: tagStyle.text ?? 'paper', snap: true,
  });
  const times = chartTimes(shot, ctx.timing);
  const numeral = numeralNodes(shot, ctx, data, { area: { ...area, h: bottom - area.top }, top: tag.box[1] + tag.box[3] + data.tagGap * unit, labelSize: font.size, at: times.highlightAt ?? 0 });
  const source = shot.source === undefined ? null
    : label(ctx, { id: `${shot.id}.source`, text: shot.source, font, x: area.left, y: bottom - WORD_DESCENT * font.size - gap / HALF, fill: style.text }); // clear of the safe edge, commas included
  const floor = (source === null ? bottom : source.box[1] - gap) - gap;
  const plotArea = { x: area.left, y: numeral.bottom + data.numeralGap * unit, w: area.w, h: 0 };
  const box = { ...plotArea, h: Math.max(1, floor - plotArea.y) };
  const plot = drawPlot(shot, ctx, style, box, { valueOnHighlight: false });
  return {
    nodes: [...tag.nodes, ...numeral.nodes, node('group', hero, {}, { children: plot.nodes }), ...(source === null ? [] : [source.node])],
    boxes: { chart: [box.x, box.y, box.w, box.h], title: tag.box, ...plot.boxes },
  };
}

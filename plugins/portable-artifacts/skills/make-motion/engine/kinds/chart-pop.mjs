// The chart kind in a stack composition (pop): the claim as a kicker tag at the top of the stack area, the highlighted
// value under it as a numeral in the display face that punches in (an object entrance) on the word that names it, and
// big marks filling the area's width under that, labelled directly; no reference lines (look.kinds.chart.refs). The
// source line, when given, small at the bottom. The plot keeps clear of the caption band. Pure and DOM-free.
import { node } from '../graph/node.mjs';
import { landing } from '../devices/shared.mjs';
import { track } from '../time/track.mjs';
import { CAP_HEIGHT, WORD_DESCENT, fontFor } from './shared.mjs';
import { plainTag } from './plain-tag.mjs';
import { stackArea } from './stack.mjs';
import { numeralLayout, valueText } from './chart-scale.mjs';
import { chartStyle, valueDecimals } from './chart-draw.mjs';
import { drawPlot, captionTop } from './chart-plot.mjs';
import { label } from './chart-labels.mjs';
import { chartTimes } from './chart-time.mjs';
import { chartData } from './chart-marks.mjs';
import { MIN_HERO_RATIO } from '../review/frame.mjs';
import { HERO_MARGIN } from './secondary.mjs';

const HALF = 2;
const DEFAULT_PUNCH = Object.freeze({ scale: 1.08, dur: 0.12 }); // for a look whose devices name no punch

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

// The numeral's size: as large as data.numeralMax, `width` and data.numeralShare of `height` allow, never under three
// times the labels. null without a highlight.
function numeralSet(shot, ctx, data, { width, height, labelSize }) {
  const text = highlightedText(shot);
  if (text === null) return null;
  const { look, unit, measure } = ctx;
  const perUnit = numeralLayout(text, { ...fontFor(look, 'display', 1, unit), size: 1 }, measure).width;
  const room = Math.min(data.numeralMax * unit, width / perUnit, (data.numeralShare * height) / (CAP_HEIGHT + WORD_DESCENT));
  const floor = Math.ceil(MIN_HERO_RATIO * labelSize);
  const size = Math.max(floor, room);
  const font = fontFor(look, 'display', size, unit);
  const layout = numeralLayout(text, font, measure);
  // held at its floor wider than its room (a donut's hole, the plot's share): it says so, the review's fit finding
  return { font, layout: floor > room && layout.width > width ? { ...layout, overflow: true } : layout, height: (CAP_HEIGHT + WORD_DESCENT) * size };
}

// The numeral placed with its ink box's centre at (cx, cy), punching in at the highlight: it appears a little over its
// size (look.devices.punch) and settles, so it is never under its size while it shows (the review's hero rule).
function numeralNode(shot, ctx, set, { cx, cy, at }) {
  const { look } = ctx;
  const size = set.font.size;
  const baseline = cy + (CAP_HEIGHT * size) / HALF;
  const textNode = node('text', `${shot.id}.numeral`, { x: -set.layout.width / HALF, y: baseline - set.layout.lines[0].y - cy, layout: set.layout, font: set.font, fill: look.palette.accent, role: 'hero' });
  const punch = look.devices.punch ?? DEFAULT_PUNCH;
  const tracks = {
    opacity: landing(at + punch.dur, { ease: look.moves.emphasize.ease, dur: punch.dur }, 0, 1),
    scale: track([{ t: at, v: punch.scale }, { t: at + punch.dur, v: 1, ease: look.moves.emphasize.ease }]),
  };
  return node('group', `${shot.id}.numeral.punch`, { x: cx, y: cy }, { tracks, children: [textNode] });
}

/**
 * The pop chart: { nodes, boxes } with the chart group carrying the hero id. The plot starts right under the claim tag
 * and runs to the bottom of the stack area; the highlighted numeral sits inside it, top right with the marks kept under
 * it (headroom), or in a donut's hole, so it never pushes the plot down.
 */
export function expandPopChart(shot, ctx, data, hero) {
  const { look, unit } = ctx;
  const style = chartStyle(ctx, data);
  const { font, gap } = style;
  const area = stackArea(ctx);
  const bottom = Math.min(area.top + area.h, captionTop(ctx) - gap);
  const tagStyle = look.devices.tag ?? {};
  // the claim is read as part of the hierarchy, so the hero rule judges it (role 'claim', review B I10); until the
  // highlighted numeral punches in (and with no highlight, always) it is the frame's largest text: at least three times
  // the labels
  const minSize = Math.ceil(HERO_MARGIN * MIN_HERO_RATIO * font.size);
  const tag = plainTag(ctx, `${shot.id}.title`, shot.title, {
    left: area.left, top: area.top, maxWidth: area.w, at: 0, fromStep: Math.min(...data.tagSteps), toStep: Math.max(...data.tagSteps), fill: tagStyle.fill ?? 'ink', text: tagStyle.text ?? 'paper', snap: true, role: 'claim', minSize,
  });
  const at = chartTimes(shot, ctx.timing).highlightAt ?? 0;
  const source = shot.source === undefined ? null
    // clear of the safe edge, commas included; wider than the stack area it says so (the review's fit finding)
    : label(ctx, { id: `${shot.id}.source`, text: shot.source, font, x: area.left, y: bottom - WORD_DESCENT * font.size - gap / HALF, fill: style.text, maxWidth: area.w });
  const floor = (source === null ? bottom : source.box[1] - gap) - gap;
  const top = tag.box[1] + tag.box[3] + data.tagGap * unit;
  const box = { x: area.left, y: top, w: area.w, h: Math.max(1, floor - top) };
  const donut = shot.type === 'donut';
  const set = numeralSet(shot, ctx, data, { width: donut ? Infinity : area.w * data.numeralWidth, height: box.h, labelSize: font.size });
  const headroom = set === null || donut ? 0 : set.height + data.numeralGap * unit;
  const plot = drawPlot(shot, ctx, style, box, { valueOnHighlight: false, headroom });
  let numeral = [];
  if (set !== null && donut) {
    // in the hole: scaled down to fit it when the numeral at its size would not
    const hole = plot.plot.w * data.holeShare;
    const fitted = set.layout.width > hole ? numeralSet(shot, ctx, data, { width: hole, height: box.h, labelSize: font.size }) : set;
    numeral = [numeralNode(shot, ctx, fitted, { cx: plot.plot.x + plot.plot.w / HALF, cy: plot.plot.y + plot.plot.h / HALF, at })];
  } else if (set !== null) {
    numeral = [numeralNode(shot, ctx, set, { cx: box.x + box.w - set.layout.width / HALF, cy: box.y + set.height / HALF, at })];
  }
  return {
    nodes: [...tag.nodes, node('group', hero, {}, { children: plot.nodes }), ...numeral, ...(source === null ? [] : [source.node])],
    boxes: { chart: [box.x, box.y, box.w, box.h], title: tag.box, ...plot.boxes },
  };
}

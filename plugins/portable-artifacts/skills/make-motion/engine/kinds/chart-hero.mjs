// The chart as a poster (look.kinds.chart.heroTop, poster: gate-poster-1 ruling 2): the highlighted value is the hero,
// set first and large in the display face, the claim under it in the display face's capitals at no more than a third of
// the hero's size, and the plot taking all the height left: beside the two on a wide frame, under them on a tall one.
// No plate and no entrance: the shot opens set (the hero, the claim, the baseline and every bar's base on frame 0) and
// only the marks grow. Pure and DOM-free.
import { node } from '../graph/node.mjs';
import { layoutText } from '../text/layout.mjs';
import { colourOf } from '../devices/shared.mjs';
import { CAP_HEIGHT, WORD_DESCENT, fontFor, setCase, sizeAt, isWide } from './shared.mjs';
import { stackArea } from './stack.mjs';
import { numeralLayout } from './chart-scale.mjs';
import { chartStyle } from './chart-draw.mjs';
import { drawPlot, captionTop } from './chart-plot.mjs';
import { label } from './chart-labels.mjs';

const HERO_RATIO = 3; // the hero at least this many times the claim (the review's hero rule)
const TITLE_LINES = 3; // the claim wraps to at most this many lines, else it says it does not fit
const INK = CAP_HEIGHT + WORD_DESCENT; // a line's ink height, in ems

// The hero numeral: as large as numeralMax, the column's width and numeralShare of the height allow, never under three
// times the labels; its top left at (left, top). -> { node, bottom } or null without a highlighted value.
function heroNumeral(shot, ctx, data, text, { left, top, width, height, labelSize }) {
  if (text === null) return null;
  const { look, unit, measure } = ctx;
  const perUnit = numeralLayout(text, { ...fontFor(look, 'display', 1, unit), size: 1 }, measure).width;
  const size = Math.max(Math.ceil(HERO_RATIO * labelSize), Math.min(data.numeralMax * unit, width / perUnit, (data.numeralShare * height) / INK));
  const font = fontFor(look, 'display', size, unit);
  const layout = numeralLayout(text, font, measure);
  // the layout box's top on `top` (a viral frame's safe edge holds the box, not the cap line), and its bottom (the comma's
  // descent included) the bottom, so nothing set under it meets it
  const props = { x: left, y: top, layout: layout.width > width ? { ...layout, overflow: true } : layout, font, fill: colourOf(look, 'accent'), role: 'hero' };
  return { node: node('text', `${shot.id}.numeral`, props), bottom: top + Math.max(INK * size, layout.height), size };
}

// The claim in the display face's capitals at the labels' size: a frame holds two type sizes, the hero's and this one
// (the look's two-size rule, poster-kinds), so the hero is many times the claim. Without a hero it takes the title step.
function claim(shot, ctx, data, { left, top, width, heroSize, labelSize }) {
  const { look, unit, measure } = ctx;
  const size = heroSize === null ? Math.max(labelSize, sizeAt(look, data.titleStep, unit)) : labelSize;
  const font = fontFor(look, 'display', size, unit);
  const laid = layoutText({ text: setCase(look, 'display', shot.title), font, maxWidth: width, measure });
  const layout = laid.lines.length > TITLE_LINES ? { ...laid, overflow: true } : laid;
  const props = { x: left, y: top + CAP_HEIGHT * size - layout.lines[0].y, layout, font, fill: colourOf(look, 'ink'), role: 'claim' };
  const h = layout.lines.at(-1).y - layout.lines[0].y + INK * size;
  return { node: node('group', `${shot.id}.title`, {}, { children: [node('text', `${shot.id}.title.text`, props)] }), box: [left, top, layout.width, h] };
}

// The source line at the foot of its column, wrapping to data.sourceLines lines: its last line's descent on `bottom`.
function footSource(shot, ctx, style, data, { left, width, bottom }) {
  if (shot.source === undefined) return null;
  const opts = { id: `${shot.id}.source`, text: shot.source, font: style.font, x: left, fill: style.text, maxWidth: width, lines: data.sourceLines ?? 1 };
  // its layout box's foot on `bottom` (a viral frame's safe edge holds the box, not the descent)
  const { layout } = label(ctx, { ...opts, y: 0 }).node.props;
  return label(ctx, { ...opts, y: bottom - layout.height + layout.lines[0].y });
}

/** The poster chart: { nodes, boxes } with the plot's group carrying the hero id. `heroValue`: the highlighted value's
 *  text, or null. */
export function expandHeroChart(shot, ctx, data, hero, heroValue) {
  const { unit } = ctx;
  const style = chartStyle(ctx, data);
  const area = stackArea(ctx);
  const bottom = Math.min(area.top + area.h, captionTop(ctx) - style.gap);
  const wide = isWide(ctx.canvas);
  const column = wide ? area.w * data.heroColumn : area.w;
  const labelSize = style.font.size;
  const share = wide ? data.numeralShare : data.numeralShareTall ?? data.numeralShare;
  const numeral = heroNumeral(shot, ctx, { ...data, numeralShare: share }, heroValue, { left: area.left, top: area.top, width: column, height: bottom - area.top, labelSize });
  const titleTop = numeral === null ? area.top : numeral.bottom + data.numeralGap * unit;
  const title = claim(shot, ctx, data, { left: area.left, top: titleTop, width: column, heroSize: numeral?.size ?? null, labelSize });
  const source = footSource(shot, ctx, style, data, { left: area.left, width: column, bottom });
  const box = wide
    ? { x: area.left + column + data.heroGap * unit, y: area.top, w: area.w - column - data.heroGap * unit, h: bottom - area.top }
    : (() => {
      const y = title.box[1] + title.box[3] + data.tagGap * unit;
      const floor = source === null ? bottom : source.box[1] - style.gap;
      return { x: area.left, y, w: area.w, h: Math.max(1, floor - y) };
    })();
  // data.heroLabel (poster, gate-poster-2 ruling 6): the highlighted bar carries its own value label too
  const plot = drawPlot(shot, ctx, style, box, { valueOnHighlight: data.heroLabel === true, headroom: 0 });
  return {
    nodes: [...(numeral === null ? [] : [numeral.node]), title.node, node('group', hero, {}, { children: plot.nodes }), ...(source === null ? [] : [source.node])],
    boxes: { chart: [box.x, box.y, box.w, box.h], title: title.box, ...plot.boxes },
  };
}

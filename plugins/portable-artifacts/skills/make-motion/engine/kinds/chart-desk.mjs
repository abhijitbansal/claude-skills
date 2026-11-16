// The chart kind in an editorial composition (desk): the claim as a serif heading top left on column 2, fitted between
// three times the labels and look.kinds.chart.titleMax in at most `titleLines` lines and there from the first frame;
// the chart directly on the paper under it, across columns 2 to 12 (1 to 12 on tall frames), ink marks and one accent,
// labels in the label face; the source line bottom left in the label face's small caps, beside the caption band on a
// wide frame and over it on a tall one. Pure and DOM-free.
import { node } from '../graph/node.mjs';
import { gridX, gridSpan } from '../looks/index.mjs';
import { CAP_HEIGHT, WORD_DESCENT, sizeAt, fontFor, isWide, setCase, fitDisplay, capBox } from './shared.mjs';
import { MIN_HERO_RATIO } from '../review/frame.mjs';
import { chartStyle } from './chart-draw.mjs';
import { drawPlot, captionTop } from './chart-plot.mjs';
import { label } from './chart-labels.mjs';
import { SLUG } from './slug.mjs';

const FIRST_COLUMN = 2;
const RIGHT_EDGE = 13; // gridX's column for the right edge of column 12
const SOURCE_PREFIX = 'Source: ';
const SOURCE_GAP = 3; // gaps between the plot's lowest label and the source line

// The claim: fitted, flush left on column 2, its cap line where a statement's slug sits (SLUG.top of the height).
function titleNode(shot, ctx, data, labelSize) {
  const { look, canvas, unit, measure } = ctx;
  const span = gridSpan(look, canvas, FIRST_COLUMN, isWide(canvas) ? data.titleToWide : data.titleToTall);
  const opts = { text: setCase(look, 'display', shot.title), font: fontFor(look, 'display', data.titleMax * unit, unit), maxWidth: span.w, align: 'left', measure };
  const fit = fitDisplay(opts, { min: MIN_HERO_RATIO * labelSize, max: data.titleMax * unit, maxHeight: canvas.h, maxLines: data.titleLines }, look, unit);
  const top = Math.max(look.grid.margin * unit, SLUG.top * canvas.h); // where a statement's slug sits
  const y = top + CAP_HEIGHT * fit.font.size - fit.layout.lines[0].y;
  const bottom = y + fit.layout.lines.at(-1).y + WORD_DESCENT * fit.font.size;
  const textNode = node('text', `${shot.id}.title`, { x: span.x, y, layout: fit.layout, font: fit.font, fill: look.palette.ink, role: 'hero' });
  return { node: textNode, bottom, box: capBox(span.x, y + fit.layout.lines[0].y, fit.layout.width, fit.font.size) };
}

/** The desk chart: { nodes, boxes } with the chart group carrying the hero id. */
export function expandDeskChart(shot, ctx, data, hero) {
  const { look, canvas, unit } = ctx;
  const style = chartStyle(ctx, data);
  const { font, gap } = style;
  const title = titleNode(shot, ctx, data, font.size); // three times the labels as set (labelScale)
  const margin = look.grid.margin * unit;
  const caption = captionTop(ctx);
  const wide = isWide(canvas);
  const left = gridX(look, canvas, wide ? FIRST_COLUMN : 1);
  const sourceBaseline = Math.min(canvas.h - margin, caption - gap) - WORD_DESCENT * font.size; // over a caption band
  // the source line: smaller than the labels, in ink2, as written after "Source: ", a clear gap under the plot (look
  // review 2: in the labels' style right under them it read as a second row of categories)
  const sourceFont = fontFor(look, 'label', sizeAt(look, data.sourceStep, unit), unit);
  const source = shot.source === undefined ? null
    : label(ctx, { id: `${shot.id}.source`, text: `${SOURCE_PREFIX}${shot.source}`, font: sourceFont, x: gridX(look, canvas, FIRST_COLUMN), y: sourceBaseline, fill: style.text, asWritten: true });
  const floor = Math.min(source === null ? canvas.h - margin : source.box[1] - SOURCE_GAP * gap, caption) - gap;
  // equal outer margins: the plot's right edge as far in from the right as its left edge is from the left
  const right = wide ? canvas.w - left : gridX(look, canvas, RIGHT_EDGE);
  const area = { x: left, y: title.bottom + data.titleGap * unit, w: right - left, h: 0 };
  const plotArea = { ...area, h: Math.max(1, floor - area.y) };
  const plot = drawPlot(shot, ctx, style, plotArea, { valueOnHighlight: true });
  const group = node('group', hero, {}, { children: plot.nodes });
  return {
    nodes: [title.node, group, ...(source === null ? [] : [source.node])],
    boxes: { chart: [plotArea.x, plotArea.y, plotArea.w, plotArea.h], title: title.box, ...plot.boxes },
  };
}

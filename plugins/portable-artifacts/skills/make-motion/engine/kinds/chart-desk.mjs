// The chart kind in an editorial composition (desk): the claim as a serif heading top left on column 2, fitted between
// three times the labels and look.kinds.chart.titleMax in at most `titleLines` lines and there from the first frame;
// the chart directly on the paper under it, across columns 2 to 12 (1 to 12 on tall frames), ink marks and one accent,
// labels in the label face; the source line bottom left in the label face's small caps, beside the caption band on a
// wide frame and over it on a tall one. Pure and DOM-free.
import { node } from '../graph/node.mjs';
import { gridX } from '../looks/index.mjs';
import { editorialSpan, editorialBounds, editorialRight } from './editorial.mjs';
import { CAP_HEIGHT, WORD_DESCENT, sizeAt, fontFor, isWide, setCase, fitDisplay, capBox, runInk, inkExtent } from './shared.mjs';
import { MIN_HERO_RATIO } from '../review/frame.mjs';
import { layoutText } from '../text/layout.mjs';
import { secondarySize, secondaryFloor } from './secondary.mjs';
import { chartStyle } from './chart-draw.mjs';
import { chartData } from './chart-marks.mjs';
import { drawPlot, captionTop } from './chart-plot.mjs';
import { label, labelWidth } from './chart-labels.mjs';
import { SLUG } from './slug.mjs';

const FIRST_COLUMN = 2;
const RIGHT_EDGE = 13; // gridX's column for the right edge of column 12
const SOURCE_PREFIX = 'Source: ';
const HERO_MARGIN = 1.03; // the claim a hair over three times the labels, so rounding never takes it under
const SOURCE_GAP = 3;
const BARRED = Object.freeze(['bar', 'column']); // the types drawn as labelled bars on a tall cosmos frame (chart-plot.mjs) // gaps between the plot's lowest label and the source line

// The claim: fitted, flush left on column 2, its cap line where a statement's slug sits (SLUG.top of the height).
function titleNode(shot, ctx, data, labelSize) {
  const { look, canvas, unit, measure } = ctx;
  const span = editorialSpan(ctx, FIRST_COLUMN, isWide(canvas) ? data.titleToWide : data.titleToTall);
  const opts = { text: setCase(look, 'display', shot.title), font: fontFor(look, 'display', data.titleMax * unit, unit), maxWidth: span.w, align: 'left', measure };
  const fit = fitDisplay(opts, { min: HERO_MARGIN * MIN_HERO_RATIO * labelSize, max: data.titleMax * unit, maxHeight: canvas.h, maxLines: data.titleLines }, look, unit);
  const bounds = editorialBounds(ctx);
  // where a statement's slug sits, or the top of the composition band in the platform safe zone (editorial.mjs)
  const top = bounds.safe ? bounds.top : Math.max(look.grid.margin * unit, SLUG.top * canvas.h);
  // in the safe zone, the first line's ink (its ascenders) starts at the band's top: the zone is the review's own edge
  const up = bounds.safe ? runInk(fit.layout.lines[0], fit.font, measure).up : CAP_HEIGHT * fit.font.size;
  const y = top + up - fit.layout.lines[0].y;
  const bottom = y + fit.layout.lines.at(-1).y + WORD_DESCENT * fit.font.size;
  const textNode = node('text', `${shot.id}.title`, { x: span.x, y, layout: fit.layout, font: fit.font, fill: look.palette.ink, role: 'hero' });
  return { node: textNode, bottom, box: capBox(span.x, y + fit.layout.lines[0].y, fit.layout.width, fit.font.size) };
}

// The source line's font: the label face at data.sourceStep (never under the look's secondary floor), set smaller in
// proportion when the line is wider than `width` (the 9:16 safe zone's width), down to that floor; a line still too
// wide there wraps (`wrap`: its lines' extra height, which the line is raised by).
function sourceFontFor(ctx, data, text, width) {
  const { look, unit, measure } = ctx;
  const font = fontFor(look, 'label', secondarySize(look, unit, sizeAt(look, data.sourceStep, unit)), unit);
  const wide = text === '' ? 0 : labelWidth(ctx, font, text);
  if (wide <= width) return { font, wrap: 0 };
  const scaled = fontFor(look, 'label', Math.max(secondaryFloor(look, unit), (font.size * width) / wide), unit);
  if (labelWidth(ctx, scaled, text) <= width) return { font: scaled, wrap: 0 };
  const lines = layoutText({ text, font: scaled, maxWidth: width, measure }).lines;
  return { font: scaled, wrap: lines.at(-1).y - lines[0].y, maxWidth: width };
}

// A text node carrying the lines its kind left out (props.dropped: the review's 'dropped' rule).
const withDropped = (n, what) => node(n.type, n.id, { ...n.props, dropped: what }, { tracks: n.tracks, wordTracks: n.wordTracks });

/** The desk chart: { nodes, boxes } with the chart group carrying the hero id. */
export function expandDeskChart(shot, ctx, data, hero) {
  const { look, canvas, unit } = ctx;
  const style = chartStyle(ctx, data);
  const { font, gap } = style;
  const title = titleNode(shot, ctx, data, font.size); // three times the labels as set (labelScale)
  const caption = captionTop(ctx);
  const wide = isWide(canvas);
  const bounds = editorialBounds(ctx);
  const left = bounds.safe ? editorialSpan(ctx, 1, 1).x : gridX(look, canvas, wide ? FIRST_COLUMN : 1);
  // the source line: smaller than the labels, in ink2, as written after "Source: ", a clear gap under the plot (look
  // review 2: in the labels' style right under them it read as a second row of categories)
  const sourceText = shot.source === undefined ? '' : `${SOURCE_PREFIX}${shot.source}`;
  // equal outer margins: the plot's right edge as far in from the right as its left edge is from the left
  const right = bounds.safe ? editorialRight(ctx) : wide ? canvas.w - left : gridX(look, canvas, RIGHT_EDGE);
  const { font: sourceFont, wrap, maxWidth: sourceWidth } = sourceFontFor(ctx, data, sourceText, bounds.safe ? right - left : Infinity);
  // over a caption band; in the safe zone its ink (its descenders) ends at the band's bottom
  const down = bounds.safe && shot.source !== undefined ? inkExtent(sourceText, sourceFont, ctx.measure).down : WORD_DESCENT * font.size;
  const sourceBaseline = Math.min(bounds.bottom, caption - gap) - down - wrap;
  const sourced = shot.source === undefined ? null
    : label(ctx, { id: `${shot.id}.source`, text: sourceText, font: sourceFont, x: bounds.safe ? left : gridX(look, canvas, FIRST_COLUMN), y: sourceBaseline, fill: style.text, asWritten: true, ...(wrap > 0 ? { maxWidth: sourceWidth, lines: 2 } : {}) });
  const area = { x: left, y: title.bottom + data.titleGap * unit, w: right - left, h: 0 };
  const floorOf = (src) => Math.min(src === null ? bounds.bottom : src.box[1] - (data.sourceGap ?? SOURCE_GAP) * gap, caption) - gap;
  // bars with their labels over them need rows that show a bar; when they cannot have them, the source line (the least
  // important secondary line) goes and the title says so (kinds/secondary.mjs)
  const barred = style.labelsAbove && BARRED.includes(shot.type);
  const rowNeed = () => chartData(shot).items.length * ((CAP_HEIGHT + WORD_DESCENT + 1) * font.size + gap);
  const drops = barred && sourced !== null && floorOf(sourced) - area.y < rowNeed();
  const source = drops ? null : sourced;
  const plotArea = { ...area, h: Math.max(1, floorOf(source) - area.y) };
  const plot = drawPlot(shot, ctx, style, plotArea, { valueOnHighlight: true });
  const group = node('group', hero, {}, { children: plot.nodes });
  return {
    nodes: [drops ? withDropped(title.node, ['source']) : title.node, group, ...(source === null ? [] : [source.node])],
    boxes: { chart: [plotArea.x, plotArea.y, plotArea.w, plotArea.h], title: title.box, ...plot.boxes },
  };
}

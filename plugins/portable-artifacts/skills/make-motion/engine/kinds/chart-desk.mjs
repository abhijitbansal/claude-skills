// The chart kind in an editorial composition (desk): the claim as a serif heading top left on column 2, fitted between
// three times the labels and look.kinds.chart.titleMax in at most `titleLines` lines and there from the first frame;
// the chart directly on the paper under it, across columns 2 to 12 (1 to 12 on tall frames), ink marks and one accent,
// labels in the label face; the source line bottom left in the label face's small caps, beside the caption band on a
// wide frame and over it on a tall one. Pure and DOM-free.
import { registries } from '../registry.mjs';
import { node } from '../graph/node.mjs';
import { gridX } from '../looks/index.mjs';
import { pathPoints } from '../devices/shared.mjs';
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
const SOURCE_GAP = 3;
const HALF = 2;
const BARRED = Object.freeze(['bar', 'column']); // the types drawn as labelled bars on a tall cosmos frame (chart-plot.mjs) // gaps between the plot's lowest label and the source line

// The claim: fitted, flush left on column 2 (on a tall frame from data.titleFromTall, cosmos: column 1, the plot's left
// edge), its cap line where a statement's slug sits (SLUG.top of the height).
function titleNode(shot, ctx, data, labelSize) {
  const { look, canvas, unit, measure } = ctx;
  const span = editorialSpan(ctx, isWide(canvas) ? FIRST_COLUMN : data.titleFromTall ?? FIRST_COLUMN, isWide(canvas) ? data.titleToWide : data.titleToTall);
  const opts = { text: setCase(look, 'display', shot.title), font: fontFor(look, 'display', data.titleMax * unit, unit), maxWidth: span.w, align: 'left', measure };
  // a look may keep the claim a hair over three times the labels (data.titleMargin, cosmos); desk fits it from three times
  const fit = fitDisplay(opts, { min: (data.titleMargin ?? 1) * MIN_HERO_RATIO * labelSize, max: data.titleMax * unit, maxHeight: canvas.h, maxLines: data.titleLines }, look, unit);
  const bounds = editorialBounds(ctx);
  // where a statement's slug sits, or the top of the composition band in the platform safe zone (editorial.mjs)
  const top = bounds.safe ? bounds.top : Math.max(look.grid.margin * unit, SLUG.top * canvas.h);
  // in the safe zone, the first line's ink (its ascenders) starts at the band's top: the zone is the review's own edge
  const up = bounds.safe ? runInk(fit.layout.lines[0], fit.font, measure).up : CAP_HEIGHT * fit.font.size;
  const y = top + up - fit.layout.lines[0].y;
  const bottom = y + fit.layout.lines.at(-1).y + WORD_DESCENT * fit.font.size;
  // from the plot's left edge (data.titleFromTall) no line's ink starts left of that edge: a J's ink reaches left of its
  // advance and would cross the safe edge the plot is set on
  const inkLeft = Math.min(...fit.layout.lines.map((line) => runInk(line, fit.font, measure).left));
  const x = !isWide(canvas) && data.titleFromTall !== undefined ? span.x - inkLeft : span.x;
  const textNode = node('text', `${shot.id}.title`, { x, y, layout: fit.layout, font: fit.font, fill: look.palette.ink, role: 'hero' });
  return { node: textNode, bottom, box: capBox(x, y + fit.layout.lines[0].y, fit.layout.width, fit.font.size) };
}

// The source line's font: the label face at data.sourceStep (never under the look's secondary floor), set smaller in
// proportion when the line is wider than `width` (the 9:16 safe zone's width), down to that floor; a line still too
// wide there wraps (`wrap`: its lines' extra height, which the line is raised by).
function sourceFontFor(ctx, data, text, width) {
  const { look, unit, measure } = ctx;
  // the label face, or the face a look names (data.sourceFace, ledger: the serif)
  const face = data.sourceFace ?? 'label';
  const font = fontFor(look, face, secondarySize(look, unit, sizeAt(look, data.sourceStep, unit)), unit);
  const wide = text === '' ? 0 : labelWidth(ctx, font, text);
  if (wide <= width) return { font, wrap: 0 };
  const scaled = fontFor(look, face, Math.max(secondaryFloor(look, unit), (font.size * width) / wide), unit);
  if (labelWidth(ctx, scaled, text) <= width) return { font: scaled, wrap: 0 };
  const lines = layoutText({ text, font: scaled, maxWidth: width, measure }).lines;
  return { font: scaled, wrap: lines.at(-1).y - lines[0].y, maxWidth: width };
}

// A text node carrying the lines its kind left out (props.dropped: the review's 'dropped' rule).
const withDropped = (n, what) => node(n.type, n.id, { ...n.props, dropped: what }, { tracks: n.tracks, wordTracks: n.wordTracks });

// The annotation (data.annotation: { face }, ledger): the highlighted value in `face` beside its mark, on the label
// device's leader, which ends (on its dot) just inside the mark's far end: a bar's right end (the note where the value
// would stand, in the room the values keep), a column's top (the note over it, kept inside the plot), any other mark's
// centre. Lands with the highlight. None without the data or a highlight.
const ANCHOR_INSET = 4; // units inside the mark's far end where the leader ends
const NOTE_GAP = 28; // units between a column's top and the note over it (the label device's own gap)
function annotationNodes(shot, ctx, data, { plot, plotArea, size }) {
  if (data.annotation === undefined || !plot.highlight) return [];
  const mark = plot.nodes.find((n) => n.id === `${shot.id}.mark.${plot.highlight.index}`);
  if (mark === undefined) return [];
  const points = pathPoints(mark.props.d).map(([px, py]) => [px + (mark.props.x ?? 0), py + (mark.props.y ?? 0)]);
  const [x0, x1] = [Math.min(...points.map((p) => p[0])), Math.max(...points.map((p) => p[0]))];
  const [y0, y1] = [Math.min(...points.map((p) => p[1])), Math.max(...points.map((p) => p[1]))];
  // a bar's note reads on from its end, in the room the values keep; any other mark's sits above it
  const bar = shot.type === 'bar';
  const inset = ANCHOR_INSET * ctx.unit;
  const anchor = bar ? [x1 - inset, (y0 + y1) / HALF]
    : shot.type === 'column' ? [(x0 + x1) / HALF, y0 + inset] : [(x0 + x1) / HALF, (y0 + y1) / HALF];
  const at = plot.times?.highlightAt ?? 0;
  const box = [plotArea.x, plotArea.y, plotArea.w, plotArea.h];
  // a bar's note stands where its value would: the chart's gap past the bar's end
  const gap = bar ? data.gap + ANCHOR_INSET : NOTE_GAP;
  const built = registries.devices.get('label').build({ id: `${shot.id}.annotation`, box, at, look: ctx.look, unit: ctx.unit, seed: ctx.seed, measure: ctx.measure, text: plot.highlight.text, anchor, size, gap, side: bar ? 'right' : 'above', face: data.annotation.face ?? 'label' });
  return built.nodes;
}

/** The desk chart: { nodes, boxes } with the chart group carrying the hero id. */
export function expandDeskChart(shot, ctx, data, hero) {
  const { look, canvas, unit } = ctx;
  // a look may keep reference lines for some chart types only (data.refsTypes, ledger: line and area, whose axis needs
  // labelling; bars and columns carry their values)
  const base = chartStyle(ctx, data);
  const style = data.refsTypes === undefined ? base : { ...base, refs: data.refsTypes.includes(shot.type) };
  const { font, gap } = style;
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
  // three times the labels as set (labelScale); a look may hold it at three times the smallest text instead
  // (data.titleFloor 'smallest', cosmos: labels set large for a phone, the quieter source the smallest)
  const smallest = data.titleFloor === 'smallest' && shot.source !== undefined ? Math.min(font.size, sourceFont.size) : font.size;
  const title = titleNode(shot, ctx, data, smallest);
  // over a caption band; in the safe zone its ink (its descenders) ends at the band's bottom
  const down = bounds.safe && shot.source !== undefined ? inkExtent(sourceText, sourceFont, ctx.measure).down : WORD_DESCENT * font.size;
  const sourceBaseline = Math.min(bounds.bottom, caption - gap) - down - wrap;
  const sourced = shot.source === undefined ? null
    // off the safe zone too, a line wider than the plot's span says so (the review's fit finding), never runs off the frame
    : label(ctx, { id: `${shot.id}.source`, text: sourceText, font: sourceFont, x: bounds.safe ? left : gridX(look, canvas, FIRST_COLUMN), y: sourceBaseline, fill: style.text, asWritten: true, ...(wrap > 0 ? { maxWidth: sourceWidth, lines: 2 } : bounds.safe ? {} : { maxWidth: right - left }) });
  const area = { x: left, y: title.bottom + data.titleGap * unit, w: right - left, h: 0 };
  const floorOf = (src) => Math.min(src === null ? bounds.bottom : src.box[1] - (data.sourceGap ?? SOURCE_GAP) * gap, caption) - gap;
  // bars with their labels over them need rows that show a bar; when they cannot have them, the source line (the least
  // important secondary line) goes and the title says so (kinds/secondary.mjs)
  const barred = style.labelsAbove && BARRED.includes(shot.type);
  const rowNeed = () => chartData(shot).items.length * ((CAP_HEIGHT + WORD_DESCENT + 1) * font.size + gap);
  const drops = barred && sourced !== null && floorOf(sourced) - area.y < rowNeed();
  const source = drops ? null : sourced;
  const plotArea = { ...area, h: Math.max(1, floorOf(source) - area.y) };
  // a look with an annotation (data.annotation, ledger) sets the spoken figure as a note on a leader instead of a value
  const plot = drawPlot(shot, ctx, style, plotArea, { valueOnHighlight: data.annotation === undefined });
  const group = node('group', hero, {}, { children: [...plot.nodes, ...annotationNodes(shot, ctx, data, { plot, plotArea, size: font.size })] });
  return {
    nodes: [drops ? withDropped(title.node, ['source']) : title.node, group, ...(source === null ? [] : [source.node])],
    boxes: { chart: [plotArea.x, plotArea.y, plotArea.w, plotArea.h], title: title.box, ...plot.boxes },
  };
}

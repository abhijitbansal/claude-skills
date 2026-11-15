// The `stack` composition of a statement (pop): the text broken by sense into short lines (stackLines: at most three
// words, two when a line passes twelve letters, `|` honoured), each line set at its own size so that its ink exactly
// fills the available width (the platform safe width on 9:16, columns 1 to 12 otherwise), between scale step 3 and
// STACK.max units; a line that would need more than the cap stops there. Lines sit flush left on the left edge of the
// available width, stacked STACK.gap of the larger neighbour's size apart (ink box to ink box), and the block (with the
// kicker tag, STACK.kickerGap over the first line) is centred in the available height; when it does not fit, every line
// is set smaller in proportion. The hero is a group holding one text node per line, each tagged `stack: <hero id>` so the
// review counts the lines of one stack as one size class. Emphasis recolours: in a mode that reads from frame 0 every
// word is on screen from the first frame as a ghost (ink at 0.4, shared.mjs ghostTracks) and lights as it is spoken (ink, or the accent when emphasised); in any
// other mode words fade in on their times and an emphasised one turns accent. Nothing scales. Pure and DOM-free.
import { registries } from '../registry.mjs';
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';
import { layoutText } from '../text/layout.mjs';
import { stackLines, FORCE_MARK } from '../text/breaks.mjs';
import { gridX, gridSpan } from '../looks/index.mjs';
import { landing } from '../devices/shared.mjs';
import { sizeAt, fontFor, compositionRect, runInk, inkExtent, capBox, unionBox, requireDevice, ghostTracks } from './shared.mjs';

export const STACK = Object.freeze({ fromStep: 3, max: 400, gap: 0.08, kickerGap: 28, ref: 100 });
const FIT_PASSES = 3; // re-measure passes, for a face whose width is not exactly proportional to its size
const SHRINK_PASSES = 2;
const WIDTH_TOLERANCE = 1; // px: a line this much wider than the width still fits
const FIT_SLACK = 0.5; // px: a line is fitted this far inside the width, so re-measuring never leaves it a hair past the edge
const FILL_EASE = 'outCubic';
const NO_WRAP = 1e6;
const HALF = 2;

// The words of a text with a `|` kept on the word it follows, as stackLines takes them.
function markedWords(text) {
  const words = [];
  for (const raw of text.split(/\s+/)) {
    if (raw === '') continue;
    if (raw === FORCE_MARK) {
      if (words.length > 0 && !words.at(-1).endsWith(FORCE_MARK)) words[words.length - 1] += FORCE_MARK;
    } else words.push(raw);
  }
  return words;
}

const bare = (word) => (word.endsWith(FORCE_MARK) ? word.slice(0, -FORCE_MARK.length) : word);

// The space a stack composes in: the platform safe zone on 9:16, else columns 1 to 12 inside the margins.
export function stackArea(ctx) {
  const { look, canvas, unit } = ctx;
  const rect = compositionRect(ctx);
  if (rect.safe) return { left: rect.left, top: rect.top, w: rect.w, h: rect.h };
  const margin = look.grid.margin * unit;
  return { left: gridX(look, canvas, 1), top: margin, w: gridSpan(look, canvas, 1, look.grid.columns).w, h: canvas.h - HALF * margin };
}

// One line's words laid out at `size`: { font, layout, ink, width } with the ink in the line's own space.
function lineAt(words, size, ctx) {
  const font = fontFor(ctx.look, 'display', size, ctx.unit);
  const layout = layoutText({ text: words.join(' '), font, maxWidth: NO_WRAP, measure: ctx.measure });
  const ink = runInk(layout.lines[0], font, ctx.measure);
  return { font, layout, ink, width: ink.right - ink.left };
}

const clampTo = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// The size at which a line's ink is `width` wide, between `min` and `max`; a line still too wide at `min` overflows.
function fitLine(words, available, { min, max }, ctx) {
  const width = available - FIT_SLACK;
  let line = lineAt(words, STACK.ref * ctx.unit, ctx);
  for (let i = 0; i < FIT_PASSES; i++) {
    const size = clampTo((line.font.size * width) / line.width, min, max);
    if (size === line.font.size) break;
    line = lineAt(words, size, ctx);
  }
  if (line.width <= available) return line;
  if (line.width <= available + WIDTH_TOLERANCE && line.font.size > min) return lineAt(words, Math.max(min, (line.font.size * width) / line.width), ctx);
  return { ...line, layout: { ...line.layout, overflow: true } };
}

// The block's height: each line's ink plus the gaps between them.
const blockHeight = (lines) => lines.reduce((sum, l, k) => sum + l.ink.up + l.ink.down + (k === 0 ? 0 : STACK.gap * Math.max(l.font.size, lines[k - 1].font.size)), 0);

// The kicker tag's plate height (the tag device sizes itself from its text), or 0 without a kicker.
function kickerHeight(shot, ctx) {
  if (shot.kicker === undefined) return 0;
  requireDevice(ctx.look, 'tag', 'statement');
  const probe = registries.devices.get('tag').build({ id: 'probe', text: shot.kicker, box: [0, 0, 1, 1], at: 0, look: ctx.look, unit: ctx.unit, seed: ctx.seed, measure: ctx.measure });
  return probe.boxes.tag[3];
}

/** The stack laid out: { rows (word indexes per line), lines [{ font, layout, ink, x, baseline }], area, kicker } . */
export function composeStack(text, shot, ctx) {
  const { look, unit } = ctx;
  const words = markedWords(text);
  const rows = stackLines(words);
  const area = stackArea(ctx);
  const limits = { min: sizeAt(look, STACK.fromStep, unit), max: STACK.max * unit };
  let lines = rows.map((row) => fitLine(row.map((i) => bare(words[i])), area.w, limits, ctx));
  const tag = kickerHeight(shot, ctx);
  const above = tag === 0 ? 0 : tag + STACK.kickerGap * unit;
  for (let i = 0; i < SHRINK_PASSES && blockHeight(lines) + above > area.h; i++) {
    const share = (area.h - above) / blockHeight(lines);
    lines = rows.map((row, k) => lineAt(row.map((j) => bare(words[j])), lines[k].font.size * share, ctx));
  }
  // set smaller than scale step 3 to fit the height, a line no longer reads as a stack: it says so, as a statement
  // that cannot fit does (the review's overflow finding tells the director to cut words)
  lines = lines.map((line) => (line.font.size < limits.min ? { ...line, layout: { ...line.layout, overflow: true } } : line));
  let top = area.top + (area.h - blockHeight(lines) - above) / HALF + above;
  const placed = lines.map((line, k) => {
    if (k > 0) top += STACK.gap * Math.max(line.font.size, lines[k - 1].font.size);
    const baseline = top + line.ink.up;
    top = baseline + line.ink.down;
    return { ...line, x: area.left - line.ink.left, baseline };
  });
  const kicker = tag === 0 ? null : { top: placed[0].baseline - placed[0].ink.up - STACK.kickerGap * unit - tag, left: area.left };
  return { rows, lines: placed, area, kicker };
}

// A word's tracks: lit from a ghost when spoken (a mode that reads from frame 0), or fading in on its time; an emphasised
// word turns accent. `matched`: the hero arrived on a match cut and is on screen already.
function wordTracks(look, { at, emphasised }, { ghost, matched }) {
  const lit = emphasised ? look.palette.accent : look.palette.ink;
  const turn = (from) => track([{ t: 0, v: from }, { t: at, v: from }, { t: at + look.moves.emphasize.dur, v: lit, ease: FILL_EASE }]);
  if (ghost) return ghostTracks(look, at, lit);
  const tracks = matched ? {} : { opacity: landing(at, look.moves.enter, 0, 1) };
  return emphasised ? { ...tracks, fill: turn(look.palette.ink) } : tracks;
}

/**
 * The stack's nodes: the hero group of line nodes, the kicker tag (or nothing), and the targets' boxes.
 * @param {{ times: { at: number, emphasised: boolean }[], ghost: boolean, matched: boolean, hero: string }} opts
 *   times: per word index, when it is spoken and whether it is emphasised
 */
export function stackNodes(shot, ctx, placed, { times, ghost, matched, hero }) {
  const { look, unit, seed, measure } = ctx;
  const boxes = [];
  const children = placed.lines.map((line, k) => {
    const row = placed.rows[k];
    const y = line.baseline - line.layout.lines[0].y;
    line.layout.lines[0].words.forEach((w, j) => {
      const ink = inkExtent(w.text, line.font, measure); // the box a word's glyphs cover, so a flush edge is the ink's
      boxes[row[j]] = capBox(line.x + w.x + ink.left, line.baseline, ink.right - ink.left, line.font.size);
    });
    return node('text', `${hero}.line${k}`, { x: line.x, y, layout: line.layout, font: line.font, fill: look.palette.ink, role: 'hero', stack: hero }, {
      wordTracks: row.map((i) => wordTracks(look, times[i], { ghost, matched })),
    });
  });
  const group = node('group', hero, {}, { children });
  const kicker = placed.kicker === null ? [] : registries.devices.get('tag').build({
    id: `${shot.id}.kicker`, text: shot.kicker, box: [placed.kicker.left, placed.kicker.top, 1, 1], at: look.moves.enter.dur, look, unit, seed, measure,
  }).nodes;
  return { group, kicker, boxes: Object.fromEntries([['text', unionBox(boxes)], ...boxes.map((box, i) => [`word:${i}`, box])]) };
}

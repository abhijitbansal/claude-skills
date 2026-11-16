// The `list` kind in an editorial composition (desk): the title on the slug (slug.mjs), the items in the display face
// flush left on column 2, all at one size, each revealed whole on its arrival and dimmed to ink2 when the next arrives;
// a note under its item in the text face; with numbering, figures in the label face hanging in the margin, their ink a
// gutter before the items, centred on the cap height of the item's first line. The items are fitted together: the largest size from scale
// step look.kinds.list.fromStep (and three times the small parts) to `max` at which every item takes at most `maxLines`
// lines and the block fits the room the slug leaves; a size within 15% that leaves no item with a line of one word is
// preferred. A list that cannot fit is set smaller still (down to the look's smallest step) and says so on its longest
// item (layout overflow: the review's creative fit finding), so it stays inside the frame. Pure and DOM-free.
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';
import { layoutText } from '../text/layout.mjs';
import { gridSpan } from '../looks/index.mjs';
import {
  CAP_HEIGHT, WORD_DESCENT, sizeAt, fontFor, isWide, setCase, enterTracks, inkExtent, capBox, unionBox, driftReach, arrivesMatched,
} from './shared.mjs';
import { slugBox, slugNodes } from './slug.mjs';
import { MIN_HERO_RATIO } from '../review/frame.mjs';
import { itemsOf, isNumbered } from './list-items.mjs';

const FIRST_COLUMN = 2;
const SLUG_CLEAR = 2; // gutters between the list and the slug's card (as a statement keeps)
const BETTER_BREAK_SHARE = 0.85; // a size down to this share of the largest that fits may be taken for better breaks
const NO_WRAP = 1e6;
const EPSILON = 1e-6;
const HALF = 2;
const DIM_EASE = 'outCubic';

// The small parts' size (notes, figures): the largest of data.smallSteps the items stay MIN_HERO_RATIO times, else the smallest.
function smallSize(look, data, size, unit) {
  const fits = data.smallSteps.filter((step) => MIN_HERO_RATIO * sizeAt(look, step, unit) <= size + EPSILON);
  return sizeAt(look, fits.length > 0 ? Math.max(...fits) : Math.min(...data.smallSteps), unit);
}

// The items laid out at `size` across `width`: { parts [{ layout, note }], small, height } with height from the first cap
// line to just under the last baseline.
function setAt(items, size, width, ctx, data) {
  const { look, unit, measure } = ctx;
  const font = fontFor(look, 'display', size, unit);
  const small = smallSize(look, data, size, unit);
  const noteFont = fontFor(look, 'text', small, unit);
  const parts = items.map((item) => ({
    layout: layoutText({ text: item.text, font, maxWidth: width, measure }),
    note: item.note === null ? null : layoutText({ text: setCase(look, 'text', item.note), font: noteFont, maxWidth: width, measure }),
  }));
  const tall = (p) => p.layout.lines.at(-1).y - p.layout.lines[0].y + CAP_HEIGHT * size
    + (p.note === null ? 0 : data.noteGap * size + CAP_HEIGHT * small + p.note.lines.at(-1).y - p.note.lines[0].y);
  const last = parts.at(-1);
  const height = parts.reduce((sum, p, k) => sum + tall(p) + (k === 0 ? 0 : data.gap * size), 0) + WORD_DESCENT * (last.note === null ? size : small);
  return { size, font, small, noteFont, parts, height };
}

const fitsIn = (set, width, room, data) => set.height <= room + EPSILON
  && set.parts.every((p) => p.layout.lines.length <= data.maxLines && p.layout.width <= width + EPSILON && (p.note === null || p.note.width <= width + EPSILON));
const hasLoneLine = (set) => set.parts.some((p) => p.layout.lines.length > 1 && p.layout.lines.some((line) => line.words.length === 1));

// The largest whole size in [low, high] that fits, traded down (to BETTER_BREAK_SHARE of it) for no line of one word; or null.
function largestFitting(at, fits, low, high) {
  for (let size = Math.floor(high); size >= Math.ceil(low); size--) {
    const set = at(size);
    if (!fits(set)) continue;
    for (let s = size; s >= Math.max(Math.ceil(low), Math.ceil(size * BETTER_BREAK_SHARE)) && hasLoneLine(set); s--) {
      const other = at(s);
      if (fits(other) && !hasLoneLine(other)) return other;
    }
    return set;
  }
  return null;
}

// The items fitted (see the head of this file); an overflowing set marks its item with the most lines.
function fitItems(items, span, room, ctx, data, hasSmall) {
  const { look, unit } = ctx;
  const at = (size) => setAt(items, size, span.w, ctx, data);
  const fits = (set) => fitsIn(set, span.w, room, data);
  const floor = Math.max(sizeAt(look, data.fromStep, unit), hasSmall ? MIN_HERO_RATIO * sizeAt(look, Math.min(...data.smallSteps), unit) : 0);
  const good = largestFitting(at, fits, floor, data.max * unit);
  if (good !== null) return good;
  const smaller = largestFitting(at, fits, sizeAt(look, 1, unit), floor) ?? at(Math.ceil(sizeAt(look, 1, unit)));
  const worst = smaller.parts.reduce((best, p, k) => (p.layout.lines.length > smaller.parts[best].layout.lines.length ? k : best), 0);
  const parts = smaller.parts.map((p, k) => (k === worst ? { ...p, layout: { ...p.layout, overflow: true } } : p));
  return { ...smaller, parts };
}

const overlaps = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];

// The room the list has: between the margins, starting under the slug's card when the card is over the list's columns.
function roomFor(slug, span, ctx) {
  const { look, canvas, unit } = ctx;
  const margin = look.grid.margin * unit;
  const bottom = canvas.h - margin;
  if (slug === null) return { top: margin, bottom };
  const by = SLUG_CLEAR * look.grid.gutter * unit, drift = driftReach(look, unit);
  const [x, y, w, h] = slug.inked;
  const clear = [x - by - drift, y - by, w + HALF * (by + drift), h + HALF * by];
  const columns = [span.x - margin, 0, span.w + margin, canvas.h];
  return overlaps(clear, columns) ? { top: Math.max(margin, clear[1] + clear[3]), bottom } : { top: margin, bottom };
}

// A word track that holds ink until `dimAt` (never, when undefined), then turns to ink2.
function dimTrack(look, dimAt) {
  const { ink, ink2 } = look.palette;
  if (dimAt === undefined) return track([{ t: 0, v: ink }]);
  return track([{ t: 0, v: ink }, { t: dimAt, v: ink }, { t: dimAt + look.moves.emphasize.dur, v: ink2, ease: DIM_EASE }]);
}

// A figure: the item's number in the label face, padded to the count's digits, its ink ending `right`, on `baseline`.
function figureNode(id, k, n, set, { right, baseline }, ctx) {
  const { look, unit, measure } = ctx;
  const text = String(k + 1).padStart(String(n).length, '0');
  const font = fontFor(look, 'label', set.small, unit);
  const layout = layoutText({ text, font, maxWidth: NO_WRAP, measure });
  const ink = inkExtent(text, font, measure);
  const y = baseline - layout.lines[0].y;
  return { node: node('text', id, { x: right - ink.right, y, layout, font, fill: look.palette.ink, role: 'label' }), y };
}

/**
 * The desk list: { nodes (the slug), group (the hero: items, figures, notes), itemBoxes, wrappers: null }.
 * @param {number[]} times when each item arrives (listTimes)
 */
export function expandDeskList(shot, ctx, data, times, hero) {
  const { look, canvas, unit } = ctx;
  const items = itemsOf(shot).map((item) => ({ ...item, text: setCase(look, 'display', item.text) }));
  const numbered = isNumbered(shot);
  const staged = shot.title === undefined ? shot : { ...shot, kicker: shot.title };
  const span = gridSpan(look, canvas, FIRST_COLUMN, isWide(canvas) ? data.toWide : data.toTall);
  const room = roomFor(slugBox(staged, ctx), span, ctx);
  const set = fitItems(items, span, room.bottom - room.top, ctx, data, numbered || items.some((i) => i.note !== null));
  const matched = arrivesMatched(shot, ctx);
  const children = [], itemBoxes = [];
  let cursor = room.top + (room.bottom - room.top - set.height) / HALF; // the next cap line
  set.parts.forEach((part, k) => {
    const id = `${shot.id}.item${k}`;
    const y = cursor + CAP_HEIGHT * set.size - part.layout.lines[0].y;
    const enter = (at, rest) => (matched && k === 0 ? {} : enterTracks(look, unit, at, { y: rest }));
    const dim = { fill: dimTrack(look, times[k + 1]) };
    children.push(node('text', id, { x: span.x, y, layout: part.layout, font: set.font, fill: look.palette.ink, role: 'hero' }, {
      tracks: enter(times[k], y), wordTracks: part.layout.lines.flatMap((line) => line.words.map(() => dim)),
    }));
    itemBoxes.push(unionBox(part.layout.lines.map((line) => capBox(span.x + line.x, y + line.y, line.width, set.size))));
    let last = y + part.layout.lines.at(-1).y;
    if (numbered) {
      // centred on the first line's cap height: a figure a third of the item's size reads as a footnote mark on its
      // baseline and as a superscript on its cap line (both viewed on the rendered sheets), as a list marker centred
      const middle = y + part.layout.lines[0].y - (CAP_HEIGHT * set.size) / HALF;
      const figure = figureNode(`${shot.id}.figure${k}`, k, set.parts.length, set, { right: span.x - look.grid.gutter * unit, baseline: middle + (CAP_HEIGHT * set.small) / HALF }, ctx);
      children.push(node(figure.node.type, figure.node.id, figure.node.props, { tracks: enter(times[k], figure.y), wordTracks: [dim] }));
    }
    if (part.note !== null) {
      const noteY = last + data.noteGap * set.size + CAP_HEIGHT * set.small - part.note.lines[0].y;
      children.push(node('text', `${shot.id}.note${k}`, { x: span.x, y: noteY, layout: part.note, font: set.noteFont, fill: look.palette.ink2, role: 'body' }, {
        tracks: enter(times[k], noteY),
      }));
      last = noteY + part.note.lines.at(-1).y;
    }
    cursor = last + data.gap * set.size;
  });
  return { nodes: slugNodes(staged, ctx), group: node('group', hero, {}, { children }), itemBoxes, wrappers: null };
}

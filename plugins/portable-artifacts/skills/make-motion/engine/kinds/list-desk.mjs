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
import { roundedRect } from '../devices/shared.mjs';
import { editorialSpan, editorialBounds } from './editorial.mjs';
import { sunNodes, circlePath } from '../devices/sun.mjs';
import {
  CAP_HEIGHT, WORD_DESCENT, sizeAt, fontFor, isWide, setCase, enterTracks, inkExtent, capBox, unionBox, arrivesMatched, overlaps, stepUnder,
} from './shared.mjs';
import { driftReach } from './camera.mjs';
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
  return sizeAt(look, stepUnder(look, data.smallSteps, unit, [{ size, ratio: MIN_HERO_RATIO }]), unit);
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


// The room the list has: between the margins (editorial.mjs: the band, on a tall frame in the safe zone), starting under
// the slug's card when the card is over the list's columns.
function roomFor(slug, span, ctx) {
  const { look, canvas, unit } = ctx;
  const margin = look.grid.margin * unit;
  const bounds = editorialBounds(ctx);
  const bottom = bounds.bottom;
  if (slug === null) return { top: bounds.top, bottom };
  const by = SLUG_CLEAR * look.grid.gutter * unit, drift = driftReach(look, unit);
  const [x, y, w, h] = slug.inked;
  const clear = [x - by - drift, y - by, w + HALF * (by + drift), h + HALF * by];
  const columns = [span.x - margin, 0, span.w + margin, canvas.h];
  return overlaps(clear, columns) ? { top: Math.max(bounds.top, clear[1] + clear[3]), bottom } : { top: bounds.top, bottom };
}

// The dot rail (look.kinds.list.dots: { column, radius, line } in units): a dot per item on its first line's cap middle,
// in a column at the span's left, joined by a thin rail; ink2 always, and lit in the accent with a soft halo while its
// item is current (from its arrival to the next's). The rail and each dot arrive with their item's entrance opacity.
const DOT = Object.freeze({ halo: 2.4, railAlpha: 0.5 });
function dotRail(id, centres, times, dots, ctx) {
  const { look, unit } = ctx;
  const r = dots.radius * unit;
  const circle = ([cx, cy], radius) => roundedRect(cx - radius, cy - radius, HALF * radius, HALF * radius, radius);
  // `peak` from item k's arrival until the next item's, 0 before and after
  const lit = (k, peak) => {
    const { dur } = look.moves.emphasize;
    const keys = [{ t: 0, v: 0 }, { t: times[k], v: 0 }, { t: times[k] + dur, v: peak, ease: DIM_EASE }];
    if (times[k + 1] !== undefined) keys.push({ t: times[k + 1], v: peak }, { t: times[k + 1] + dur, v: 0, ease: DIM_EASE });
    return track(keys);
  };
  // with previews every dot and the whole rail are there from frame 0 (look.kinds.list.previews, cosmos)
  const shown = (k) => (dots.previews ? track([{ t: 0, v: 1 }]) : enterTracks(look, unit, times[k], { y: 0 }).opacity);
  const railW = dots.line * unit;
  // the rail grows with the list: the segment to dot k arrives with item k
  const rail = centres.slice(1).map(([x, y], k) => {
    const from = centres[k][1];
    return node('path', `${id}.rail${k}`, { d: roundedRect(x - railW / HALF, from, railW, Math.max(1, y - from), 0), fill: look.palette.ink2 }, {
      tracks: { opacity: track(shown(k + 1).points.map((p, i) => ({ t: p.t, v: p.v * DOT.railAlpha, ...(i > 0 ? { ease: look.moves.enter.ease } : {}) }))) },
    });
  });
  return [...pathLight(id, centres, times, dots, ctx), ...rail, ...centres.flatMap((c, k) => [
    node('path', `${id}.dot${k}`, { d: circle(c, r), fill: look.palette.ink2 }, { tracks: { opacity: shown(k) } }),
    haloNode(`${id}.halo${k}`, c, r * DOT.halo, look, { opacity: lit(k, 1) }),
    node('path', `${id}.lit${k}`, { d: circle(c, r), fill: look.palette.accent }, { tracks: { opacity: lit(k, 1) } }),
  ])];
}

// The current dot's halo: a soft accent light round it, a radial falling to nothing (a flat screened disc read as a
// grey-brown smudge round the dot: gate review 3).
const HALO_STOPS = Object.freeze([[0, 0.55], [0.4, 0.28], [1, 0]]);
const haloNode = (id, [cx, cy], radius, look, tracks) => node('path', id, {
  d: circlePath(radius), x: cx, y: cy, radial: { r: radius, color: look.palette.accent, stops: HALO_STOPS.map((s) => [...s]) },
}, { tracks });

// Where the sun stands over a dot rail with light (dots.light): on the rail's line, a disc and a gap above the first
// item's dot, so it is a node of its own and never the first item's bullet (gate review 3). [x, y] px.
function railSunAt(centres, dots, look, unit) {
  const [x0, y0] = centres[0];
  return [x0, y0 - railSunRoom(dots, look, unit)];
}
// The room a rail's sun takes above its first dot, px: its disc twice and a gap.
const railSunRoom =(dots, look, unit) => (HALF * look.sun.disc * dots.light.sun + dots.light.gap) * unit;

// The light along the path (dots.light, cosmos): the look's sun at the path's start, above the first item, and each
// segment of the rail lit in the accent as its item arrives (the first, from the sun, with the first item), so the
// light travels down the path to the current item. [] without it.
function pathLight(id, centres, times, dots, ctx) {
  if (!dots.light) return [];
  const { look, unit } = ctx;
  const w = dots.line * unit;
  const [sx, sy] = railSunAt(centres, dots, look, unit);
  const sun = sunNodes(`${id}.sun`, look, { cx: sx, cy: sy, r: dots.light.sun * unit, strength: dots.light.strength });
  const reach = (k) => track([{ t: 0, v: 0 }, { t: times[k], v: 0 }, { t: times[k] + look.moves.draw.dur, v: 1, ease: look.moves.draw.ease }]);
  const bar = (key, x, from, to, tracks) => node('path', `${id}.${key}`, { d: roundedRect(x - w / HALF, from, w, Math.max(1, to - from), w / HALF), fill: look.palette.accent }, { tracks });
  const toFirst = [
    node('path', `${id}.rail.sun`, { d: roundedRect(sx - w / HALF, sy, w, Math.max(1, centres[0][1] - sy), 0), fill: look.palette.ink2, opacity: DOT.railAlpha }),
    bar('path.sun', sx, sy, centres[0][1], { opacity: reach(0) }),
  ];
  const lit = centres.slice(1).map(([x, y], k) => bar(`path${k}`, x, centres[k][1], y, { opacity: reach(k + 1) }));
  return [...sun, ...toFirst, ...lit];
}

// An item's fill with previews (cosmos): ink2 from frame 0, lit to ink while it is current (from `at` to `next`),
// back to ink2 after; one dim colour for every state that is not current.
function previewTrack(look, at, next) {
  const { ink, ink2 } = look.palette;
  const { dur } = look.moves.emphasize;
  const keys = [{ t: 0, v: ink2 }, { t: at, v: ink2 }, { t: at + dur, v: ink, ease: DIM_EASE }];
  if (next !== undefined) keys.push({ t: next, v: ink }, { t: next + dur, v: ink2, ease: DIM_EASE });
  return track(keys, { space: look.colorSpace });
}

// A word track that holds ink until `dimAt` (never, when undefined), then turns to ink2.
function dimTrack(look, dimAt) {
  const { ink, ink2 } = look.palette;
  if (dimAt === undefined) return track([{ t: 0, v: ink }]);
  return track([{ t: 0, v: ink }, { t: dimAt, v: ink }, { t: dimAt + look.moves.emphasize.dur, v: ink2, ease: DIM_EASE }], { space: look.colorSpace });
}

// A figure: the item's number as written (1 to 12, never 01) in the display serif at the item's own size (director's
// note after look review 2: smaller mono figures still read as footnote marks; at the item's size there is no new size
// on the frame), its ink ending `right` so the figures form one column, on the item's first baseline. Figures and items
// are one size class (props.stack, the hero id).
function figureNode(id, k, size, { right, baseline, stack }, ctx) {
  const { look, unit, measure } = ctx;
  const text = String(k + 1);
  const font = fontFor(look, 'display', size, unit);
  const layout = layoutText({ text, font, maxWidth: NO_WRAP, measure });
  const ink = inkExtent(text, font, measure);
  const y = baseline - layout.lines[0].y;
  return { node: node('text', id, { x: right - ink.right, y, layout, font, fill: look.palette.ink2, role: 'label', stack }), y };
}

// With wide tall-frame spacing (gapTall) the block fills its room, so its ink (a dot, an ascender over the cap line)
// would sit on the band's edges: a look gives it a share of the room instead (roomTall, cosmos), centred.
function tallRoom(room, data, canvas) {
  if (isWide(canvas) || data.roomTall === undefined) return room;
  const inset = ((room.bottom - room.top) * (1 - data.roomTall)) / HALF;
  return { top: room.top + inset, bottom: room.bottom - inset };
}

/**
 * The desk list: { nodes (the slug), group (the hero: items, figures, notes), itemBoxes, wrappers: null }.
 * @param {number[]} times when each item arrives (listTimes)
 */
export function expandDeskList(shot, ctx, given, times, hero) {
  const { look, canvas, unit } = ctx;
  // a look may space the items wider on a tall frame (gapTall, cosmos), so the path runs the band's height
  const data = !isWide(canvas) && given.gapTall ? { ...given, gap: given.gapTall } : given;
  const items = itemsOf(shot).map((item) => ({ ...item, text: setCase(look, 'display', item.text) }));
  const dots = data.dots;
  // a look with a dot rail marks every item with its dot, so no figures
  const numbered = isNumbered(shot) && !dots;
  const staged = shot.title === undefined ? shot : { ...shot, kicker: shot.title };
  // a look with a narrow tall margin starts the items further in on a tall frame (data.fromTall, ledger), so the figures
  // hanging before them keep inside the safe area
  // (data.fromTallPlain, keynote: gate-keynote-2 ruling 7: a list with no figures starts there instead, on the inset the
  // other shots keep; from fromTall it sat twice as far in with nothing hanging before it)
  const tallFrom = !numbered && data.fromTallPlain !== undefined ? data.fromTallPlain : data.fromTall ?? FIRST_COLUMN;
  const grid = editorialSpan(ctx, isWide(canvas) ? FIRST_COLUMN : tallFrom, isWide(canvas) ? data.toWide : data.toTall);
  const span = dots ? { x: grid.x + dots.column * unit, w: grid.w - dots.column * unit } : grid;
  // a look may drop the slug for lists (look.kinds.list.slug false, cosmos: the badge floated, unexplained)
  const slugged = data.slug !== false;
  const plain = tallRoom(roomFor(slugged ? slugBox(staged, ctx) : null, grid, ctx), data, canvas);
  // a rail with a sun (dots.light, cosmos) keeps the room over the first item for it
  const room = dots?.light ? { ...plain, top: plain.top + railSunRoom(dots, look, unit) } : plain;
  const set = fitItems(items, span, room.bottom - room.top, ctx, data, numbered || items.some((i) => i.note !== null));
  const matched = arrivesMatched(shot, ctx);
  const children = [], itemBoxes = [], centres = [];
  // on a tall frame a look may spread the items down the whole room (fillTall, cosmos: the path runs the content band)
  const spare = Math.max(0, room.bottom - room.top - set.height);
  const spread = !isWide(canvas) && data.fillTall && set.parts.length > 1 ? spare / (set.parts.length - 1) : 0;
  let cursor = room.top + (spread > 0 ? 0 : spare / HALF); // the next cap line
  set.parts.forEach((part, k) => {
    const id = `${shot.id}.item${k}`;
    const y = cursor + CAP_HEIGHT * set.size - part.layout.lines[0].y;
    const enter = (at, rest) => ((matched && k === 0) || data.previews ? {} : enterTracks(look, unit, at, { y: rest }));
    const dim = { fill: data.previews ? previewTrack(look, times[k], times[k + 1]) : dimTrack(look, times[k + 1]) };
    children.push(node('text', id, { x: span.x, y, layout: part.layout, font: set.font, fill: look.palette.ink, role: 'hero', ...(numbered ? { stack: hero } : {}) }, {
      tracks: enter(times[k], y), wordTracks: part.layout.lines.flatMap((line) => line.words.map(() => dim)),
    }));
    itemBoxes.push(unionBox(part.layout.lines.map((line) => capBox(span.x + line.x, y + line.y, line.width, set.size))));
    if (dots) centres.push([grid.x + dots.radius * unit, y + part.layout.lines[0].y - (CAP_HEIGHT * set.size) / HALF]);
    let last = y + part.layout.lines.at(-1).y;
    if (numbered) {
      // on the item's first baseline, its ink a gutter before the item; ink while its item is current, then ink2 with it
      const figure = figureNode(`${shot.id}.figure${k}`, k, set.size, { right: span.x - look.grid.gutter * unit, baseline: y + part.layout.lines[0].y, stack: hero }, ctx);
      children.push(node(figure.node.type, figure.node.id, figure.node.props, { tracks: enter(times[k], figure.y), wordTracks: [dim] }));
    }
    if (part.note !== null) {
      const noteY = last + data.noteGap * set.size + CAP_HEIGHT * set.small - part.note.lines[0].y;
      children.push(node('text', `${shot.id}.note${k}`, { x: span.x, y: noteY, layout: part.note, font: set.noteFont, fill: look.palette.ink2, role: 'body' }, {
        tracks: enter(times[k], noteY),
      }));
      last = noteY + part.note.lines.at(-1).y;
    }
    cursor = last + data.gap * set.size + spread;
  });
  const rail = dots ? dotRail(shot.id, centres, times, { ...dots, previews: data.previews }, ctx) : [];
  return { nodes: slugged ? slugNodes(staged, ctx) : [], group: node('group', hero, {}, { children: [...rail, ...children] }), itemBoxes, wrappers: null };
}

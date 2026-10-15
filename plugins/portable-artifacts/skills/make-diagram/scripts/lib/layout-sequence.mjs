// Sequence diagram layout: a pure function, no ELK.
// layoutSequence(spec, theme) -> SeqGeometry; every coordinate is absolute
// (top-left origin, OUTER_MARGIN px around the content) and rounded to 0.1 px.
//
// Vertical model: items (messages and notes) run top to bottom in ROW_HEIGHT
// rows; a self message takes two rows, a note as many as its box needs.
// Frames add fixed pixel space (a head for the tab, a bottom pad) on top of
// the rows, so `rows` counts message and note rows only.
import { measure, lineHeight, wrap } from '../../shared/text.mjs';
import { KINDS } from './kinds.mjs';
import { nodeSize, edgeLabelSize, fonts, evenUp } from './sizes.mjs';
import { legendLayout, placeLegend, drawingBounds, LEGEND_BAND } from './legend.mjs';

const OUTER_MARGIN = 24; // same outer margin as layout-graph.mjs (which pulls in ELK, so not imported)
export const ROW_HEIGHT = 44;
export const MIN_COLUMN_GAP = 64; // between two participant boxes
export const LABEL_CLEARANCE = 32; // a label plate plus this fits between two lifelines
export const LOOP_WIDTH = 32; // how far a self message reaches right of its lifeline
export const LOOP_HEIGHT = 32;
const LOOP_LABEL_GAP = 8;
const LOOP_LABEL_TAIL = 16; // between a self label and the next lifeline
export const LABEL_TOP = 4; // label plate top, below its row's top
export const ARROW_OFFSET = 32; // arrow line, below its row's top
export const FRAME_PAD = 12; // frame border to the content it encloses
export const FRAME_TAB_HEIGHT = 20;
export const FRAME_HEAD = 24; // tab height plus a gap, before the first row of a frame
const FRAME_GAP = 8; // after the last frame closing on a row
const TAB_PAD_X = 8;
const TAB_LABEL_GAP = 8;
export const NOTE_PAD_X = 10;
export const NOTE_PAD_Y = 6;
const NOTE_SLOT_PAD = 6;
const NOTE_OVERHANG = 20; // a note over several participants reaches this far past the outer lifelines
const NOTE_MIN_WIDTH = 96;
const NOTE_MAX_WIDTH = 240; // when no neighbour limits it
const NOTE_NEIGHBOUR_GAP = 16;
const FIRST_ROW_GAP = 12; // header bottom to the first row
const LIFELINE_TAIL = 20; // below the last row
const MIN_BODY = ROW_HEIGHT; // a diagram with no rows still gets a lifeline

const round = (v) => Math.round(v * 10) / 10;
const MESSAGE_KIND = 'sync';

function layoutParticipants(spec, theme) {
  const kinds = KINDS.sequence;
  const sized = spec.participants.map((p) => {
    const kind = p.kind ?? kinds.default;
    return { p, kind, shape: kinds.kinds[kind].shape, size: nodeSize(p, kinds.kinds[kind], theme) };
  });
  // One header height for the row, so every lifeline starts on the same line.
  const height = Math.max(...sized.map((s) => s.size.height));
  return { sized, height };
}

// Centre-to-centre pitch of each adjacent pair, widened until every message
// label (and self-loop label) fits between the lifelines it spans.
function columnPitches(widths, requirements) {
  const pitch = widths.slice(1).map((w, i) => (widths[i] + w) / 2 + MIN_COLUMN_GAP);
  for (const { lo, hi, need } of [...requirements].sort((a, b) => (a.hi - a.lo) - (b.hi - b.lo))) {
    const span = hi - lo;
    let have = 0;
    for (let i = lo; i < hi; i++) have += pitch[i];
    if (have >= need) continue;
    const extra = Math.ceil((need - have) / span);
    for (let i = lo; i < hi; i++) pitch[i] += extra;
  }
  return pitch;
}

// Items in drawing order: notes with no `after` first, then each message
// followed by the notes that come after it.
function orderItems(spec) {
  const notes = spec.notes ?? [];
  const items = [];
  notes.forEach((note, i) => { if (note.after === undefined) items.push({ type: 'note', note, index: i }); });
  for (const message of spec.messages ?? []) {
    items.push({ type: 'message', message });
    notes.forEach((note, i) => { if (note.after === message.id) items.push({ type: 'note', note, index: i }); });
  }
  return items;
}

function sizeMessage(message, theme, indexOf) {
  const from = indexOf.get(message.from);
  const to = indexOf.get(message.to);
  const kind = message.kind ?? MESSAGE_KIND;
  const plate = message.label === undefined ? null : edgeLabelSize(message.label, theme);
  return { message, kind, from, to, plate, self: kind === 'self' };
}

function labelRequirement(m) {
  if (!m.plate) return null;
  if (m.self) return { lo: m.from, hi: m.from + 1, need: LOOP_WIDTH + LOOP_LABEL_GAP + m.plate.width + LOOP_LABEL_TAIL };
  return { lo: Math.min(m.from, m.to), hi: Math.max(m.from, m.to), need: m.plate.width + LABEL_CLEARANCE };
}

// Width of a note over one participant: its text on one line if a neighbour's
// lifeline leaves room, else the room it has, wrapped.
function noteWidth(note, f, cx, pitch) {
  const natural = measure(note.text.replace(/\s+/g, ' ').trim(), f.note) + 2 * NOTE_PAD_X;
  const idx = note.overIdx;
  const lo = Math.min(...idx);
  const hi = Math.max(...idx);
  if (hi > lo) return { left: cx[lo] - NOTE_OVERHANG, right: cx[hi] + NOTE_OVERHANG };
  const sides = [pitch[lo - 1], pitch[lo]].filter((v) => v !== undefined).map((v) => v - NOTE_NEIGHBOUR_GAP);
  const cap = sides.length ? 2 * Math.min(...sides) : NOTE_MAX_WIDTH;
  const width = Math.max(NOTE_MIN_WIDTH, Math.min(natural, Math.max(cap, NOTE_MIN_WIDTH)));
  return { left: cx[lo] - width / 2, right: cx[lo] + width / 2 };
}

function layoutNote(item, f, cx, pitch, cursor) {
  const note = { ...item.note, overIdx: item.overIdx };
  const { left, right } = noteWidth(note, f, cx, pitch);
  const text = note.text.replace(/\s+/g, ' ').trim();
  const lines = wrap(text, right - left - 2 * NOTE_PAD_X, f.note);
  const height = evenUp(lines.length * lineHeight(f.note) + 2 * NOTE_PAD_Y);
  const rows = Math.ceil((height + 2 * NOTE_SLOT_PAD) / ROW_HEIGHT);
  return {
    rows,
    place: (top) => ({
      text, lines, over: item.note.over, after: item.note.after ?? null,
      left, right, y: top + (rows * ROW_HEIGHT - height) / 2, height,
    }),
  };
}

function frameTree(spec, items) {
  const messageAt = new Map(items.flatMap((it, i) => (it.type === 'message' ? [[it.message.id, i]] : [])));
  const frames = (spec.frames ?? []).map((f, order) => {
    const at = f.messages.map((id) => messageAt.get(id));
    return { frame: f, order, start: Math.min(...at), end: Math.max(...at) };
  });
  const contains = (a, b) => a !== b && a.start <= b.start && a.end >= b.end
    && (a.end - a.start > b.end - b.start || a.order < b.order);
  for (const f of frames) {
    f.inner = frames.filter((g) => contains(f, g));
    f.height = 0;
  }
  // heights bottom-up: a frame is one taller than the tallest it contains
  for (const f of [...frames].sort((a, b) => (a.end - a.start) - (b.end - b.start) || b.order - a.order)) {
    f.height = f.inner.length ? 1 + Math.max(...f.inner.map((g) => g.height)) : 0;
  }
  return frames;
}

/** Lay out a sequence spec. */
export function layoutSequence(spec, theme) {
  const f = fonts(theme);
  const { sized, height: headerHeight } = layoutParticipants(spec, theme);
  const indexOf = new Map(sized.map((s, i) => [s.p.id, i]));
  const widths = sized.map((s) => s.size.width);

  const items = orderItems(spec).map((it) => (it.type === 'message'
    ? { ...it, m: sizeMessage(it.message, theme, indexOf) }
    : { ...it, overIdx: it.note.over.map((id) => indexOf.get(id)) }));

  const requirements = items.flatMap((it) => (it.type === 'message' ? [labelRequirement(it.m)] : []))
    .filter((r) => r && r.hi < widths.length);
  const pitch = columnPitches(widths, requirements);
  const cx = [0];
  pitch.forEach((d, i) => cx.push(cx[i] + d));

  const frames = frameTree(spec, items);
  const startsAt = (i) => frames.filter((fr) => fr.start === i).sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.order - b.order);
  const endsAt = (i) => frames.filter((fr) => fr.end === i).sort((a, b) => (a.end - a.start) - (b.end - b.start) || b.order - a.order);

  const headerTop = OUTER_MARGIN + LEGEND_BAND; // the legend row sits above the headers (legend.mjs)
  const lifelineTop = headerTop + headerHeight;
  let cursor = lifelineTop + FIRST_ROW_GAP;
  let row = 0;
  const messages = [];
  const notes = [];
  const extents = [];

  items.forEach((it, i) => {
    for (const fr of startsAt(i)) {
      fr.top = cursor;
      cursor += FRAME_HEAD;
    }
    if (it.type === 'message') {
      const { m } = it;
      const top = cursor;
      const rows = m.self ? 2 : 1;
      const x = cx[m.from];
      let points;
      let label = null;
      let reach;
      if (m.self) {
        const y1 = top + (ROW_HEIGHT * 2 - LOOP_HEIGHT) / 2;
        points = [{ x, y: y1 }, { x: x + LOOP_WIDTH, y: y1 }, { x: x + LOOP_WIDTH, y: y1 + LOOP_HEIGHT }, { x, y: y1 + LOOP_HEIGHT }];
        if (m.plate) label = { ...m.plate, x: x + LOOP_WIDTH + LOOP_LABEL_GAP, y: y1 + (LOOP_HEIGHT - m.plate.height) / 2 };
        reach = { lo: x, hi: label ? label.x + label.width : x + LOOP_WIDTH };
      } else {
        const y = top + ARROW_OFFSET;
        points = [{ x, y }, { x: cx[m.to], y }];
        if (m.plate) label = { ...m.plate, x: (x + cx[m.to]) / 2 - m.plate.width / 2, y: top + LABEL_TOP };
        reach = { lo: Math.min(x, cx[m.to]), hi: Math.max(x, cx[m.to]) };
      }
      messages.push({ id: m.message.id, from: m.message.from, to: m.message.to, kind: m.kind, label, points, row, y: top, rows });
      extents[i] = reach;
      cursor += rows * ROW_HEIGHT;
      row += rows;
    } else {
      const { rows, place } = layoutNote(it, f, cx, pitch, cursor);
      const note = place(cursor);
      notes.push(note);
      extents[i] = { lo: note.left, hi: note.right };
      cursor += rows * ROW_HEIGHT;
      row += rows;
    }
    const closing = endsAt(i);
    for (const fr of closing) {
      fr.bottom = cursor + FRAME_PAD;
      cursor = fr.bottom;
    }
    if (closing.length) cursor += FRAME_GAP;
  });

  const lifelineBottom = Math.max(cursor, lifelineTop + MIN_BODY) + LIFELINE_TAIL;

  // Frames, inside out so an outer frame can wrap the ones it contains.
  const group = fonts(theme).group;
  const framesOut = new Map();
  for (const fr of [...frames].sort((a, b) => a.height - b.height || a.order - b.order)) {
    const span = extents.slice(fr.start, fr.end + 1);
    const pad = FRAME_PAD * (1 + fr.height);
    const tabWidth = evenUp(measure(fr.frame.kind, group) + 2 * TAB_PAD_X);
    const labelText = fr.frame.label === undefined ? null : fr.frame.label.replace(/\s+/g, ' ').trim();
    const labelWidth = labelText === null ? 0 : measure(labelText, f.edge);
    const minWidth = tabWidth + (labelText === null ? 0 : TAB_LABEL_GAP + labelWidth) + FRAME_PAD;
    let left = Math.min(...span.map((e) => e.lo)) - pad;
    let right = Math.max(...span.map((e) => e.hi)) + pad;
    for (const inner of fr.inner) {
      const g = framesOut.get(inner);
      left = Math.min(left, g.left - FRAME_PAD);
      right = Math.max(right, g.right + FRAME_PAD);
    }
    right = Math.max(right, left + minWidth);
    framesOut.set(fr, {
      kind: fr.frame.kind, label: labelText, messages: [...fr.frame.messages],
      left, right, y: fr.top, height: fr.bottom - fr.top,
      tab: { width: tabWidth, height: FRAME_TAB_HEIGHT },
      labelWidth,
    });
  }

  // Normalise x: the leftmost thing sits OUTER_MARGIN from the edge.
  const headerBoxes = sized.map((s, i) => ({ left: cx[i] - s.size.width / 2, right: cx[i] + s.size.width / 2 }));
  const all = [...headerBoxes, ...framesOut.values(), ...notes, ...extents];
  const minX = Math.min(...all.map((b) => b.left ?? b.lo));
  const maxX = Math.max(...all.map((b) => b.right ?? b.hi));
  const legend = legendLayout(spec, theme);
  const drawingWidth = round(maxX - minX + 2 * OUTER_MARGIN);
  const needed = Math.ceil(legend.width + 2 * OUTER_MARGIN);
  const width = Math.max(drawingWidth, needed); // a narrow drawing widens to hold its legend, to a whole pixel
  const dx = OUTER_MARGIN - minX + (needed > drawingWidth ? round((needed - drawingWidth) / 2) : 0); // and sits centred in it
  const sx = (v) => round(v + dx);
  const pt = (p) => ({ x: sx(p.x), y: round(p.y) });
  const height = round(lifelineBottom + OUTER_MARGIN);
  return {
    width,
    height,
    drawing: drawingBounds(needed > drawingWidth ? (needed - drawingWidth) / 2 : 0, drawingWidth, height),
    legend: placeLegend(legend, width, OUTER_MARGIN),
    participants: sized.map((s, i) => ({
      id: s.p.id,
      x: sx(headerBoxes[i].left),
      y: headerTop,
      width: s.size.width,
      height: headerHeight,
      lines: s.size.lines,
      icon: s.size.icon,
      emoji: s.size.emoji,
      typeLine: s.size.typeLine,
      kind: s.kind,
      shape: s.shape,
      lifeline: { x: sx(cx[i]), y1: lifelineTop, y2: round(lifelineBottom) },
    })),
    messages: messages.map(({ y, rows, label, points, ...m }) => ({
      ...m,
      label: label && { text: label.text, x: sx(label.x), y: round(label.y), width: label.width, height: label.height },
      points: points.map(pt),
    })),
    frames: (spec.frames ?? []).map((_, order) => {
      const g = framesOut.get(frames.find((fr) => fr.order === order));
      const out = {
        kind: g.kind, label: g.label, messages: g.messages,
        x: sx(g.left), y: round(g.y), width: round(g.right - g.left), height: round(g.height),
        tab: g.tab,
      };
      if (g.label !== null) {
        out.labelBox = { x: sx(g.left + g.tab.width + TAB_LABEL_GAP), y: round(g.y), width: round(g.labelWidth), height: FRAME_TAB_HEIGHT };
      }
      return out;
    }),
    notes: notes.map(({ left, right, y, height, ...n }) => ({
      text: n.text, lines: n.lines, over: n.over, after: n.after,
      x: sx(left), y: round(y), width: round(right - left), height,
    })),
    rows: row,
  };
}

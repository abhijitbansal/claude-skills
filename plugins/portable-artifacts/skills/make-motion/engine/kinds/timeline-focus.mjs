// The focus timeline (look.kinds.timeline.focusWide, keynote at 16:9; gate-keynote-2 ruling 2): the line across the
// room's full width with every date over its tick, set large, the date being spoken in ink and the rest in ink2; under
// the line the spoken event's words alone, as large as the dates, changing as each event is spoken. The title sits over
// it small (a step under the events), so the events are the hero while they are spoken. Pure and DOM-free.
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';
import { layoutText } from '../text/layout.mjs';
import { colourOf, polyline } from '../devices/shared.mjs';
import { fontFor, sizeAt, setCase, CAP_HEIGHT, WORD_DESCENT } from './shared.mjs';

const HALF = 2;

// The event's words fully on from its arrival (the first on frame 0) to the next arrival, crossing over `dur`.
function shownTrack(times, k, dur) {
  const keys = k === 0 ? [{ t: 0, v: 1 }] : [{ t: 0, v: 0 }, { t: times[k] - dur, v: 0 }, { t: times[k], v: 1 }];
  if (times[k + 1] !== undefined) keys.push({ t: times[k + 1] - dur, v: 1 }, { t: times[k + 1], v: 0 });
  return track(keys);
}

// The date's colour: ink while its event is spoken, ink2 otherwise (OKLab mixes, the look's emphasize move).
function dateFill(look, times, k) {
  const { ink, ink2 } = look.palette;
  const { dur, ease } = look.moves.emphasize;
  const keys = k === 0 ? [{ t: 0, v: ink }] : [{ t: 0, v: ink2 }, { t: times[k] - dur, v: ink2 }, { t: times[k], v: ink, ease }];
  if (times[k + 1] !== undefined) keys.push({ t: times[k + 1] - dur, v: ink }, { t: times[k + 1], v: ink2, ease });
  return track(keys, { space: look.colorSpace });
}

// A text in one colour, or with every word on the colour track `fill`
function textNode(id, layout, font, x, y, fill, role, tracks = {}) {
  const plain = typeof fill === 'string';
  const words = plain ? {} : { wordTracks: layout.lines.flatMap((l) => l.words).map(() => ({ fill })) };
  return node('text', id, { x, y, layout, font, fill: plain ? fill : fill.points[0].v, role }, { tracks, ...words });
}

// The parts' sizes: the events at data.focusWide.step in their faces, the title at titleStep, every caption fitted to the
// room's width in at most `lines` lines (stepping down to minStep when one will not fit).
function setParts(shot, ctx, room) {
  const { look, unit, measure, data } = ctx;
  const f = data.focusWide;
  const dateFont = fontFor(look, 'display', sizeAt(look, f.step, unit), unit);
  const dates = shot.events.map((e) => layoutText({ text: setCase(look, 'display', e.when), font: dateFont, maxWidth: 1e6, measure }));
  const captionAt = (step) => {
    const font = fontFor(look, data.whatFace ?? 'text', sizeAt(look, step, unit), unit);
    return { font, layouts: shot.events.map((e) => layoutText({ text: setCase(look, 'text', e.what), font, maxWidth: room.w, measure })) };
  };
  const steps = Array.from({ length: f.step - f.minStep + 1 }, (_, i) => f.step - i);
  const caption = steps.map(captionAt).find((c) => c.layouts.every((l) => l.lines.length <= f.lines)) ?? captionAt(f.minStep);
  const titleFont = fontFor(look, 'display', sizeAt(look, f.titleStep, unit), unit);
  const title = shot.title === undefined ? null : layoutText({ text: setCase(look, 'display', shot.title), font: titleFont, maxWidth: room.w, measure });
  return { dateFont, dates, caption, titleFont, title };
}

const blockH = (layout, size) => layout.lines.at(-1).y - layout.lines[0].y + (CAP_HEIGHT + WORD_DESCENT) * size;

/** The focus timeline in `room` ({ x, y, w, h }) at the arrival `times`: { nodes, boxes, hero }. */
export function focusTimeline(shot, ctx, room, times) {
  const { look, unit, data } = ctx;
  const f = data.focusWide;
  const n = shot.events.length;
  const parts = setParts(shot, ctx, room);
  const gap = f.gap * unit, lineGap = f.lineGap * unit;
  const titleH = parts.title === null ? 0 : blockH(parts.title, parts.titleFont.size) + gap;
  const dateH = (CAP_HEIGHT + WORD_DESCENT) * parts.dateFont.size;
  const captionH = Math.max(...parts.caption.layouts.map((l) => blockH(l, parts.caption.font.size)));
  const total = titleH + dateH + HALF * lineGap + captionH;
  const top = room.y + (room.h - total) / HALF;
  const lineY = top + titleH + dateH + lineGap;
  const column = room.w / n;
  const rule = colourOf(look, data.line), width = data.lineWidth * unit, tick = data.tick * unit;
  const line = node('path', `${shot.id}.line`, { d: polyline([[room.x, lineY], [room.x + room.w, lineY]]), stroke: rule, strokeWidth: width, lineCap: 'round' });
  const ticks = shot.events.map((_, k) => node('path', `${shot.id}.tick${k}`, { d: polyline([[room.x + k * column, lineY - tick], [room.x + k * column, lineY + tick]]), stroke: rule, strokeWidth: width, lineCap: 'round' }));
  const dateBase = top + titleH + CAP_HEIGHT * parts.dateFont.size;
  const captionTop = lineY + lineGap;
  const { dur } = look.moves.emphasize;
  const events = shot.events.map((_, k) => {
    const x = room.x + k * column + data.inset * unit;
    const date = parts.dates[k], cap = parts.caption.layouts[k], size = parts.caption.font.size;
    const when = textNode(`${shot.id}.when${k}`, date, parts.dateFont, x, dateBase - date.lines[0].y, dateFill(look, times, k), 'hero');
    const what = textNode(`${shot.id}.what${k}`, cap, parts.caption.font, room.x, captionTop + CAP_HEIGHT * size - cap.lines[0].y, look.palette.ink, 'body', { opacity: shownTrack(times, k, dur) });
    return node('group', `${shot.id}.event${k}`, {}, { children: [when, what] });
  });
  const title = parts.title === null ? [] : [textNode(`${shot.id}.title`, parts.title, parts.titleFont, room.x, top + CAP_HEIGHT * parts.titleFont.size - parts.title.lines[0].y, look.palette.ink, 'title')];
  const boxes = Object.fromEntries(shot.events.map((_, k) => [`event:${k}`, [room.x + k * column, top + titleH, column, lineY + lineGap + captionH - (top + titleH)]]));
  return { nodes: [line, ...ticks, ...events, ...title], boxes, hero: `${shot.id}.event0` };
}

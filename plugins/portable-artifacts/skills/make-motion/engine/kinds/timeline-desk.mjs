// The `timeline` kind in an editorial look (desk): a ruled line with a tick per event, spaced by date when every event
// is a date (with room for each event's words), evenly otherwise (sequence, not scale). 16:9: the line across the grid, one column per event, `when` above the line and `what` below. 9:16: the line
// down the left of the room and the events stacked beside it, one slot each. The line and its ticks are there from frame
// 0 and each event's words arrive on it; the event being spoken is in ink and earlier ones turn ink2 when the next arrives (word fill tracks); the
// highlighted event is ink again once all have arrived. Pure and DOM-free.
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';
import { colourOf, polyline, softRoundedRect } from '../devices/shared.mjs';
import { circlePath } from '../devices/sun.mjs';
import { isWide } from './shared.mjs';
import { arrivalTrack } from './arrivals.mjs';
import { dateValues, spreadPositions } from './timeline-dates.mjs';

const HALF = 2;

// A text whose words are ink while `lit` (the event current, or highlighted at the end) and ink2 otherwise.
// `role`: a date and a sentence are two parts, not lines of one stack (the look bar's stretch check reads roles).
function eventText(id, layout, font, [x, y], fills, role) {
  const words = layout.lines.flatMap((l) => l.words);
  return node('text', id, { x, y, layout, font, fill: fills.points[0].v, role }, { wordTracks: words.map(() => ({ fill: fills })) });
}

// The colour track of event k: ink from its arrival until the next arrives, then ink2; ink again from the last arrival
// when it is the highlighted event.
function inkTrack(look, times, k, highlighted) {
  const { ink, ink2 } = look.palette;
  const next = times[k + 1];
  const keys = [{ t: 0, v: ink }];
  if (next !== undefined) keys.push({ t: next, v: ink }, { t: next, v: ink2 });
  if (highlighted && next !== undefined) keys.push({ t: times.at(-1), v: ink2 }, { t: times.at(-1), v: ink });
  return track(keys);
}

// The colour track of event k when every event is set from frame 0 (data.previews): ink2 until it is spoken, ink until
// the next is, ink2 after; the first in ink on frame 0. Mixed in the look's colour space over its emphasize move.
function previewTrack(look, times, k) {
  const { ink, ink2 } = look.palette;
  const { dur, ease } = look.moves.emphasize;
  const keys = k === 0 ? [{ t: 0, v: ink }] : [{ t: 0, v: ink2 }, { t: times[k], v: ink2 }, { t: times[k] + dur, v: ink, ease }];
  if (times[k + 1] !== undefined) keys.push({ t: times[k + 1], v: ink }, { t: times[k + 1] + dur, v: ink2, ease });
  return track(keys, { space: look.colorSpace });
}

// The tick positions and the text corner of each event: across a wide frame, down a tall one. Dated events sit by date
// between the even layout's first and last places, each far enough from the one before for its words
// (timeline-dates.mjs); undated ones keep the even columns or slots.
function placesOf(ctx, area, fit, n, values) {
  const { data, unit } = ctx;
  if (isWide(ctx.canvas)) {
    const gap = data.gap * unit, cw = (area.w - (n - 1) * gap) / n;
    const whenH = Math.max(...fit.when.map((l) => l.height)), whatH = Math.max(...fit.what.map((l) => l.height));
    const half = data.lineGap * unit;
    const lineY = area.y + (area.h - (whenH + whatH + HALF * half)) / HALF + whenH + half;
    const room = fit.when.slice(0, -1).map((w, k) => data.inset * unit + Math.max(w.width, fit.what[k].width) + gap);
    const xs = spreadPositions(values, area.x, area.x + (n - 1) * (cw + gap), room);
    return fit.when.map((w, k) => {
      const x = xs[k];
      return { tick: [x, lineY], when: [x + data.inset * unit, lineY - half - w.height], what: [x + data.inset * unit, lineY + half] };
    });
  }
  const lineX = area.x + data.lineX * unit, slot = area.h / n;
  const blockH = fit.when.map((w, k) => w.height + data.partGap * unit + fit.what[k].height);
  const room = blockH.slice(0, -1).map((h, k) => (h + blockH[k + 1]) / HALF + data.gap * unit);
  const ys = spreadPositions(values, area.y + slot / HALF, area.y + area.h - slot / HALF, room);
  return fit.when.map((w, k) => {
    const y = ys[k];
    const top = y - (w.height + data.partGap * unit + fit.what[k].height) / HALF;
    const x = lineX + data.textGap * unit;
    return { tick: [lineX, y], when: [x, top], what: [x, top + w.height + data.partGap * unit] };
  });
}

// data.discs (cosmos: { radius, line, glow: { reach, alpha, color } } units): an event's tick is a disc node on the line, in
// the line's colour and gold (a second disc fading in over it) while the event is spoken, with a screened halo on while it
// is spoken (the motif: light marks the active item), over the look's emphasize move like the words' colour.
function discNode(shot, ctx, k, [x, y], times) {
  const { look, unit, data } = ctx;
  const { radius, glow } = data.discs;
  const r = radius * unit, accent = colourOf(look, glow.color), off = colourOf(look, data.line);
  const { dur, ease } = look.moves.emphasize;
  const at = (v, w) => (k === 0 ? [{ t: 0, v }] : [{ t: 0, v: w }, { t: times[k], v: w }, { t: times[k] + dur, v, ease }]);
  const after = (v, w) => (times[k + 1] === undefined ? [] : [{ t: times[k + 1], v }, { t: times[k + 1] + dur, v: w, ease }]);
  const glowTrack = track([...at(1, 0), ...after(1, 0)]);
  const halo = softRoundedRect({ id: `${shot.id}.disc${k}.halo`, rect: [-r, -r, HALF * r, HALF * r], pill: true, reach: glow.reach * unit, alpha: glow.alpha, fill: accent, props: { blend: 'screen' }, opts: { tracks: { opacity: glowTrack } } });
  const body = node('path', `${shot.id}.disc${k}.body`, { d: circlePath(r), fill: off });
  const lit = node('path', `${shot.id}.disc${k}.lit`, { d: circlePath(r), fill: accent }, { tracks: { opacity: glowTrack } });
  return node('group', `${shot.id}.disc${k}`, { x, y }, { children: [halo, body, lit] });
}

/** The desk timeline's nodes and boxes in `area` from the fitted sizes `fit` and arrival times. */
export function deskTimeline(shot, ctx, area, fit, times) {
  const { look, unit, data } = ctx;
  const n = shot.events.length;
  const wide = isWide(ctx.canvas);
  const places = placesOf(ctx, area, fit, n, dateValues(shot.events));
  const rule = colourOf(look, data.line), width = data.lineWidth * unit, tick = data.tick * unit;
  // the line runs the room's whole width (wide) or height (tall): time goes on past the first and last events, and a
  // tall frame with two events is still composed top to bottom
  const ends = wide ? [[area.x, places[0].tick[1]], [area.x + area.w, places[0].tick[1]]] : [[places[0].tick[0], area.y], [places[0].tick[0], area.y + area.h]];
  // the line and every tick are there from frame 0, the scale the events arrive on (gate-kinds-b-1: a first beat of
  // one month on an empty rule read as an unfinished frame); each event's words arrive on its sentence
  const line = node('path', `${shot.id}.line`, { d: polyline(ends), stroke: rule, strokeWidth: width, lineCap: 'round' });
  const marks = places.map((p, k) => {
    const [x, y] = p.tick;
    if (data.discs) return discNode(shot, ctx, k, p.tick, times);
    return node('path', `${shot.id}.tick${k}`, { d: wide ? polyline([[x, y - tick], [x, y + tick]]) : polyline([[x - tick, y], [x + tick, y]]), stroke: rule, strokeWidth: width, lineCap: 'round' });
  });
  // data.previews (ledger, gate-ledger-2 ruling 3): every event set from frame 0 in ink2, the one being spoken in ink
  const events = places.map((p, k) => {
    const fills = data.previews ? previewTrack(look, times, k) : inkTrack(look, times, k, shot.highlight === k + 1);
    const when = eventText(`${shot.id}.when${k}`, fit.when[k], fit.whenFont, p.when, fills, 'hero');
    const what = eventText(`${shot.id}.what${k}`, fit.what[k], fit.whatFont, p.what, fills, 'body');
    return node('group', `${shot.id}.event${k}`, {}, { tracks: { opacity: arrivalTrack(data.previews ? 0 : times[k]) }, children: [when, what] });
  });
  const boxes = Object.fromEntries(places.map((p, k) => {
    const w = Math.max(fit.when[k].width, fit.what[k].width), h = p.what[1] + fit.what[k].height - p.when[1];
    return [`event:${k}`, [p.when[0], p.when[1], w, h]];
  }));
  return { nodes: [line, ...marks, ...events], boxes, hero: `${shot.id}.event0` };
}

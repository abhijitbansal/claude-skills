// The `timeline` kind in an editorial look (desk): a ruled line with a tick per event, evenly spaced (sequence, not
// scale). 16:9: the line across the grid, one column per event, `when` above the line and `what` below. 9:16: the line
// down the left of the room and the events stacked beside it, one equal slot each. The line draws on to each event as it
// arrives; the event being spoken is in ink and earlier ones turn ink2 when the next arrives (word fill tracks); the
// highlighted event is ink again once all have arrived. Pure and DOM-free.
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';
import { colourOf, polyline, isHand } from '../devices/shared.mjs';
import { isWide } from './shared.mjs';
import { arrivalTrack } from './arrivals.mjs';

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

// The line's drawn share: tick 0's share on frame 0, reaching tick k's share as event k arrives and the whole line with
// the last (the look's draw move); `shares[k]` is tick k's place along the line, 0 to 1.
function lineDraw(look, times, shares) {
  const step = isHand(look) ? look.moves.draw.step : undefined;
  const keys = [{ t: 0, v: shares[0] }];
  times.slice(1).forEach((at, k) => {
    const start = Math.max(keys.at(-1).t, at - look.moves.draw.dur);
    keys.push({ t: start, v: shares[k] }, { t: at, v: k + 1 === times.length - 1 ? 1 : shares[k + 1], ease: look.moves.draw.ease });
  });
  return { track: track(keys), step };
}

// The tick positions and the text corner of each event: across a wide frame, down a tall one.
function placesOf(ctx, area, fit, n) {
  const { data, unit } = ctx;
  if (isWide(ctx.canvas)) {
    const gap = data.gap * unit, cw = (area.w - (n - 1) * gap) / n;
    const whenH = Math.max(...fit.when.map((l) => l.height)), whatH = Math.max(...fit.what.map((l) => l.height));
    const half = data.lineGap * unit;
    const lineY = area.y + (area.h - (whenH + whatH + HALF * half)) / HALF + whenH + half;
    return fit.when.map((w, k) => {
      const x = area.x + k * (cw + gap);
      return { tick: [x, lineY], when: [x + data.inset * unit, lineY - half - w.height], what: [x + data.inset * unit, lineY + half] };
    });
  }
  const lineX = area.x + data.lineX * unit, slot = area.h / n;
  return fit.when.map((w, k) => {
    const y = area.y + (k + 1 / HALF) * slot;
    const top = y - (w.height + data.partGap * unit + fit.what[k].height) / HALF;
    const x = lineX + data.textGap * unit;
    return { tick: [lineX, y], when: [x, top], what: [x, top + w.height + data.partGap * unit] };
  });
}

/** The desk timeline's nodes and boxes in `area` from the fitted sizes `fit` and arrival times. */
export function deskTimeline(shot, ctx, area, fit, times) {
  const { look, unit, data } = ctx;
  const n = shot.events.length;
  const wide = isWide(ctx.canvas);
  const places = placesOf(ctx, area, fit, n);
  const rule = colourOf(look, data.line), width = data.lineWidth * unit, tick = data.tick * unit;
  // the line runs the room's whole width (wide) or height (tall): time goes on past the first and last events, and a
  // tall frame with two events is still composed top to bottom
  const ends = wide ? [[area.x, places[0].tick[1]], [area.x + area.w, places[0].tick[1]]] : [[places[0].tick[0], area.y], [places[0].tick[0], area.y + area.h]];
  const shares = places.map((p) => (wide ? (p.tick[0] - area.x) / area.w : (p.tick[1] - area.y) / area.h));
  const draw = lineDraw(look, times, shares);
  const line = node('path', `${shot.id}.line`, { d: polyline(ends), stroke: rule, strokeWidth: width, lineCap: 'round' }, { tracks: { draw: draw.track }, step: draw.step });
  const events = places.map((p, k) => {
    const [x, y] = p.tick;
    const mark = node('path', `${shot.id}.tick${k}`, { d: wide ? polyline([[x, y - tick], [x, y + tick]]) : polyline([[x - tick, y], [x + tick, y]]), stroke: rule, strokeWidth: width, lineCap: 'round' });
    const fills = inkTrack(look, times, k, shot.highlight === k + 1);
    const when = eventText(`${shot.id}.when${k}`, fit.when[k], fit.whenFont, p.when, fills, 'hero');
    const what = eventText(`${shot.id}.what${k}`, fit.what[k], fit.whatFont, p.what, fills, 'body');
    return node('group', `${shot.id}.event${k}`, {}, { tracks: { opacity: arrivalTrack(times[k]) }, children: [mark, when, what] });
  });
  const boxes = Object.fromEntries(places.map((p, k) => {
    const w = Math.max(fit.when[k].width, fit.what[k].width), h = p.what[1] + fit.what[k].height - p.when[1];
    return [`event:${k}`, [p.when[0], p.when[1], w, h]];
  }));
  return { nodes: [line, ...events], boxes, hero: `${shot.id}.event0` };
}

// The `timeline` kind in a one-at-a-time look (pop): one event on screen at a time, `when` large in the accent over
// `what` in the text face, with a progress rail along the room's edge (down the right of a tall frame, along the
// bottom of a wide one): a rule with one dot per event, the current dot lit in the accent and the highlighted event's
// dot ringed, so the place in the sequence is always shown. Pure and DOM-free.
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';
import { colourOf, polyline } from '../devices/shared.mjs';
import { isWide } from './shared.mjs';

const HALF = 2;
const BEZIER_CIRCLE = 0.5523;

function disc(x, y, r) {
  const k = BEZIER_CIRCLE * r;
  const f = (v) => Math.round(v * 10) / 10;
  const p = (a, b) => `${f(a)} ${f(b)}`;
  return `M${p(x, y - r)}C${p(x + k, y - r)} ${p(x + r, y - k)} ${p(x + r, y)}C${p(x + r, y + k)} ${p(x + k, y + r)} ${p(x, y + r)}`
    + `C${p(x - k, y + r)} ${p(x - r, y + k)} ${p(x - r, y)}C${p(x - r, y - k)} ${p(x - k, y - r)} ${p(x, y - r)}Z`;
}

// 1 inside [from, to), 0 outside, as step keys (shown from frame 0 when `from` is 0).
function windowed(from, to) {
  const keys = from <= 0 ? [{ t: 0, v: 1 }] : [{ t: 0, v: 0 }, { t: from, v: 0 }, { t: from, v: 1 }];
  return track(to === undefined ? keys : [...keys, { t: to, v: 1 }, { t: to, v: 0 }]);
}

// The rail: its rule from end to end of the room's edge and a dot per event, evenly spaced.
function railNodes(shot, ctx, room, times) {
  const { look, unit, data } = ctx;
  const n = times.length, r = data.dot * unit, wide = isWide(ctx.canvas);
  const at = (k) => (wide
    ? [room.x + (k + 1 / HALF) * (room.w / n), room.y + room.h - r]
    : [room.x + room.w - r, room.y + (k + 1 / HALF) * (room.h / n)]);
  const ends = wide ? [[room.x, room.y + room.h - r], [room.x + room.w, room.y + room.h - r]] : [[room.x + room.w - r, room.y], [room.x + room.w - r, room.y + room.h]];
  const rule = node('path', `${shot.id}.rail.rule`, { d: polyline(ends), stroke: colourOf(look, data.rule), strokeWidth: data.ruleWidth * unit });
  const dots = times.flatMap((t, k) => {
    const [x, y] = at(k);
    const ring = shot.highlight === k + 1 ? [node('path', `${shot.id}.rail.ring${k}`, { d: disc(x, y, r * data.ring), stroke: colourOf(look, data.lit), strokeWidth: data.ruleWidth * unit })] : [];
    return [...ring,
      node('path', `${shot.id}.rail.dot${k}`, { d: disc(x, y, r), fill: colourOf(look, data.dotFill) }),
      node('path', `${shot.id}.rail.lit${k}`, { d: disc(x, y, r), fill: colourOf(look, data.lit) }, { tracks: { opacity: windowed(t, times[k + 1]) } })];
  });
  return node('group', `${shot.id}.rail`, {}, { children: [rule, ...dots] });
}

/** The pop timeline's nodes and boxes: each event alone while current, in `area` beside the rail in `room`. */
export function popTimeline(shot, ctx, { room, area }, fit, times) {
  const { look, unit, data } = ctx;
  const events = shot.events.map((_, k) => {
    const w = fit.when[k], t = fit.what[k];
    const h = w.height + data.partGap * unit + t.height;
    // a tall frame sets each event beside its own dot on the rail (kept inside the area), so the text travels down the
    // frame as the sequence goes on (a block held at the stack's centre left the lower band empty); a wide one centres it
    const dotY = area.y + (k + 1 / HALF) * (area.h / shot.events.length);
    const top = isWide(ctx.canvas) ? area.y + (area.h - h) / HALF : Math.min(Math.max(area.y, dotY - h / HALF), area.y + area.h - h);
    const when = node('text', `${shot.id}.when${k}`, { x: area.x, y: top, layout: w, font: fit.whenFont, fill: colourOf(look, data.when), role: 'hero' });
    const what = node('text', `${shot.id}.what${k}`, { x: area.x, y: top + w.height + data.partGap * unit, layout: t, font: fit.whatFont, fill: colourOf(look, data.what), role: 'body' });
    return { group: node('group', `${shot.id}.event${k}`, {}, { tracks: { opacity: windowed(times[k], times[k + 1]) }, children: [when, what] }), box: [area.x, top, Math.max(w.width, t.width), h] };
  });
  return {
    nodes: [railNodes(shot, ctx, room, times), ...events.map((e) => e.group)],
    boxes: Object.fromEntries(events.map((e, k) => [`event:${k}`, e.box])),
    hero: `${shot.id}.event0`,
  };
}

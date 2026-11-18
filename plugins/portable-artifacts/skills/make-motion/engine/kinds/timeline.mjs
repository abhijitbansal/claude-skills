// The `timeline` kind: two to six events, each a `when` shown as written and a `what`, drawn in the order given and
// evenly spaced: the line shows sequence, not scale (a line to scale would need parsed dates). Events arrive one per
// sentence when the counts match, else spread over the words, else evenly; the first on frame 0 (timeline-fit.mjs).
// Events: `event`. `on` targets: `event:<n>` (n counts from 0, as events[n]); `highlight` is an event's 1-based number.
// desk draws a ruled line with ticks (timeline-desk.mjs), pop one event at a time with a progress rail
// (timeline-pop.mjs). `when` is set three times `what`; where the events cannot hold that at the format's floor, the
// review says so, estimated from look data (kinds.timeline.advance) as the page is not there. Pure and DOM-free.
import { registries } from '../registry.mjs';
import { kindData, kindSupportProblems, supportsKind } from '../looks/index.mjs';
import { fieldNode, onDevices, placeDevices, deviceCamera, NOT_BLANK, assertNoBlanks, unionBox, isEditorial, isWide, fontFor, sizeAt, setCase } from './shared.mjs';
import { layoutText } from '../text/layout.mjs';
import { node } from '../graph/node.mjs';
import { defaultCamera } from './camera.mjs';
import { roomOf, editorialLeft } from './arrivals.mjs';
import { eventTimes, eventRoom, fitEvents, floorStep } from './timeline-fit.mjs';
import { deskTimeline } from './timeline-desk.mjs';
import { popTimeline } from './timeline-pop.mjs';
import { focusTimeline } from './timeline-focus.mjs';
import { plainTag } from './plain-tag.mjs';
import { unmarked } from './shared.mjs';

const KIND = 'timeline';
const WHEN_MAX = 14;
const WHAT_MAX = 60;
const TITLE_MAX = 60;
const TITLE_LINES = 2;
const HALF = 2;

function timelineProblems(shot, { look } = {}) {
  const n = (shot.events ?? []).length;
  const hl = shot.highlight !== undefined && !(Number.isInteger(shot.highlight) && shot.highlight >= 1 && shot.highlight <= n)
    ? [{ path: 'highlight', message: `no event ${shot.highlight}: the events are numbered 1 to ${n}` }] : [];
  return [...kindSupportProblems(KIND, look), ...hl];
}

// The title over the timeline: a display heading at the largest of titleSteps in TITLE_LINES (desk), or a plain tag
// stepping down to the floor (pop). -> { nodes, h }.
function titleOf(shot, ctx, room) {
  if (shot.title === undefined) return { nodes: [], h: 0 };
  const { look, unit, data } = ctx;
  if (isEditorial(look)) {
    const sets = [...data.titleSteps].sort((a, b) => b - a).map((s) => {
      const font = fontFor(look, 'display', sizeAt(look, s, unit), unit);
      return { font, layout: layoutText({ text: setCase(look, 'display', shot.title), font, maxWidth: room.w, measure: ctx.measure }) };
    });
    const set = sets.find((s) => s.layout.lines.length <= TITLE_LINES) ?? sets.at(-1);
    return { nodes: [node('text', `${shot.id}.title`, { x: room.x, y: room.y, layout: set.layout, font: set.font, fill: look.palette.ink, role: 'hero' })], h: set.layout.height, size: set.font.size };
  }
  const style = look.devices.tag ?? {};
  const made = plainTag(ctx, `${shot.id}.title`, shot.title, { left: room.x, top: room.y, maxWidth: room.w, at: 0, fromStep: floorStep(ctx.canvas), toStep: Math.max(...data.titleSteps), fill: style.fill ?? 'ink', text: style.text ?? 'paper', snap: true });
  return { nodes: made.nodes, h: made.box[3] };
}

function expandTimeline(shot, ctx) {
  assertNoBlanks(shot, KIND);
  const { look, timing, unit, canvas } = ctx;
  const data = kindData(look, KIND);
  const c = { ...ctx, data };
  const room = roomOf(ctx);
  // data.focusWide (keynote at 16:9, gate-keynote-2 ruling 2): the full-width focus timeline, its own small title
  if (isEditorial(look) && isWide(canvas) && data.focusWide !== undefined) return focusExpand(shot, ctx, c, room);
  const title = titleOf(shot, c, room);
  const top = room.y + title.h + (title.h > 0 ? data.titleGap * unit : 0);
  const area = { x: room.x, y: top, w: room.w, h: room.y + room.h - top };
  const n = shot.events.length;
  const fit = fitEvents(shot.events, { look, data, unit, measure: ctx.measure, room: eventRoom(look, data, canvas, area, n, unit), floorStep: floorStep(canvas), titleSize: title.size });
  const times = eventTimes(shot, timing);
  const laid = isEditorial(look) ? deskTimeline(shot, c, area, fit, times) : popTimeline(shot, c, { room: area, area: popArea(area, data, canvas, unit) }, fit, times);
  const boxes = { events: unionBox(Object.values(laid.boxes)), ...laid.boxes };
  const devices = onDevices(shot, ctx, { boxes, defaultTarget: 'events' });
  return {
    nodes: placeDevices([fieldNode(shot, ctx), ...laid.nodes, ...title.nodes], devices),
    camera: [...defaultCamera(look, timing, unit), ...deviceCamera(devices)],
    boxes, hero: laid.hero, background: look.palette.paper,
  };
}

function focusExpand(shot, ctx, c, room) {
  const { look, timing, unit, canvas } = ctx;
  // the full width inside the grid's margins (the editorial room starts a column in)
  const margin = look.grid.margin * unit;
  const full = { ...room, x: margin, w: canvas.w - HALF * margin };
  const laid = focusTimeline(shot, c, full, eventTimes(shot, timing));
  const boxes = { events: unionBox(Object.values(laid.boxes)), ...laid.boxes };
  const devices = onDevices(shot, ctx, { boxes, defaultTarget: 'events' });
  return {
    nodes: placeDevices([fieldNode(shot, ctx), ...laid.nodes], devices),
    camera: [...defaultCamera(look, timing, unit), ...deviceCamera(devices)],
    boxes, hero: laid.hero, background: look.palette.paper,
  };
}

// The block beside pop's rail: the area less the rail's band (left of a tall frame, bottom of a wide one).
function popArea(area, data, canvas, unit) {
  const rail = data.rail * unit;
  return isWide(canvas) ? { ...area, h: area.h - rail } : { ...area, x: area.x + rail, w: area.w - rail };
}

// An estimate of the page's measure from the look's average advance (em per character), for the review.
const estimate = (advance) => (text, font) => {
  const width = [...text].length * font.size * advance;
  return { width, ascent: font.size * 0.8, descent: font.size * 0.2, inkAscent: font.size * 0.74, inkDescent: 0, inkLeft: 0, inkRight: width };
};

// Events that cannot hold `when` at three times `what` at the format's floor: a finding at the longest `when`.
function timelineReview(shot, { look, canvas } = {}) {
  if (!look || !canvas || !supportsKind(look, KIND) || !Array.isArray(shot.events)) return [];
  const data = kindData(look, KIND);
  const unit = Math.min(canvas.w, canvas.h) / 1080;
  const margin = look.grid.margin * unit;
  const band = !isWide(canvas) && look.band ? [look.band.top * canvas.h, look.band.bottom * canvas.h] : [margin, canvas.h - margin];
  const titleSize = sizeAt(look, Math.max(...data.titleSteps), unit);
  const titleLines = shot.title === undefined ? 0 : Math.min(TITLE_LINES, Math.ceil((shot.title.length * titleSize * data.advance) / (canvas.w - HALF * margin)));
  const titleH = titleLines === 0 ? 0 : titleLines * titleSize * look.lineHeight.display + data.titleGap * unit;
  const left = editorialLeft(look, canvas, unit); // the kind's room (arrivals.mjs roomOf)
  const area = { x: left, y: band[0] + titleH, w: canvas.w - HALF * left, h: band[1] - band[0] - titleH };
  const room = eventRoom(look, data, canvas, area, shot.events.length, unit);
  if (fitEvents(shot.events, { look, data, unit, measure: estimate(data.advance), room, floorStep: floorStep(canvas), titleSize: titleLines === 0 ? undefined : titleSize }).fits) return [];
  const i = shot.events.reduce((best, e, k) => (e.when.length > shot.events[best].when.length ? k : best), 0);
  const format = isWide(canvas) ? '16:9' : '9:16';
  return [{ path: `events[${i}].when`, at: 0, message: `at ${format} in the ${look.name} look ${shot.events.length} events cannot hold their dates at three times the text: cut an event or shorten events[${i}].when` }];
}

function timelineField(shot, id) {
  const rest = id.startsWith(`${shot.id}.`) ? id.slice(shot.id.length + 1) : null;
  if (rest === null) return undefined;
  if (/^title(\.|$)/.test(rest)) return 'title';
  if (/^(when|what)\d+$/.test(rest)) return 'events';
  return /^(event\d+|tick\d+|line|rail)/.test(rest) ? null : undefined;
}

const EVENT = { type: 'object', additionalProperties: false, required: ['when', 'what'], properties: { when: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: WHEN_MAX }, what: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: WHAT_MAX } } };

registries.kinds.add(KIND, {
  summary: 'Two to six events in the order given: spaced by date when every `when` is a date (a month, a year, "Mar 2024", "2024-03"), with room for each event\'s words, else evenly (sequence, not scale). Each event is a date shown as written over what happened, arriving one per sentence: a ruled line that draws on with earlier events dimmed (desk), or one event at a time with a progress rail (pop).',
  example: {
    id: 'history', show: KIND, say: 'We sketched it. Then a beta. Then a million users.',
    events: [{ when: '2019', what: 'First sketch' }, { when: '2021', what: 'Open beta' }, { when: '2023', what: 'One million users' }],
  },
  schema: {
    required: ['events'],
    properties: {
      events: { type: 'array', minItems: 2, maxItems: 6, items: EVENT },
      title: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: TITLE_MAX },
      highlight: { type: 'integer', minimum: 1 },
    },
  },
  srcFields: [],
  steeringFields: ['highlight'],
  heroTarget: 'events',
  targets: (shot) => ['events', ...(shot.events ?? []).map((_, k) => `event:${k}`)],
  ids: (shot) => [`${shot.id}.event0`],
  nodeField: timelineField,
  validate: timelineProblems,
  review: timelineReview,
  expand: (shot, ctx) => expandTimeline(unmarked(shot), ctx),
  arrivals: eventTimes,
  eventDevices: Object.freeze(['event']),
  events: (shot, timing) => eventTimes(shot, timing).slice(1).map((t) => ({ kind: 'device', device: 'event', t })),
  lookData: true,
  numbered: false,
  showsWords: true,
});

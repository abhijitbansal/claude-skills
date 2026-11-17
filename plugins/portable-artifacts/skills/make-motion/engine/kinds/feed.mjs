// The `feed` kind (plan 2026-11-16-pa2-shot-kinds-b, Task 9): a chat thread (`me` and `them` bubbles) or a stack of
// notifications (an app's coloured disc with its initial, its name, the text), two to six items arriving one per
// sentence, else evenly; the first on frame 0; in chat a `them` message is led by typing dots for 0.4 s. All text is one
// size (feed-layout.mjs). desk: paper slips; pop: thick-outlined bubbles. No pictures in items: a sender is told by
// side and colour, an app by its disc. Events: `message`. `on` targets: `item:<n>` (n counts from 0, as items[n]).
// The frames are the look's own: nothing imitates a named platform's interface. Pure and DOM-free.
import { registries } from '../registry.mjs';
import { kindData, kindSupportProblems } from '../looks/index.mjs';
import { fieldNode, onDevices, placeDevices, deviceCamera, NOT_BLANK, assertNoBlanks, unionBox } from './shared.mjs';
import { defaultCamera } from './camera.mjs';
import { roomOf, latestLanding } from './arrivals.mjs';
import { feedLayout, feedTimes } from './feed-layout.mjs';
import { unmarked } from './shared.mjs';

const KIND = 'feed';
const TEXT_MAX = 90; // characters: four lines hold at least 100 at 9:16 in both looks (measured advances, kinds-feed-browser)
const APP_MAX = 20;
const TITLE_MAX = 30;
const STYLE_KEYS = Object.freeze({ chat: 'from', notifications: 'app' });

function feedProblems(shot, { look } = {}) {
  const style = shot.style ?? 'chat';
  const want = STYLE_KEYS[style];
  const other = Object.values(STYLE_KEYS).find((k) => k !== want);
  const items = Array.isArray(shot.items) ? shot.items : [];
  const wrong = items.flatMap((item, i) => [
    ...(item?.[other] !== undefined ? [{ path: `items[${i}].${other}`, message: `belongs to the ${style === 'chat' ? 'notifications' : 'chat'} style; this feed's style is "${style}"` }] : []),
    ...(item?.[want] === undefined ? [{ path: `items[${i}]`, message: `a ${style} item needs ${want}` }] : []),
  ]);
  return [...kindSupportProblems(KIND, look), ...wrong];
}

const timesOf = (shot, timing) => feedTimes(shot.items.length, timing, latestLanding(timing));

function expandFeed(shot, ctx) {
  assertNoBlanks(shot, KIND);
  const { look, timing, unit } = ctx;
  const data = kindData(look, KIND);
  const laid = feedLayout(shot, ctx, data, roomOf(ctx), timesOf(shot, timing));
  const boxes = { items: unionBox(Object.values(laid.boxes)), ...laid.boxes };
  const devices = onDevices(shot, ctx, { boxes, defaultTarget: 'items' });
  return {
    nodes: placeDevices([fieldNode(shot, ctx), ...laid.nodes], devices),
    camera: [...defaultCamera(look, timing, unit), ...deviceCamera(devices)],
    boxes, hero: `${shot.id}.item0`, background: look.palette.paper,
  };
}

function feedField(shot, id) {
  const rest = id.startsWith(`${shot.id}.`) ? id.slice(shot.id.length + 1) : null;
  if (rest === null) return undefined;
  // the title as written, or as the slug's kicker (a look that sets it on its slug, look.kinds.feed.titleSlug)
  if (rest === 'title' || rest === 'kicker') return 'title';
  if (/^item\d+\.(text|app)$/.test(rest)) return 'items';
  return /^(thread|slug|item\d+)(\.|$)/.test(rest) ? null : undefined;
}

const TEXT = { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: TEXT_MAX };
const ITEM = {
  type: 'object', additionalProperties: false, required: ['text'],
  properties: { from: { enum: ['me', 'them'] }, app: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: APP_MAX }, text: TEXT },
};

registries.kinds.add(KIND, {
  summary: 'A chat thread (me on one side, them on the other, typing dots before a reply) or a stack of notifications (an app\'s disc, its name and the text, the newest on top), two to six items arriving one per sentence, in the look\'s own frames: paper slips (desk) or thick-outlined bubbles (pop).',
  example: {
    id: 'thread', show: KIND, title: 'Launch day',
    say: 'Is the deck ready? Almost, two slides left. Send it when it is done. Sent, have a look.',
    items: [
      { from: 'them', text: 'Is the deck ready for Friday?' },
      { from: 'me', text: 'Almost. Two slides left.' },
      { from: 'them', text: 'Send it when it is done.' },
      { from: 'me', text: 'Sent. Have a look.' },
    ],
  },
  schema: {
    required: ['items'],
    properties: {
      style: { enum: ['chat', 'notifications'] },
      items: { type: 'array', minItems: 2, maxItems: 6, items: ITEM },
      title: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: TITLE_MAX },
    },
  },
  srcFields: [],
  steeringFields: ['style'],
  heroTarget: 'items',
  targets: (shot) => ['items', ...(shot.items ?? []).map((_, k) => `item:${k}`)],
  ids: (shot) => [`${shot.id}.item0`],
  nodeField: feedField,
  validate: feedProblems,
  expand: (shot, ctx) => expandFeed(unmarked(shot), ctx),
  arrivals: timesOf,
  eventDevices: Object.freeze(['message']),
  events: (shot, timing) => timesOf(shot, timing).slice(1).map((t) => ({ kind: 'device', device: 'message', t })),
  lookData: true,
  numbered: false,
  showsWords: true,
});

// The `list` kind: points or numbered steps, one per sentence. Items arrive one per sentence of the say when the counts
// match, else spread evenly over the spoken words, else (no say) at equal intervals of the hold; the first always on the
// shot's first frame. Each arrival is a `device` event named `item` for the cue plan (the kind's `events` hook). An
// editorial composition (desk) sets the title on the slug and every arrived item down the left columns in the display
// face, the current one in ink and earlier ones in ink2, figures hanging in the margin when numbered (list-desk.mjs); a
// stack (pop) shows one item at a time as a stack under a count tag, "2 / 5" (list-pop.mjs). How each look composes it
// is look data (look.kinds.list). Its review: more than MAX_ITEMS items, or an item over MAX_WORDS words, is advice.
// Pure and DOM-free.
import { registries } from '../registry.mjs';
import { node } from '../graph/node.mjs';
import { kindData, kindSupportProblems, supportsKind } from '../looks/index.mjs';
import {
  HERO_SCHEMA, heroId, wordsOf, isEditorial, heroProblems, fieldNode, onDevices, placeDevices, deviceCamera, unionBox, NOT_BLANK, assertNoBlanks, hiddenOnFindings,
} from './shared.mjs';
import { defaultCamera } from './camera.mjs';
import { itemsOf, isNumbered } from './list-items.mjs';
import { expandDeskList } from './list-desk.mjs';
import { expandPopList } from './list-pop.mjs';

const KIND = 'list';
export const MAX_ITEMS = 6; // the review's limit; the schema allows up to ITEMS_LIMIT so the advice can be given
export const MAX_WORDS = 12; // words in one item, the review's limit
const ITEMS_LIMIT = 12;
const ITEM_MAX = 120;
const NOTE_MAX = 80;
const TITLE_MAX = 40;
const ITEM_PREFIX = 'item:';

/**
 * When each item arrives, in shot seconds: item k on sentence k when there are as many sentences as items; otherwise on
 * spoken word round(k * words / items); with no narration, or fewer spoken words than items (two items would share a
 * word and one would never be seen), at k * duration / items. The first item is always at 0, so the shot never opens on
 * an empty frame.
 */
export function listTimes(shot, timing) {
  const n = shot.items.length;
  const { words, sentences, duration } = timing;
  if (words.length < n && sentences.length !== n) return Array.from({ length: n }, (_, k) => (k * duration) / n);
  if (sentences.length === n) return sentences.map((s, k) => (k === 0 ? 0 : s.start));
  return Array.from({ length: n }, (_, k) => (k === 0 ? 0 : words[Math.min(words.length - 1, Math.round((k * words.length) / n))].start));
}

// Each `on` device, put inside the item it aims at when the composition hides items (pop: an item leaves with its
// devices), else on the frame. `wrappers`: per item { id, tracks, children } or null.
function assemble(shot, ctx, parts) {
  const devices = onDevices(shot, ctx, { boxes: parts.boxes, defaultTarget: 'items', behind: parts.behind });
  const itemOf = (target) => (typeof target === 'string' && target.startsWith(ITEM_PREFIX) ? Number(target.slice(ITEM_PREFIX.length)) : null);
  if (parts.wrappers === null) return { nodes: placeDevices([...parts.nodes, parts.group], devices), devices };
  const inside = (k) => devices.filter((d) => itemOf(d.target) === k).flatMap((d) => d.nodes);
  const children = parts.wrappers.map((w, k) => node('group', w.id, {}, { tracks: w.tracks, children: [...w.children, ...inside(k)] }));
  const group = node('group', parts.hero, {}, { children });
  const loose = devices.filter((d) => itemOf(d.target) === null);
  return { nodes: placeDevices([...parts.nodes, group], loose), devices };
}

function expandList(shot, ctx) {
  assertNoBlanks(shot, 'list'); // a blank text is the validator's to refuse; expand names it rather than failing in layout
  const { look, timing, unit } = ctx;
  const data = kindData(look, KIND);
  const times = listTimes(shot, timing);
  const hero = heroId(shot, 'items');
  const built = isEditorial(look) ? expandDeskList(shot, ctx, data, times, hero) : expandPopList(shot, ctx, data, times, hero);
  const boxes = { items: unionBox(built.itemBoxes), ...Object.fromEntries(built.itemBoxes.map((box, k) => [`${ITEM_PREFIX}${k}`, box])) };
  const behind = Object.fromEntries(Object.keys(boxes).map((target) => [target, hero]));
  const { nodes, devices } = assemble(shot, ctx, { ...built, boxes, behind, hero });
  return {
    nodes: [fieldNode(shot, ctx), ...nodes],
    camera: [...defaultCamera(look, timing, unit), ...deviceCamera(devices)],
    boxes,
    hero,
    background: look.palette.paper,
  };
}

// The field a node of the list shows, for a review finding's path (scripts/v2/review.mjs): item k (`<id>.item<k>` and
// what is inside it, a desk figure `<id>.figure<k>`), its note (`<id>.note<k>`, `<id>.item<k>.note`), or the title (the desk
// slug's kicker, a pop running head `<id>.item<k>.title`); null for the pop count tag, which no field holds as written.
function listNodeField(shot, id) {
  if (!id.startsWith(`${shot.id}.`)) return undefined;
  const rest = id.slice(shot.id.length + 1);
  const title = shot.title !== undefined ? 'title' : null;
  if (rest === 'kicker') return title;
  const part = /^(item|note|figure)(\d+)(?:\.([a-z]+))?/.exec(rest);
  if (part === null) return undefined;
  const item = `items[${part[2]}]`;
  if (part[1] === 'note' || part[3] === 'note') return `${item}.note`;
  if (part[3] === 'title') return title;
  if (part[3] === 'kicker') return null;
  const k = Number(part[2]);
  return typeof shot.items?.[k] === 'object' && shot.items[k] !== null ? `${item}.text` : item; // the text the author edits
}

// Advice about the list itself: too many items to hold, or an item too long to read as a point.
// When item `k` is on screen in shot seconds: in a stack (pop) only until the next arrives, in a column (desk) to the end.
function itemWindow(shot, timing, target, look) {
  const k = typeof target === 'string' && target.startsWith(ITEM_PREFIX) ? Number(target.slice(ITEM_PREFIX.length)) : NaN;
  if (!Number.isInteger(k)) return null;
  const times = listTimes(shot, timing);
  if (k < 0 || k >= times.length) return null;
  return [times[k], isEditorial(look) ? Infinity : (times[k + 1] ?? Infinity)];
}

function listReview(shot, { look, timing, at }) {
  const out = shot.items.length > MAX_ITEMS
    ? [{ path: 'items', at: 0, message: `${shot.items.length} items is more than a list holds; split the list (${MAX_ITEMS} at most)` }]
    : [];
  const times = listTimes(shot, timing);
  itemsOf(shot).forEach((item, k) => {
    const count = wordsOf(item.text).length;
    if (count > MAX_WORDS) out.push({ path: `items[${k}]`, at: times[k], message: `item ${k} has ${count} words; cut words (${MAX_WORDS} at most)` });
  });
  return [...out, ...undrawnFindings(shot, look), ...hiddenOnFindings(shot, { timing, at }, (target) => itemWindow(shot, timing, target, look))];
}

// What the shot asks for and an editorial look's list does not draw, as advice at the field (review C C1): a title when
// the look sets no slug for lists (the title is the slug's kicker), and numbering when it marks items with a dot rail.
function undrawnFindings(shot, look) {
  if (!look || !isEditorial(look) || !supportsKind(look, KIND)) return [];
  const data = kindData(look, KIND);
  const out = [];
  if (shot.title !== undefined && data.slug === false) {
    out.push({ path: 'title', at: 0, message: `the ${look.name} look does not draw a list's title (it sets no slug for lists): say it in the narration or a statement before the list, and leave the title out` });
  }
  if (isNumbered(shot) && data.dots) {
    out.push({ path: shot.style === 'steps' ? 'style' : 'numbered', at: 0, message: `the ${look.name} look marks list items with dots, not numbers: when the order matters, say it in the items ("First, ..."), and leave the numbering out` });
  }
  return out;
}

const ITEM_SCHEMA = Object.freeze({
  anyOf: [
    { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: ITEM_MAX },
    {
      type: 'object',
      required: ['text'],
      additionalProperties: false,
      properties: { text: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: ITEM_MAX }, note: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: NOTE_MAX } },
    },
  ],
});

registries.kinds.add(KIND, {
  summary: 'Points or numbered steps, one item per sentence: a column that builds item by item with earlier items dimmed (desk), or one item at a time as a stack under a count tag (pop). An item may carry a short note.',
  example: {
    id: 'how', show: 'list', title: 'How it works', style: 'steps',
    say: 'Write the film as JSON. Render it in one command. Share the MP4.',
    items: ['Write the film as JSON', 'Render it in one command', 'Share the MP4'],
  },
  schema: {
    required: ['items'],
    properties: {
      items: { type: 'array', minItems: 2, maxItems: ITEMS_LIMIT, items: ITEM_SCHEMA },
      title: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: TITLE_MAX },
      numbered: { type: 'boolean' },
      style: { enum: ['points', 'steps'] },
      hero: HERO_SCHEMA,
    },
  },
  srcFields: [],
  heroTarget: 'items',
  targets: (shot) => ['items', ...(Array.isArray(shot.items) ? shot.items.map((_, k) => `${ITEM_PREFIX}${k}`) : [])],
  ids: (shot) => [heroId(shot, 'items')],
  validate: (shot, { look } = {}) => [...heroProblems(shot), ...kindSupportProblems(KIND, look)],
  expand: expandList,
  review: listReview,
  partWindow: itemWindow, // when an `on` target is on screen (an event outside it is a finding and plans no cue)
  nodeField: listNodeField,
  // each item's arrival after the first as a device event named `item`, in shot seconds, on heard time (for the cue plan:
  // scripts/v2/sound/events.mjs); item 0 arrives on the shot's first frame, the cut's own cue covers it
  events: (shot, timing) => listTimes(shot, timing).slice(1).map((t) => ({ kind: 'device', device: 'item', t })),
  eventDevices: Object.freeze(['item']), // every device name `events` sends: each look must name a sound for it (sound/cues.mjs)
  lookData: true, // a look ships it only with a kinds.list entry (engine/looks/index.mjs listedKinds)
  numbered: true, // the title is a slug in desk, which shows the shot's place among the numbered shots
  showsWords: true, // its narration is the picture: never captioned (engine/captions)
});

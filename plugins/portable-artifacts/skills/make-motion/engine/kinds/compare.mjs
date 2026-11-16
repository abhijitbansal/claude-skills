// The `compare` kind: two sides, options (`versus`) or before and after (`before-after`). Each side has a title and
// optional points (at most three), value and picture (`src`, drawn above its text); a value is shown only when both sides have one (the validator refuses one
// alone), as a numeral, the larger never styled as better. The left side arrives with the first sentence and the right
// with the second (else at the narration's midpoint); `on` events target `left` or `right`. An editorial composition
// (desk) sets two paper cards side by side (stacked on tall frames), the unspoken side under a paper scrim, a hand vs or
// an arrow between them (compare-desk.mjs); a stack (pop) shows one side at a time with a hard cut at the turn
// (compare-pop.mjs). How each look composes it is look data (look.kinds.compare). Pure and DOM-free.
import { registries } from '../registry.mjs';
import { node } from '../graph/node.mjs';
import { kindData, kindSupportProblems } from '../looks/index.mjs';
import {
  HERO_SCHEMA, heroId, isEditorial, heroProblems, fieldNode, defaultCamera, onDevices, placeDevices, deviceCamera, unionBox, NOT_BLANK, assertNoBlanks, hiddenOnFindings, isWide,
} from './shared.mjs';
import { SIDES, compareTurn, valueText } from './compare-text.mjs';
import { expandDeskCompare } from './compare-desk.mjs';
import { expandPopCompare } from './compare-pop.mjs';

export { compareTurn, valueText } from './compare-text.mjs';

const KIND = 'compare';
const KICKER_MAX = 40; // characters: a slug's kicker
const TITLE_MAX = 60;
const POINT_MAX = 60;
const POINTS_MAX = 3;
const VALUE_TEXT_MAX = 9; // characters as set: a value is one numeral line that holds the hero size on a desk card
const VALUE_LIMIT = 1e15; // as number.mjs: larger figures lose integer precision

const SIDE_SCHEMA = Object.freeze({
  type: 'object',
  required: ['title'],
  additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: TITLE_MAX },
    points: { type: 'array', maxItems: POINTS_MAX, items: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: POINT_MAX } },
    value: { anyOf: [{ type: 'number', exclusiveMinimum: -VALUE_LIMIT, exclusiveMaximum: VALUE_LIMIT }, { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: VALUE_TEXT_MAX }] },
    src: { type: 'string', minLength: 1 },
  },
});

// The kind's own rules: a value on one side only (values are compared, so both or neither) and a number longer than
// VALUE_TEXT_MAX characters as set. A side's picture is a srcFields path, held to the film folder by the validator.
function sideProblems(shot) {
  const values = SIDES.filter((k) => shot[k]?.value !== undefined);
  const lopsided = values.length === 1 ? [{ path: `${values[0]}.value`, message: 'give a value on both sides or neither: values are compared' }] : [];
  const long = values.filter((k) => Number.isFinite(shot[k].value)).map((k) => [k, valueText(shot[k].value)])
    .filter(([k, text]) => text.length > VALUE_TEXT_MAX || (shot[k].value !== 0 && Number(text.replace(/[^\d.-]/g, '')) === 0)).map(([k, text]) => ({
      path: `${k}.value`, message: text.length > VALUE_TEXT_MAX
        ? `a value is set on one line of at most ${VALUE_TEXT_MAX} characters ("${text}" is ${text.length}): round it, or put the unit in the title`
        : `${shot[k].value} would show as "${text}" (at most 3 decimals): scale it and put the unit in the title`,
    }));
  return [...lopsided, ...long];
}

// Each `on` device, inside the side it aims at when the composition hides sides (pop), else on the frame. Nothing goes
// behind: the sides are opaque cards in desk (a band under them would be hidden), and pop styles no highlight on text.
function assemble(shot, ctx, { nodes, wrappers, boxes, hero, extra = [] }) {
  const devices = onDevices(shot, ctx, { boxes, defaultTarget: 'left' });
  if (wrappers === undefined) return { nodes: placeDevices(nodes, devices), devices };
  const children = wrappers.map((w, k) => node('group', w.id, {}, {
    tracks: w.tracks, children: [...w.children, ...devices.filter((d) => d.target === SIDES[k]).flatMap((d) => d.nodes)],
  }));
  const loose = devices.filter((d) => !SIDES.includes(d.target));
  return { nodes: placeDevices([node('group', hero, {}, { children: [...children, ...extra] })], loose), devices };
}

// When a side is on screen in shot seconds, or null for a target that is not a side.
function sideWindow(shot, timing, target, look, canvas) {
  const turn = compareTurn(timing);
  if (SIDES.includes(target) && bothSides(look, canvas, shot)) return [0, Infinity];
  if (target === 'left') return [0, isEditorial(look) ? Infinity : turn];
  if (target === 'right') return [turn, Infinity];
  return null;
}

// Are both sides on screen the whole shot? Always in desk (two cards); in a stack look on a tall frame when its data
// says so (stackTall: A over B) and no side has a picture (a picture and a stack in half the frame left the title a few
// pixels tall), else one side at a time. A canvas left out counts as wide.
function bothSides(look, canvas, shot) {
  if (isEditorial(look)) return true;
  const pictures = SIDES.some((k) => shot[k]?.src !== undefined);
  return kindData(look, KIND).stackTall === true && canvas !== undefined && !isWide(canvas) && !pictures;
}

function expandCompare(shot, ctx) {
  assertNoBlanks(shot, 'compare'); // a blank text is the validator's to refuse; expand names it rather than failing in layout
  const { look, timing, unit } = ctx;
  const data = kindData(look, KIND);
  const turn = compareTurn(timing);
  const hero = heroId(shot, 'sides');
  const built = isEditorial(look) ? expandDeskCompare(shot, ctx, data, turn, hero) : expandPopCompare(shot, ctx, data, { turn, both: bothSides(look, ctx.canvas, shot) });
  const boxes = { ...built.boxes, sides: built.boxes.sides ?? unionBox([built.boxes.left, built.boxes.right]) };
  const { nodes, devices } = assemble(shot, ctx, { ...built, boxes, hero });
  return {
    nodes: [fieldNode(shot, ctx), ...nodes],
    camera: [...defaultCamera(look, timing, unit), ...deviceCamera(devices)],
    boxes,
    hero,
    background: look.palette.paper,
  };
}

registries.kinds.add(KIND, {
  summary: 'Two sides, options or before and after: paper cards side by side (stacked on tall frames) with the unspoken side dimmed and a hand vs or an arrow between them (desk), or one side at a time under an A / B or BEFORE / AFTER tag (pop). A side has a title, up to three points and an optional value.',
  example: {
    id: 'swap', show: 'compare', mode: 'before-after', say: 'Before, you ran a server. After, you share one file.',
    left: { title: 'A server', points: ['Deploys', 'Logins', 'Bills'] }, right: { title: 'One file', points: ['Open it anywhere'] },
  },
  schema: {
    required: ['left', 'right'],
    properties: {
      left: SIDE_SCHEMA,
      right: SIDE_SCHEMA,
      mode: { enum: ['versus', 'before-after'] },
      kicker: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: KICKER_MAX },
      hero: HERO_SCHEMA,
    },
  },
  srcFields: ['left.src', 'right.src'], // a side's picture (engine/assets.mjs reads dotted paths)
  heroTarget: 'sides',
  targets: () => [...SIDES],
  ids: (shot) => [heroId(shot, 'sides')],
  // the field a node shows, for a review finding's path (scripts/v2/review.mjs): a side's title, value or points
  nodeField: (shot, id) => {
    const side = SIDES.find((k) => id === `${shot.id}.${k}` || id.startsWith(`${shot.id}.${k}.`));
    if (side === undefined) return undefined;
    if (id.startsWith(`${shot.id}.${side}.kicker`)) return null; // the A / B tag is the kind's, not author text
    const part = ['title', 'value', 'points', 'src'].find((p) => id.startsWith(`${shot.id}.${side}.${p}`));
    return part === undefined ? side : `${side}.${part}`;
  },
  // when a side is on screen: one at a time in a stack (pop), both from their arrival in a column of cards (desk)
  partWindow: sideWindow,
  review: (shot, { look, timing, at, canvas }) => hiddenOnFindings(shot, { timing, at }, (target) => sideWindow(shot, timing, target, look, canvas)),
  validate: (shot, { look } = {}) => [...heroProblems(shot), ...sideProblems(shot), ...kindSupportProblems(KIND, look)],
  expand: expandCompare,
  numbered: (shot) => shot.kicker !== undefined, // with a kicker, a slug (desk) that counts among the numbered shots
  showsWords: true, // its sides restate the narration: never captioned (engine/captions)
  // the second side's arrival as a device event named `turn`, in shot seconds (for the cue plan: scripts/v2/sound/events.mjs)
  events: (shot, timing) => [{ kind: 'device', device: 'turn', t: compareTurn(timing) }],
  eventDevices: Object.freeze(['turn']), // every device name `events` sends: each look must name a sound for it (sound/cues.mjs)
});

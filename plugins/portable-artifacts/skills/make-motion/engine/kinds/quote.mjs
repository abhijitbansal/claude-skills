// The `quote` kind: a quotation (`text`, else the say), who said it (`by`), their role (`role`) and an optional portrait
// (`src`) set as a cut-out. An editorial composition (desk) sets the quotation on a tilted paper card in the display face
// with its opening mark hanging into the card's padding and the attribution under it in label caps after a short rule,
// the portrait over the card's top right corner, never over its text (quote-desk.mjs); a stack (pop) sets it as a stack
// behind a giant opening mark in the accent with the attribution as a tag (quote-pop.mjs). The quote marks are the
// kind's own: marks the author typed are taken off, then one opening and one closing mark ride on the first and last
// words, so word targets and word times are unchanged. Words arrive as they are spoken; emphasis follows the look's
// system. How each look composes it is look data (look.kinds.quote). Pure and DOM-free.
import { registries } from '../registry.mjs';
import { kindData, kindSupportProblems } from '../looks/index.mjs';
import {
  HERO_SCHEMA, heroId, wordsOf, isEditorial, heroProblems, fieldNode, onDevices, placeDevices, deviceCamera, NOT_BLANK, assertNoBlanks,
} from './shared.mjs';
import { defaultCamera } from './camera.mjs';
import { quotationOf, quoteTimes } from './quote-text.mjs';
import { expandDeskQuote } from './quote-desk.mjs';
import { expandPopQuote } from './quote-pop.mjs';

export { OPEN_MARK, CLOSE_MARK, BY_SEPARATOR, quoteBody, quotationOf, attributionOf, quoteTimes } from './quote-text.mjs';

const KIND = 'quote';
const TEXT_MAX = 400;
const BY_MAX = 48;
const ROLE_MAX = 48;

function expandQuote(shot, ctx) {
  assertNoBlanks(shot, 'quote'); // a blank text is the validator's to refuse; expand names it rather than failing in layout
  const { look, timing, unit } = ctx;
  const data = kindData(look, KIND);
  const times = quoteTimes(shot, timing);
  const hero = heroId(shot, isEditorial(look) ? 'card' : 'text');
  const parts = isEditorial(look) ? expandDeskQuote(shot, ctx, data, times, hero) : expandPopQuote(shot, ctx, data, times, hero);
  // a highlight under a stack goes behind it; in desk the words sit on an opaque card, so a band placed before the card
  // would be hidden: it is drawn over the card instead, where the look's multiply blend keeps the ink readable
  const behind = isEditorial(look) ? {} : Object.fromEntries(Object.keys(parts.boxes).filter((k) => k === 'text' || k.startsWith('word:')).map((k) => [k, hero]));
  const devices = onDevices(shot, ctx, { boxes: parts.boxes, defaultTarget: 'text', behind });
  return {
    nodes: placeDevices([fieldNode(shot, ctx), ...parts.nodes], devices),
    camera: [...defaultCamera(look, timing, unit), ...deviceCamera(devices)],
    boxes: parts.boxes,
    hero,
    background: look.palette.paper,
  };
}

function quoteProblems(shot, { look } = {}) {
  const missing = wordsOf(quotationOf(shot)).length === 0 ? [{ path: 'text', message: 'a quote needs words to quote: write "text" or "say"' }] : [];
  return [...heroProblems(shot), ...missing, ...kindSupportProblems(KIND, look)];
}

registries.kinds.add(KIND, {
  summary: 'A quotation and who said it: on a tilted paper card with a hanging opening mark and the attribution after a short rule (desk), or a stack behind a giant accent opening mark with the attribution as a tag (pop). An optional portrait is a cut-out.',
  example: { id: 'voice', show: 'quote', say: 'Every chart should show its work.', by: 'The data desk' },
  schema: {
    required: ['by'],
    properties: {
      text: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: TEXT_MAX },
      by: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: BY_MAX },
      role: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: ROLE_MAX },
      src: { type: 'string', minLength: 1 },
      hero: HERO_SCHEMA,
    },
  },
  srcFields: ['src'],
  heroTarget: 'text',
  targets: (shot) => ['text', ...wordsOf(quotationOf(shot)).map((_, i) => `word:${i}`), 'by'],
  ids: (shot) => [heroId(shot, 'card'), heroId(shot, 'text')],
  // the field a node shows, for a review finding's path (scripts/v2/review.mjs): the quotation (its text, else the say)
  // or the attribution; undefined for any other node
  nodeField: (shot, id) => {
    if (id === `${shot.id}.text` || id.startsWith(`${shot.id}.text.`)) return shot.text !== undefined ? 'text' : 'say';
    if (id === `${shot.id}.by` || id.startsWith(`${shot.id}.by.`)) return 'by';
    return undefined;
  },
  validate: quoteProblems,
  expand: expandQuote,
  numbered: false, // no slug
  showsWords: true, // its narration is the picture: never captioned (engine/captions)
});

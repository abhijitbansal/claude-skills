// The emphasis styles' data half: what each style is (it scales, it keeps runs together, it caps the emphasised share),
// with no drawing code. emphasis.mjs adds the word tracks to make the table (EMPHASIS). Split out so the caption styles
// can read it: the drawing half reaches devices/glow.mjs, whose import chain (sun.mjs, kinds/editorial.mjs) reaches
// looks/index.mjs, which needs the caption styles registered first. Pure and DOM-free.
import { didYouMean } from '../../shared/errors.mjs';
import { isWide } from './shared.mjs';

const EMPHASIS_SHARE = 0.5; // emphasis on this share of a statement's words or more is a creative finding (highlight)
const never = () => false;

// together(ctx): the fit keeps emphasised runs on one line; scales: the emphasis pulses the word to the look's emphasize
// scale (and a statement's word lands from the enter scale); maxShare: the emphasised share that is a creative finding
export const EMPHASIS_FLAGS = Object.freeze({
  highlight: Object.freeze({ together: () => true, maxShare: EMPHASIS_SHARE }),
  'recolor-scale': Object.freeze({ together: never, scales: true }),
  recolor: Object.freeze({ together: never }),
  // a glow look may keep its emphasised phrases whole on a wide frame (look.kinds.statement.together, cosmos)
  glow: Object.freeze({ together: (ctx) => ctx.look.kinds?.statement?.together === true && isWide(ctx.canvas) }),
  // a step to a heavier weight in the accent (ledger): a pointer like the highlight, capped at the same share
  'weight-color': Object.freeze({ together: never, maxShare: EMPHASIS_SHARE }),
  // size (poster): `leads`: a stack's line holding an emphasised word takes the stack's large size and the others the
  // small one (kinds/stack.mjs keepRatio); `widens`: a one-line stack's emphasised word steps one width keyword wider on
  // its beat, its line measured at that width. Never a recolour.
  scale: Object.freeze({ together: never, leads: true, widens: true, keepsColour: true }),
  // a weight sweep from light to heavy over each emphasised word's spoken time (keynote): a pointer, capped at the share
  'weight-sweep': Object.freeze({ together: never, maxShare: EMPHASIS_SHARE }),
});

/** The name of look.emphasis when the table has it; throws naming the look, the name and the names the table has. */
export function emphasisName(look) {
  const name = look.emphasis;
  if (typeof name === 'string' && Object.hasOwn(EMPHASIS_FLAGS, name)) return name;
  const names = Object.keys(EMPHASIS_FLAGS);
  const hint = typeof name === 'string' ? didYouMean(name, names) : null;
  throw new Error(`look "${look.name}": emphasis ${JSON.stringify(name)} is not an emphasis style (have: ${names.join(', ')})${hint ? `; did you mean "${hint}"?` : ''}`);
}

/** The data half of look.emphasis's entry (EMPHASIS_FLAGS); throws as emphasisName does. */
export const emphasisFlags = (look) => EMPHASIS_FLAGS[emphasisName(look)];

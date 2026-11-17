// Grounds a shot: a look that carries `grounds` (poster) paints each shot on one flat colour from that list, chosen by
// the shot's index and the film's seed so no two neighbours match, and every colour a kind draws comes from the look's
// pairing table (`on`) for that ground. shotLook remaps the palette once per ground, so the kinds, which read
// look.palette.ink, paper and accent, follow the ground without knowing it: paper becomes the ground, ink its first
// permitted colour, accent its second (else the first), accent2 its third (else accent), ink2 the ink, rule the accent;
// inkText and plateText the text on an ink plate and on a plate-coloured plate.
// A look without `grounds` is returned as it is, the same object (desk, pop, cosmos and ledger never change). The ground
// is also a node: an opaque full-frame sheet first in the shot, which the contrast review reads as the ground of every
// text over it (engine/review/contrast.mjs). Pure and DOM-free.
import { mulberry32 } from '../seeded.mjs';
import { node } from '../graph/node.mjs';
import { mixOklab } from '../color/oklab.mjs';

const DIM = 0.55; // a dimmed mark: the ink this share of the way to the ground
const BAR_SHOWS = 3; // a bar against its ground
const BAR_READS = 4.5; // the words over a bar against the bar

// WCAG contrast of two #rrggbb colours (shared/contrast.mjs is not served to the page, which loads this module)
const LINEAR_KNEE = 0.03928, LINEAR_SLOPE = 12.92, GAMMA_OFFSET = 0.055, GAMMA_SCALE = 1.055, GAMMA = 2.4;
const LUMA = Object.freeze([0.2126, 0.7152, 0.0722]);
const FLARE = 0.05;
const luminance = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  .map((s) => (s <= LINEAR_KNEE ? s / LINEAR_SLOPE : ((s + GAMMA_OFFSET) / GAMMA_SCALE) ** GAMMA))
  .reduce((sum, c, i) => sum + c * LUMA[i], 0);
function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + FLARE) / (lo + FLARE);
}

/** The id of the ground sheet a grounded shot opens with. */
export const GROUND_ID = 'ground';

const memo = new WeakMap(); // look -> Map(ground key -> shot look)

/** Does the look paint a ground a shot (look.grounds)? */
export const hasGrounds = (look) => Array.isArray(look?.grounds) && look.grounds.length > 1;

/**
 * The ground key of each of the first `count` shots: seeded, never the same as the shot before. `shows` (optional): each
 * shot's kind; a kind whose look data names `grounds` (poster's chart: the grounds its red accent reads on, gate-poster-1
 * ruling 2) stands only on those, unless the shot before took the only one left. One draw a shot either way.
 * look.groundsFresh (poster, gate-poster-2 ruling 5: a ground per shot, every ground shown): a shot also avoids the
 * grounds of the `groundsFresh` shots before it, as far back as leaves it a choice its kind permits; absent, only the
 * shot before.
 */
export function groundKeys(look, count, seed, shows = []) {
  if (!hasGrounds(look)) throw new Error(`look "${look?.name}" has no grounds`);
  const rng = mulberry32(seed >>> 0);
  const fresh = Number.isInteger(look.groundsFresh) ? look.groundsFresh : 1;
  const keys = [];
  for (let i = 0; i < count; i++) {
    const free = i === 0 ? look.grounds : look.grounds.filter((k) => k !== keys[i - 1]);
    const wanted = look.kinds?.[shows[i]]?.grounds;
    const narrowed = Array.isArray(wanted) ? free.filter((k) => wanted.includes(k)) : free;
    const allowed = narrowed.length > 0 ? narrowed : free;
    const choices = freshest(allowed, keys, fresh);
    keys.push(choices[Math.floor(rng() * choices.length)]);
  }
  return keys;
}

// The keys of `allowed` not used by the last `back` keys picked, the window shortened until some are left (never past
// one shot: `allowed` already excludes the shot before).
function freshest(allowed, keys, back) {
  for (let n = back; n > 1; n--) {
    const recent = new Set(keys.slice(-n));
    const left = allowed.filter((k) => !recent.has(k));
    if (left.length > 0) return left;
  }
  return allowed;
}

// The palette for ground `key`: the look's colours renamed through its pairing table. `card`: the first other ground
// the ink may sit on and the ground itself permits as a mark (look.on[key]), else the ground itself: the colour of a
// plate on a card (cardPlate, cardPlateText: the URL pill on a browser frame, a code highlight band on a code card), where
// the ground's own colour shows. `plate`: a plate on the ground itself (a highlight bar, a keyline): the card colour,
// except where that is the ground (blue: its only permitted mark is the paper, the ink) and the plate is the ink.
function groundPalette(look, key) {
  const p = look.palette;
  const [first, second, third] = look.on[key];
  const ink = p[first];
  const accent = p[second ?? first];
  const card = look.grounds.find((k) => k !== key && look.on[k]?.includes(first) && look.on[key].includes(k)) ?? key;
  const plate = card === key ? first : card;
  // dim: a mark not being discussed, the ink mixed DIM of the way to the ground (opaque, never an alpha: ban 6)
  const dim = mixOklab(ink, p[key], DIM);
  // text on a plate filled with the ink (inkText) or with the plate colour (plateText): that plate colour's own ink as a
  // ground, never the ground's colour or ink (on the red ground the ground's colour on a paper plate read red on paper,
  // and on the paper ground the ink on a red plate read ink on red: display-only pairs at text size)
  const inkText = p[look.on[first]?.[0] ?? key];
  const plateText = p[look.on[plate]?.[0] ?? first];
  const cardPlateText = p[look.on[card]?.[0] ?? first];
  // textPlate: a second ground the ink reads on at text size (labels over a map's land): the card colour, or the dim where
  // the ink on it is a display-only pair (look.displayOnly: ground -> the colours set on it at display sizes only)
  const textPlate = look.displayOnly?.[card]?.includes(first) ? dim : p[card];
  // accentText: text on a plate in the accent, which the ground always permits as a mark (the plate may not: red on blue)
  const accentText = p[look.on[second ?? first]?.[0] ?? key];
  // landLine: the line between land masses, in the ground's colour so it cuts the land; where the land is the ground's
  // colour itself (no permitted colour to fill it) the ink draws the coast instead
  const landLine = textPlate === p[key] ? ink : p[key];
  // coastLine: the land's outline: the land's own colour (unseen), or the ink where the land is the ground (blue), so the
  // coast shows
  const coastLine = textPlate === p[key] ? ink : textPlate;
  // bar: a highlight bar behind words, the first colour the ground permits that shows on it (3:1) and carries its own ink
  // at 4.5:1 (barText, the words' colour over the bar: the red bar left 3.78:1 and 4.17:1, the plate on blue was the ink)
  const barKey = look.on[key].find((k) => contrastRatio(p[k], p[key]) >= BAR_SHOWS && contrastRatio(p[look.on[k]?.[0] ?? first], p[k]) >= BAR_READS) ?? plate;
  const barText = p[look.on[barKey]?.[0] ?? first];
  return Object.freeze({ ...p, paper: p[key], ink, ink2: ink, accent, accent2: third === undefined ? accent : p[third], rule: accent, plate: p[plate], cardPlate: p[card], dim, inkText, plateText, cardPlateText, textPlate, accentText, landLine, coastLine, bar: p[barKey], barText });
}

/** The look a shot on ground `key` draws with, memoised per look and ground; the look itself when it has no grounds. */
export function lookOnGround(look, key) {
  if (!hasGrounds(look)) return look;
  if (!look.on?.[key]) throw new Error(`look "${look.name}": ground "${key}" has no entry in its pairing table (on)`);
  if (!memo.has(look)) memo.set(look, new Map());
  const byKey = memo.get(look);
  if (!byKey.has(key)) byKey.set(key, Object.freeze({ ...look, palette: groundPalette(look, key), ground: key }));
  return byKey.get(key);
}

/** The look shot `index` of a film with `seed` draws with (lookOnGround on its ground); the look itself without grounds.
 *  `shows`: the film's shot kinds in order (groundKeys). */
export const shotLook = (look, index, seed, shows = []) => (hasGrounds(look) ? lookOnGround(look, groundKeys(look, index + 1, seed, shows)[index]) : look);

/**
 * The ground sheet: one opaque full-frame path in the ground's colour, drawn first and kept still under the camera. Depth
 * 0, not shared background: each shot keeps its own ground through a cut (a cover's still part is the outgoing shot on
 * its own ground, the sheet that slides in is the incoming one's: engine/cuts/index.mjs backgroundIds).
 */
export function groundSheet(look, canvas) {
  return node('path', GROUND_ID, { d: `M0 0H${canvas.w}V${canvas.h}H0Z`, fill: look.palette.paper, fixed: true }, { depth: 0 });
}

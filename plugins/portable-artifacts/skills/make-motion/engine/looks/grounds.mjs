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

/** The id of the ground sheet a grounded shot opens with. */
export const GROUND_ID = 'ground';

const memo = new WeakMap(); // look -> Map(ground key -> shot look)

/** Does the look paint a ground a shot (look.grounds)? */
export const hasGrounds = (look) => Array.isArray(look?.grounds) && look.grounds.length > 1;

/** The ground key of each of the first `count` shots: seeded, never the same as the shot before. */
export function groundKeys(look, count, seed) {
  if (!hasGrounds(look)) throw new Error(`look "${look?.name}" has no grounds`);
  const rng = mulberry32(seed >>> 0);
  const keys = [];
  for (let i = 0; i < count; i++) {
    const choices = i === 0 ? look.grounds : look.grounds.filter((k) => k !== keys[i - 1]);
    keys.push(choices[Math.floor(rng() * choices.length)]);
  }
  return keys;
}

// The palette for ground `key`: the look's colours renamed through its pairing table. `plate`: the first other ground
// the ink may sit on (a highlight bar under the ink).
function groundPalette(look, key) {
  const p = look.palette;
  const [first, second, third] = look.on[key];
  const ink = p[first];
  const accent = p[second ?? first];
  const plate = look.grounds.find((k) => k !== key && look.on[k]?.includes(first)) ?? key;
  // dim: a mark not being discussed, the ink mixed DIM of the way to the ground (opaque, never an alpha: ban 6)
  const dim = mixOklab(ink, p[key], DIM);
  // text on a plate filled with the ink (inkText) or with the plate colour (plateText): that plate colour's own ink as a
  // ground, never the ground's colour or ink (on the red ground the ground's colour on a paper plate read red on paper,
  // and on the paper ground the ink on a red plate read ink on red: display-only pairs at text size)
  const inkText = p[look.on[first]?.[0] ?? key];
  const plateText = p[look.on[plate]?.[0] ?? first];
  // textPlate: a second ground the ink reads on at text size (labels over a map's land): the plate, or the dim where the
  // ink on the plate is a display-only pair (look.displayOnly: ground -> the colours set on it at display sizes only)
  const textPlate = look.displayOnly?.[plate]?.includes(first) ? dim : p[plate];
  // accentText: text on a plate in the accent, which the ground always permits as a mark (the plate may not: red on blue)
  const accentText = p[look.on[second ?? first]?.[0] ?? key];
  return Object.freeze({ ...p, paper: p[key], ink, ink2: ink, accent, accent2: third === undefined ? accent : p[third], rule: accent, plate: p[plate], dim, inkText, plateText, textPlate, accentText });
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

/** The look shot `index` of a film with `seed` draws with (lookOnGround on its ground); the look itself without grounds. */
export const shotLook = (look, index, seed) => (hasGrounds(look) ? lookOnGround(look, groundKeys(look, index + 1, seed)[index]) : look);

/**
 * The ground sheet: one opaque full-frame path in the ground's colour, drawn first and kept still under the camera. Depth
 * 0, not shared background: each shot keeps its own ground through a cut (a cover's still part is the outgoing shot on
 * its own ground, the sheet that slides in is the incoming one's: engine/cuts/index.mjs backgroundIds).
 */
export function groundSheet(look, canvas) {
  return node('path', GROUND_ID, { d: `M0 0H${canvas.w}V${canvas.h}H0Z`, fill: look.palette.paper, fixed: true }, { depth: 0 });
}

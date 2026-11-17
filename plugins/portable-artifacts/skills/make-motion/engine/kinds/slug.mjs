// The slug: in an editorial composition (desk) a shot's kicker is set on a small taped paper card in the top right,
// the way a picture desk slugs a print: the shot's number among the film's numbered shots as a display-serif numeral,
// the kicker under it in label caps. The card's right margin equals the text block's left margin (the text
// starts on column 2, so the card ends on the right edge of column 11) and its top sits at 14% of the height, turned +3 degrees, the same in every shot; it enters with the look's enter move at the shot start. A
// shot without a kicker has no slug. Built from the `card` device plus two text nodes inside its group. A look whose
// slug is its tag (look.slug.style 'tag', ledger) sets the kicker on its tag device at the top left instead, the tag's
// rule running to the right margin. Pure, DOM-free.
import { registries } from '../registry.mjs';
import { node } from '../graph/node.mjs';
import { layoutText } from '../text/layout.mjs';
import { gridX, gridSpan } from '../looks/index.mjs';
import { pathPoints } from '../devices/shared.mjs';
import { sizeAt, fontFor, setCase, isEditorial, inkExtent, asTextCard, opensSet } from './shared.mjs';
import { editorialBounds, editorialRight, editorialSpan } from './editorial.mjs';

export const SLUG = Object.freeze({ top: 0.14, turn: 3, pad: 30, gap: 18, numeralStep: 3, kickerStep: 2, digits: 2, maxColumns: 3 });
const TEXT_COLUMN = 2; // the column a text block starts on: the slug's right margin is as wide as the text's left one
const DEGREES_TO_RADIANS = Math.PI / 180;
const NO_WRAP = 1e6;
const HALF = 2;

// The slug's turn in degrees: the look's (look.slug.turn: cosmos sets its rounded chip square), else SLUG.turn.
const turnOf = (look) => look.slug?.turn ?? SLUG.turn;

/** Does this shot carry a slug? An editorial look that styles a card, and a kicker. */
export const hasSlug = (shot, look) => shot.kicker !== undefined && isEditorial(look) && Object.hasOwn(look.devices ?? {}, 'card');

// A look whose slug is its tag (look.slug.style 'tag', ledger): the kicker on the look's tag at the top left, on the text
// column, the tag's rule running to the right margin; no card, no number, square.
const isTagSlug = (look) => look.slug?.style === 'tag';

// The tag slug's box: from the text column (or the band's left in the safe zone) at the top of the composition to the
// right margin, as tall as the tag; and the tag device built in it.
function tagSlug(shot, ctx) {
  const { look, canvas, unit, measure } = ctx;
  const bounds = editorialBounds(ctx);
  const x = bounds.safe ? editorialSpan(ctx, 1, 1).x : gridX(look, canvas, TEXT_COLUMN);
  const right = editorialRight(ctx);
  // in a look that opens composed (opensSet) the tag is on from the first frame
  const at = opensSet(look) ? 0 : look.moves.enter.dur;
  const probe = registries.devices.get('tag').build({ id: `${shot.id}.slug`, box: [x, bounds.top, right - x, 1], at, look, unit, seed: ctx.seed, measure, text: shot.kicker });
  const box = [x, bounds.top, right - x, probe.boxes.tag[3]];
  return { box, group: probe.nodes[0] };
}

// The kicker on one line, or, when that is wider than SLUG.maxColumns grid columns, wrapped to that width: at spaces, and
// after a hyphen inside a word that is still too wide ("PORTABLE-" over "ARTIFACTS"). A slug stays a slug, not a banner.
function kickerLayout(text, font, ctx) {
  const { look, canvas, measure } = ctx;
  const one = layoutText({ text, font, maxWidth: NO_WRAP, measure });
  // a look may let its slug run wider (look.slug.maxColumns, cosmos: three columns of a 9:16 frame broke 'On the / way')
  const max = gridSpan(look, canvas, 1, look.slug?.maxColumns ?? SLUG.maxColumns).w;
  if (one.width <= max) return one;
  const fits = (word) => layoutText({ text: word, font, maxWidth: NO_WRAP, measure }).width <= max;
  const words = text.split(/\s+/).flatMap((word) => (fits(word) || !word.includes('-') ? [word] : word.split(/(?<=-)/).map((part, i, all) => (i < all.length - 1 ? `${part}|` : part))));
  return layoutText({ text: words.join(' '), font, maxWidth: max, measure });
}

// The two lines of the slug laid out, and the card size around them (unturned).
function slugParts(shot, ctx) {
  const { look, unit, measure } = ctx;
  const numFont = fontFor(look, 'display', sizeAt(look, SLUG.numeralStep, unit), unit);
  const kickFont = fontFor(look, 'label', sizeAt(look, SLUG.kickerStep, unit), unit);
  const numText = String(ctx.ordinal).padStart(SLUG.digits, '0');
  const numeral = layoutText({ text: numText, font: numFont, maxWidth: NO_WRAP, measure });
  const kicker = kickerLayout(setCase(look, 'label', shot.kicker), kickFont, ctx);
  const numInk = inkExtent(numText, numFont, measure);
  const kickInk = { up: Math.max(...kicker.lines[0].words.map((w) => inkExtent(w.text, kickFont, measure).up)) };
  const pad = SLUG.pad * unit, gap = SLUG.gap * unit;
  const inner = Math.max(numInk.right - numInk.left, kicker.width);
  const w = inner + HALF * pad;
  const h = pad + numInk.up + gap + kickInk.up + (kicker.lines.at(-1).y - kicker.lines[0].y) + pad;
  return { numFont, kickFont, numeral, kicker, numInk, kickInk, w, h, pad, gap };
}

// The slug's card device, as slugNodes builds it (the same id and seed, so the same tape).
const slugCard = (shot, ctx, box) => registries.devices.get('card').build({ id: `${shot.id}.slug`, box, at: ctx.look.moves.enter.dur, look: ctx.look, unit: ctx.unit, seed: ctx.seed }).nodes[0];

// A point turned by `deg` degrees about the origin.
function turnBy([x, y], deg) {
  const a = deg * DEGREES_TO_RADIANS, cos = Math.cos(a), sin = Math.sin(a);
  return [x * cos - y * sin, x * sin + y * cos];
}

// The canvas box of the card's paper and tape strips (not its shadow), the card turned exactly SLUG.turn about (cx, cy).
function inkedBox(card, cx, cy, turn) {
  const inked = card.children.filter((n) => n.id.endsWith('.paper') || n.props.tape === true);
  const points = inked.flatMap((n) => pathPoints(n.props.d).map((p) => {
    const [x, y] = turnBy(p, n.props.rotate ?? 0);
    const [tx, ty] = turnBy([x + (n.props.x ?? 0), y + (n.props.y ?? 0)], turn);
    return [cx + tx, cy + ty];
  }));
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
}

/** The slug's unturned box [x, y, w, h] in canvas pixels, its box once turned (axis-aligned), and the box its card's
 *  paper and tape cover (`inked`, axis-aligned), or null. */
export function slugBox(shot, ctx) {
  if (!hasSlug(shot, ctx.look)) return null;
  if (isTagSlug(ctx.look)) {
    const { box } = tagSlug(shot, ctx);
    return { box, turned: box, inked: box };
  }
  const { w, h } = slugParts(shot, ctx);
  // on a tall frame in the platform safe zone: the top right of the composition band (editorial.mjs)
  const bounds = editorialBounds(ctx);
  const right = bounds.safe ? editorialRight(ctx) : ctx.canvas.w - gridX(ctx.look, ctx.canvas, TEXT_COLUMN);
  const box = [right - w, bounds.safe ? bounds.top : SLUG.top * ctx.canvas.h, w, h];
  const turn = turnOf(ctx.look);
  const a = turn * DEGREES_TO_RADIANS;
  const tw = w * Math.cos(a) + h * Math.sin(a), th = w * Math.sin(a) + h * Math.cos(a);
  const cx = box[0] + w / HALF, cy = box[1] + h / HALF;
  return { box, turned: [cx - tw / HALF, cy - th / HALF, tw, th], inked: inkedBox(slugCard(shot, ctx, box), cx, cy, turn) };
}

/** The slug's nodes: one group (the card's entrance, turned exactly +3 degrees) holding the card and the two lines. */
export function slugNodes(shot, ctx) {
  const placed = slugBox(shot, ctx);
  if (placed === null) return [];
  const { look } = ctx;
  if (isTagSlug(look)) {
    // the tag's text is the shot's kicker (frame furniture, as a slug's is), pinned to the frame
    const { group } = tagSlug(shot, ctx);
    const children = group.children.map((n) => (n.type === 'text' ? node('text', `${shot.id}.kicker`, { ...n.props, role: 'kicker', furniture: true }, { tracks: n.tracks }) : n));
    return [node('group', group.id, { ...group.props, fixed: true }, { tracks: group.tracks, children })];
  }
  const parts = slugParts(shot, ctx);
  const id = `${shot.id}.slug`;
  const card = slugCard(shot, ctx, placed.box);
  const left = -parts.w / HALF + parts.pad, top = -parts.h / HALF + parts.pad;
  const numBaseline = top + parts.numInk.up;
  const kickBaseline = numBaseline + parts.gap + parts.kickInk.up;
  const numeral = node('text', `${id}.number`, {
    x: left - parts.numInk.left, y: numBaseline - parts.numeral.lines[0].y, layout: parts.numeral, font: parts.numFont, fill: look.palette.ink, role: 'slug', furniture: true,
  });
  const kicker = node('text', `${shot.id}.kicker`, {
    x: left, y: kickBaseline - parts.kicker.lines[0].y, layout: parts.kicker, font: parts.kickFont, fill: look.palette.ink2, role: 'kicker', furniture: true,
  });
  // the card's own hand tilt is replaced: the slug turns exactly SLUG.turn in every shot
  // pinned to the frame (props.fixed): the slug stands still through a drift or a push, the same in every shot
  const turn = turnOf(look);
  return [node('group', id, { ...card.props, ...(turn === 0 ? {} : { rotate: turn }), fixed: true }, { tracks: card.tracks, children: [...asTextCard(id, card.children), numeral, kicker] })];
}

// The `quote` kind in an editorial composition (desk): a taped paper card (the card device, with its slight hand tilt)
// from column 2, wrapped to its text and never past column look.kinds.quote.toWide (on vertical formats from fromTall
// to toTall), centred on the height. On it, `pad` in from the paper (further when the opening mark at the largest size
// would hang off it), the quotation in the display face between three times the attribution's size and `max`, in at
// most `maxLines` lines with no line of one word (size is traded for that down to the floor), its opening mark hanging into the padding (optical alignment); under it, its cap line `attrGap` em of the
// quotation below the last baseline, a short rule and the attribution in label caps. A portrait is a cut-out over the
// card's top right corner, `portrait` of the short side at its longest, overlapping the card by `overlap` of its size
// (more where the frame edge asks); on a wide frame the quotation's measure gives up the width the portrait takes, on a
// tall one the text starts under it, so it never covers text. An attribution too long for one line puts the role on a
// line of its own. The card group carries the hero id. Pure and DOM-free.
import { registries } from '../registry.mjs';
import { node } from '../graph/node.mjs';
import { layoutText } from '../text/layout.mjs';
import { FORCE_MARK } from '../text/breaks.mjs';
import { gridSpan } from '../looks/index.mjs';
import {
  CAP_HEIGHT, WORD_DESCENT, sizeAt, fontFor, isWide, setCase, enterTracks, arrivesMatched, fitDisplay, capBox, unionBox, rectPath,
  asTextCard, highlightBands, highlightLines,
} from './shared.mjs';
import { MIN_HERO_RATIO } from '../review/frame.mjs';
import { OPEN_MARK, CLOSE_MARK, quotationOf, attributionOf } from './quote-text.mjs';

const FIRST_COLUMN = 2;
const RULE_THICKNESS = 3; // units
const PORTRAIT_CLEAR = 2; // gutters between the portrait's keyline and the text: room for both tilts
const HANG_INSET = 16; // units: the hanging opening mark's ink stays at least this far inside the paper
const EPSILON = 1e-6;
const HALF = 2;

// The portrait's size, its overlap with the card and the measure the text gives up for it: null without a portrait.
function portraitPlan(shot, ctx, data, span) {
  if (shot.src === undefined) return null;
  const { look, canvas, unit } = ctx;
  const picture = ctx.asset(shot.src);
  const scale = (data.portrait * Math.min(canvas.w, canvas.h)) / Math.max(picture.width, picture.height);
  const w = picture.width * scale, h = picture.height * scale, keyline = look.keyline * unit;
  const right = span.x + span.w;
  // into the card by `overlap` of its width, or further where the frame's margin would cut it
  const overlapX = Math.max(data.overlap * w, right + w + keyline - (canvas.w - look.grid.margin * unit));
  const overlapY = data.overlap * h;
  const clear = PORTRAIT_CLEAR * look.grid.gutter * unit - data.pad * unit;
  // a wide frame gives up measure (every line stops short of the portrait); a tall one gives up height (the text starts
  // under it), which a tall frame has to spare and a narrow measure does not
  if (isWide(canvas)) return { w, h, keyline, overlapX, overlapY, reserve: Math.max(0, overlapX + keyline + clear), drop: 0 };
  return { w, h, keyline, overlapX, overlapY, reserve: 0, drop: Math.max(0, overlapY + keyline + clear) };
}

// The attribution in label caps on one line, or, when it does not fit, the role broken onto a line of its own (the
// separator then dropped).
function attributionLayout(shot, ctx, font, maxWidth) {
  const { look, measure } = ctx;
  const one = layoutText({ text: setCase(look, 'label', attributionOf(shot)), font, maxWidth, measure });
  if (one.lines.length === 1 || shot.role === undefined) return one;
  return layoutText({ text: setCase(look, 'label', `${shot.by}${FORCE_MARK} ${shot.role}`), font, maxWidth, measure });
}

// A layout with no line of a single word (a one-line layout passes).
const noLoneLine = (layout) => layout.lines.length < HALF || layout.lines.every((line) => line.words.length > 1);

// The attribution's scale step: the largest of data.attrSteps the quotation stays MIN_HERO_RATIO times, else the smallest.
function attrSize(look, data, size, unit) {
  const fits = data.attrSteps.filter((step) => MIN_HERO_RATIO * sizeAt(look, step, unit) <= size + EPSILON);
  return sizeAt(look, fits.length > 0 ? Math.max(...fits) : Math.min(...data.attrSteps), unit);
}

// The card's contents laid out from its top left: { quote, attr, textX, textY, attrX, attrY, ruleY, w, h }.
function cardLayout(shot, ctx, data, { span, plan, room }) {
  const { look, unit, measure } = ctx;
  const pad = data.pad * unit;
  // the text edge: `pad` in, or further when the opening mark (at the largest size) would hang off the paper
  const maxFont = fontFor(look, 'display', data.max * unit, unit);
  const hang = measure(OPEN_MARK, maxFont).width + maxFont.tracking * maxFont.size;
  const edge = Math.max(pad, hang + HANG_INSET * unit);
  const width = span.w - edge - pad - (plan === null ? 0 : plan.reserve);
  const drop = plan === null ? 0 : plan.drop;
  const attrMax = sizeAt(look, Math.max(...data.attrSteps), unit);
  const maxHeight = room - HALF * pad - drop - (data.attrGap * data.max * unit + (CAP_HEIGHT + WORD_DESCENT) * attrMax);
  const text = `${OPEN_MARK}${setCase(look, 'display', quotationOf(shot))}${CLOSE_MARK}`;
  // breaks by sense, no line of one word: the fit trades size for a layout without one, down to its floor (fitText)
  const opts = { text, font: fontFor(look, 'display', data.max * unit, unit), maxWidth: width, align: 'left', measure, optical: true, accept: noLoneLine };
  const min = MIN_HERO_RATIO * sizeAt(look, Math.min(...data.attrSteps), unit);
  const quote = fitDisplay(opts, { min, max: data.max * unit, maxHeight: Math.max(1, maxHeight), maxLines: data.maxLines, tradeFloor: min }, look, unit);
  const size = quote.font.size;
  const ruleW = data.rule * unit, gap = data.ruleGap * unit;
  const font = fontFor(look, 'label', attrSize(look, data, size, unit), unit);
  const layout = attributionLayout(shot, ctx, font, width - ruleW - gap);
  const textY = pad + drop + CAP_HEIGHT * size - quote.layout.lines[0].y;
  const capLine = textY + quote.layout.lines.at(-1).y + data.attrGap * size;
  const attrY = capLine + CAP_HEIGHT * font.size - layout.lines[0].y;
  const bottom = attrY + layout.lines.at(-1).y + WORD_DESCENT * font.size;
  // the card wraps its text: as wide as its longest line or the attribution row, with the portrait's share kept
  const content = Math.max(...quote.layout.lines.map((l) => Math.max(0, l.x + l.width)), ruleW + gap + layout.width);
  return {
    quote, attr: { font, layout }, textX: edge, textY, attrX: edge + ruleW + gap, attrY,
    ruleY: capLine + (CAP_HEIGHT * font.size) / HALF - (RULE_THICKNESS * unit) / HALF, ruleW,
    w: Math.min(span.w, edge + content + pad + (plan === null ? 0 : plan.reserve)), h: bottom + pad,
  };
}

// The quotation's word boxes in the card's centred space.
const wordBoxes = (layout, x, y) => layout.lines.flatMap((line) => line.words.map((w) => ({ index: w.index, box: capBox(x + line.x + w.x, y + line.y, w.width, layout.size) })))
  .sort((a, b) => a.index - b.index).map((w) => w.box);

// The card's children in its centred space: the bands, the quotation, the rule and the attribution.
function cardChildren(shot, ctx, lay, times) {
  const { look, unit } = ctx;
  const ox = -lay.w / HALF, oy = -lay.h / HALF;
  const matched = arrivesMatched(shot, ctx);
  const placed = { x: ox + lay.textX, y: oy + lay.textY, layout: lay.quote.layout, font: lay.quote.font };
  const lines = highlightLines(placed.layout, times.words, ctx.timing);
  const quote = node('text', `${shot.id}.text`, { ...placed, fill: look.palette.ink, role: 'hero', ...(lines === undefined ? {} : { highlightLines: lines }) }, {
    wordTracks: times.words.map(({ at }) => (matched ? {} : enterTracks(look, unit, at))),
  });
  const attrY = oy + lay.attrY, ruleY = oy + lay.ruleY;
  const rule = node('path', `${shot.id}.rule`, { d: rectPath(lay.ruleW, RULE_THICKNESS * unit), fill: look.palette.ink, x: ox + lay.textX, y: ruleY }, {
    tracks: enterTracks(look, unit, times.by, { y: ruleY }),
  });
  const by = node('text', `${shot.id}.by`, { x: ox + lay.attrX, y: attrY, layout: lay.attr.layout, font: lay.attr.font, fill: look.palette.ink, role: 'label' }, {
    tracks: enterTracks(look, unit, times.by, { y: attrY }),
  });
  return { children: [...highlightBands(shot.id, placed, times.words, ctx, 'quote'), quote, rule, by], placed, attrY };
}

/** The desk quote: { nodes (the card group, the portrait), boxes } with the card group carrying the hero id. */
export function expandDeskQuote(shot, ctx, data, times, hero) {
  const { look, canvas, unit, seed } = ctx;
  const span = isWide(canvas) ? gridSpan(look, canvas, FIRST_COLUMN, data.toWide) : gridSpan(look, canvas, data.fromTall, data.toTall);
  const plan = portraitPlan(shot, ctx, data, span);
  const margin = look.grid.margin * unit;
  const topLimit = margin + (plan === null ? 0 : plan.h + plan.keyline - plan.overlapY);
  const lay = cardLayout(shot, ctx, data, { span, plan, room: canvas.h - margin - topLimit });
  const top = Math.max(topLimit, Math.min(data.centre * canvas.h - lay.h / HALF, canvas.h - margin - lay.h));
  const box = [span.x, top, lay.w, lay.h];
  // the card is on the desk from the shot's first frame (its words arrive as spoken): a shot never opens on the field alone
  const card = registries.devices.get('card').build({ id: hero, box, at: 0, look, unit, seed }).nodes[0];
  const { children, placed, attrY } = cardChildren(shot, ctx, lay, times);
  const group = node('group', hero, card.props, { tracks: card.tracks, children: [...asTextCard(hero, card.children), ...children] });
  const cx = box[0] + lay.w / HALF, cy = box[1] + lay.h / HALF;
  const words = wordBoxes(placed.layout, cx + placed.x, cy + placed.y);
  const attr = lay.attr.layout;
  const boxes = {
    text: unionBox(words), ...Object.fromEntries(words.map((b, i) => [`word:${i}`, b])),
    by: capBox(cx - lay.w / HALF + lay.attrX, cy + attrY + attr.lines[0].y, attr.width, attr.size),
  };
  if (plan === null) return { nodes: [group], boxes };
  // over the wrapped card's corner: `overlap` of its width in, or more where the frame margin asks (never more than the
  // measure the text gave up, which was set against the widest card)
  const right = box[0] + lay.w;
  const overlapX = Math.max(data.overlap * plan.w, right + plan.w + plan.keyline - (canvas.w - margin));
  const image = node('image', `${shot.id}.portrait.image`, { src: shot.src, w: plan.w, h: plan.h });
  const portrait = registries.devices.get('cutout').build({
    id: `${shot.id}.portrait`, box: [right - overlapX, top + plan.overlapY - plan.h, plan.w, plan.h], at: look.moves.enter.dur, look, unit, seed, image,
  }).nodes;
  return { nodes: [group, ...portrait], boxes };
}

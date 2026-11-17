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
import { colourOf, roundedRect } from '../devices/shared.mjs';
import { earthNodes, earthReach } from '../devices/sun.mjs';
import { editorialSpan, editorialBounds } from './editorial.mjs';
import {
  CAP_HEIGHT, WORD_DESCENT, sizeAt, fontFor, isWide, setCase, enterTracks, arrivesMatched, fitDisplay, capBox, unionBox, rectPath, wordBoxes, stepUnder, fitLongestSide, cardOf, cardGroup, asTextCard,
} from './shared.mjs';
import { highlightBands, highlightLines } from './highlighter.mjs';
import { track } from '../time/track.mjs';
import { MIN_HERO_RATIO } from '../review/frame.mjs';
import { secondarySize, heroFloor } from './secondary.mjs';
import { OPEN_MARK, CLOSE_MARK, quotationOf, attributionOf } from './quote-text.mjs';

const FIRST_COLUMN = 2;
const RULE_THICKNESS = 3; // units
const PORTRAIT_CLEAR = 2; // gutters between the portrait's keyline and the text: room for both tilts
const HANG_INSET = 16; // units: the hanging opening mark's ink stays at least this far inside the paper
const HALF = 2;

// The portrait's size, its overlap with the card and the measure the text gives up for it: null without a portrait.
function portraitPlan(shot, ctx, data, span) {
  if (shot.src === undefined) return null;
  const { look, canvas, unit } = ctx;
  const { w, h } = fitLongestSide(ctx.asset(shot.src), data.portrait * Math.min(canvas.w, canvas.h));
  const keyline = look.keyline * unit;
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

// The attribution's scale step: the largest of data.attrSteps the quotation stays MIN_HERO_RATIO times, else the smallest;
// never under the look's secondary floor (kinds/secondary.mjs: the quotation is fitted to keep the ratio over it).
function attrSize(look, data, size, unit) {
  return secondarySize(look, unit, sizeAt(look, stepUnder(look, data.attrSteps, unit, [{ size, ratio: MIN_HERO_RATIO }]), unit));
}

// The card's contents laid out from its top left: { quote, attr, textX, textY, attrX, attrY, ruleY, w, h, dropped }. With
// `keep` false the attribution is left out (kinds/secondary.mjs: the quotation could not keep the hero ratio over it at
// the look's floor) and the quotation fitted as if it had none.
function cardLayout(shot, ctx, data, { span, plan, room, keep = true }) {
  const { look, unit, measure } = ctx;
  const pad = data.pad * unit;
  // the text edge: `pad` in, or further when the opening mark (at the largest size) would hang off the paper; with a
  // large mark (data.mark: its size in quotations), `pad` in, the mark standing over the text (markDrop)
  // the quotation in the display face, or the face a look names (data.face, ledger: the serif)
  const face = data.face ?? 'display';
  const maxFont = fontFor(look, face, data.max * unit, unit);
  const markFont = data.mark ? fontFor(look, face, data.mark * data.max * unit, unit) : null;
  const markDrop = (size) => (markFont ? markInk({ ...markFont, size: data.mark * size }, measure).height + look.grid.gutter * unit : 0);
  const edge = markFont ? pad : Math.max(pad, measure(OPEN_MARK, maxFont).width + maxFont.tracking * maxFont.size + HANG_INSET * unit);
  const width = span.w - edge - pad - (plan === null ? 0 : plan.reserve);
  const drop = plan === null ? 0 : plan.drop;
  const attrMax = sizeAt(look, Math.max(...data.attrSteps), unit);
  const pillY = data.pill ? HALF * data.pill.padY * attrMax : 0;
  const attrRoom = keep ? data.attrGap * data.max * unit + (CAP_HEIGHT + WORD_DESCENT) * attrMax + pillY : 0;
  const maxHeight = room - HALF * pad - drop - markDrop(data.max * unit) - attrRoom;
  // with a large mark the closing mark is large too (closeMarkNode), not inline; short sentences one per line (sentenceLines)
  const body = sentenceLines(setCase(look, 'display', quotationOf(shot)), data.sentenceLines);
  const text = `${markFont ? '' : OPEN_MARK}${body}${markFont ? '' : CLOSE_MARK}`;
  // breaks by sense, no line of one word: the fit trades size for a layout without one, down to its floor (fitText)
  const opts = { text, font: fontFor(look, face, data.max * unit, unit), maxWidth: width, align: 'left', measure, optical: true, accept: noLoneLine };
  const min = Math.max(MIN_HERO_RATIO * sizeAt(look, Math.min(...data.attrSteps), unit), keep ? heroFloor(look, unit) : 0);
  const quote = fitDisplay(opts, { min, max: data.max * unit, maxHeight: Math.max(1, maxHeight), maxLines: data.maxLines, tradeFloor: min }, look, unit);
  const size = quote.font.size;
  const font = fontFor(look, 'label', attrSize(look, data, size, unit), unit);
  // the attribution after a rule, or (data.pill: { padX, padY } in em of the attribution) inside a pill
  const pill = data.pill ? { x: data.pill.padX * font.size, y: data.pill.padY * font.size } : null;
  const ruleW = pill ? 0 : data.rule * unit, gap = pill ? pill.x : data.ruleGap * unit;
  const layout = attributionLayout(shot, ctx, font, pill ? width - HALF * gap : width - ruleW - gap);
  const textY = pad + drop + markDrop(size) + CAP_HEIGHT * size - quote.layout.lines[0].y;
  const capLine = textY + quote.layout.lines.at(-1).y + data.attrGap * size + (pill ? pill.y : 0);
  const attrY = capLine + CAP_HEIGHT * font.size - layout.lines[0].y;
  const textBottom = keep ? attrY + layout.lines.at(-1).y + WORD_DESCENT * font.size + (pill ? pill.y : 0) : textY + quote.layout.lines.at(-1).y + WORD_DESCENT * size;
  // the card wraps its text: as wide as its longest line or the attribution row, with the portrait's share kept
  const close = markFont ? closePlace({ ...markFont, size: data.mark * size }, look.grid.gutter * unit, { quote, width, capLine }, measure) : null;
  const closeEnd = close?.under === false ? quote.layout.width + close.gap + close.width : 0;
  const bottom = Math.max(textBottom, close?.under ? close.bottom : 0);
  const content = Math.max(...quote.layout.lines.map((l) => Math.max(0, l.x + l.width)), closeEnd, ruleW + gap + layout.width + (pill ? pill.x : 0));
  return {
    dropped: keep ? [] : ['attribution'], quote, attr: { font, layout }, textX: edge, textY, attrX: edge + ruleW + gap, attrY, pill, capLine,
    ruleY: capLine + (CAP_HEIGHT * font.size) / HALF - (RULE_THICKNESS * unit) / HALF, ruleW,
    mark: markFont ? { font: { ...markFont, size: data.mark * size }, x: pad, top: pad + drop } : null, close,
    w: Math.min(span.w, edge + content + pad + (plan === null ? 0 : plan.reserve)), h: bottom + pad,
  };
}

// Where the closing mark goes: past the block's widest line on its last line (inside the block it would meet the
// text), or, when that would run off the text's width (a block already as wide as the card allows), under the block,
// its ink right-aligned to the block and its ink top on the attribution's cap line: the card closes at bottom right.
function closePlace(font, gap, { quote, width, capLine }, measure) {
  const m = measure(CLOSE_MARK, font);
  const under = quote.layout.width + gap + m.width > width;
  const height = markInk({ ...font }, measure).height;
  return { font, gap, width: m.width, under, bottom: capLine + height };
}

// Where the opening mark's ink sits in `font`: up from the baseline to its top, its height (a quotation mark's ink
// stops well over the baseline: a negative descent), and where it starts from the origin. Estimated where the measure
// reports no ink: from the cap line, MARK_INK of the size tall.
const MARK_INK = 0.3;
function markInk(font, measure) {
  const m = measure(OPEN_MARK, font);
  const up = m.inkAscent ?? CAP_HEIGHT * font.size;
  const down = m.inkDescent ?? -(CAP_HEIGHT - MARK_INK) * font.size;
  return { up, height: Math.max(0, up + Math.min(0, down)) || MARK_INK * font.size, left: m.inkLeft ?? 0 };
}

// The large opening mark (cosmos): in the accent, at data.mark times the quotation's size, over the quotation, its ink
// top left at the card's padding; frame furniture (an ornament, not a size on the frame for the review).
function markNode(shot, ctx, lay, ox, oy, at) {
  const { look, unit, measure } = ctx;
  const { font, x, top } = lay.mark;
  const layout = layoutText({ text: OPEN_MARK, font, maxWidth: 1e6, measure });
  const ink = markInk(font, measure);
  const y = oy + top + ink.up - layout.lines[0].y;
  return node('text', `${shot.id}.mark`, { x: ox + x - ink.left, y, layout, font, fill: markFill(look), role: 'affix', furniture: true }, { tracks: enterTracks(look, unit, at, { y }) });
}

// The large marks' colour: the look's markFill (cosmos: the lavender, gold being only for light), else the accent.
const markFill = (look) => colourOf(look, look.kinds?.quote?.markFill ?? 'accent');

// The matching closing mark (with a large opening mark, cosmos): the same size, in the accent, after the last line,
// its ink top on that line's cap line, arriving with the last word.
function closeMarkNode(shot, ctx, lay, ox, oy, at) {
  const { look, unit, measure } = ctx;
  const { font, gap } = lay.close;
  const layout = layoutText({ text: CLOSE_MARK, font, maxWidth: 1e6, measure });
  const last = lay.quote.layout.lines.at(-1);
  const m = measure(CLOSE_MARK, font);
  const up = m.inkAscent ?? CAP_HEIGHT * font.size;
  const capTop = lay.close.under ? oy + lay.capLine : oy + lay.textY + last.y - CAP_HEIGHT * lay.quote.font.size;
  const y = capTop + up - layout.lines[0].y;
  const inkRight = Number.isFinite(m.inkRight) ? m.inkRight : m.width;
  const x = lay.close.under ? ox + lay.textX + lay.quote.layout.width - inkRight : ox + lay.textX + lay.quote.layout.width + gap - (m.inkLeft ?? 0);
  return node('text', `${shot.id}.close`, { x, y, layout, font, fill: markFill(look), role: 'affix', furniture: true }, { tracks: enterTracks(look, unit, at, { y }) });
}

// Short sentences one per line (data.sentenceLines: { words }, cosmos): when every sentence has at most `words` words, a
// forced break (a lone '|', text/layout.mjs) after each; else the text as it is.
const SENTENCE_END = /(?<=[.!?][\u201d\u2019"')]?)\s+/;
function sentenceLines(text, rule) {
  if (!rule) return text;
  const sentences = text.split(SENTENCE_END).filter((s) => s.length > 0);
  if (sentences.length < 2 || sentences.some((s) => s.split(/\s+/).length > rule.words)) return text;
  return sentences.join(' | ');
}

// The attribution's pill (cosmos): a plate as the look's tag is, around the attribution's lines.
function pillNode(shot, ctx, lay, ox, oy, at) {
  const { look, unit } = ctx;
  const { layout, font } = lay.attr;
  const x = ox + lay.attrX - lay.pill.x, y = oy + lay.capLine - lay.pill.y;
  const h = (layout.lines.at(-1).y - layout.lines[0].y) + (CAP_HEIGHT + WORD_DESCENT) * font.size + HALF * lay.pill.y;
  const w = layout.width + HALF * lay.pill.x;
  const fill = colourOf(look, look.devices?.tag?.fill ?? 'ink');
  return node('path', `${shot.id}.pill`, { d: roundedRect(x, y, w, h, h / HALF), fill }, { tracks: enterTracks(look, unit, at, { y: 0 }) });
}

// The card's children in its centred space: the bands, the quotation, the rule and the attribution.
function cardChildren(shot, ctx, lay, times) {
  const { look, unit } = ctx;
  const ox = -lay.w / HALF, oy = -lay.h / HALF;
  const matched = arrivesMatched(shot, ctx);
  const placed = { x: ox + lay.textX, y: oy + lay.textY, layout: lay.quote.layout, font: lay.quote.font };
  const lines = highlightLines(placed.layout, times.words, ctx.timing);
  const quote = node('text', `${shot.id}.text`, { ...placed, fill: look.palette.ink, role: 'hero', ...(lines === undefined ? {} : { highlightLines: lines }), ...(lay.dropped.length ? { dropped: lay.dropped } : {}) }, {
    wordTracks: times.words.map(({ at }) => (matched ? {} : enterTracks(look, unit, at))),
  });
  const attrY = oy + lay.attrY, ruleY = oy + lay.ruleY;
  const rule = node('path', `${shot.id}.rule`, { d: rectPath(lay.ruleW, RULE_THICKNESS * unit), fill: look.palette.ink, x: ox + lay.textX, y: ruleY }, {
    tracks: enterTracks(look, unit, times.by, { y: ruleY }),
  });
  const byFill = lay.pill ? colourOf(look, look.devices?.tag?.text ?? 'paper') : colourOf(look, ctx.look.kinds?.quote?.attrFill ?? 'ink');
  const by = node('text', `${shot.id}.by`, { x: ox + lay.attrX, y: attrY, layout: lay.attr.layout, font: lay.attr.font, fill: byFill, role: 'label' }, {
    tracks: enterTracks(look, unit, times.by, { y: attrY }),
  });
  // with no card (data.card false, cosmos) the opening mark is on screen from frame 0: the frame never opens on the field
  const plain = ctx.look.kinds?.quote?.card === false;
  const mark = lay.mark ? [markNode(shot, ctx, lay, ox, oy, plain ? 0 : times.words[0]?.at ?? 0)] : [];
  const close = lay.close ? [closeMarkNode(shot, ctx, lay, ox, oy, times.words.at(-1)?.at ?? 0)] : [];
  const attribution = lay.dropped.length ? [] : lay.pill ? [pillNode(shot, ctx, lay, ox, oy, times.by), by] : [rule, by, ...attributionEarth(shot, ctx, lay, ox, attrY, times.by)];
  const bar = barNode(shot, ctx, lay, { ox, oy, at: times.words[0]?.at ?? 0 });
  return { children: [...highlightBands(shot.id, placed, times.words, ctx, 'quote'), ...bar, ...mark, quote, ...close, ...attribution], placed, attrY };
}

// A rule down the quotation's left (data.bar: { width units, color }, ledger): on the block's left edge, from the first
// line's cap line to the last line's descent, there from the first word (it opens the frame, so no shot opens empty). []
// without it.
function barNode(shot, ctx, lay, { ox, oy, at }) {
  const bar = ctx.look.kinds?.quote?.bar;
  if (!bar) return [];
  const { layout, font } = lay.quote;
  const top = oy + lay.textY + layout.lines[0].y - CAP_HEIGHT * font.size;
  const bottom = oy + lay.textY + layout.lines.at(-1).y + WORD_DESCENT * font.size;
  const w = bar.width * ctx.unit;
  return [node('path', `${shot.id}.bar`, { d: rectPath(w, bottom - top), fill: colourOf(ctx.look, bar.color), x: ox, y: top }, { tracks: at > 0 ? enterTracks(ctx.look, ctx.unit, at, { y: top }) : {} })];
}

// The Earth mark hung before the attribution on its cap middle (data.earth, cosmos: the pale blue dot the quotation
// names), a gutter clear of its first letter, arriving with it. [] without it.
function attributionEarth(shot, ctx, lay, ox, attrY, at) {
  const { look, unit } = ctx;
  if (look.kinds?.quote?.earth !== true) return [];
  const { layout, font } = lay.attr;
  const cx = ox + lay.attrX - look.grid.gutter * unit - earthReach(look, unit);
  const cy = attrY + layout.lines[0].y - (CAP_HEIGHT * font.size) / HALF;
  return earthNodes(`${shot.id}.earth`, look, { cx, cy, unit, tracks: enterTracks(look, unit, at, { y: cy }) });
}

// The card growing with the text (data.grow, cosmos): its paper scaled down from its top edge to the height of the
// lines spoken so far, stepping down a line as each line's first word arrives and to the whole card with the
// attribution. The texts are not scaled.
function growingCard(card, hero, children, lay, times, ctx) {
  const { look } = ctx;
  const { dur, ease } = look.moves.enter;
  const size = lay.quote.font.size;
  // the card down to a line's descent and the card's padding (its text edge, the same padding in a mark layout)
  const share = (line) => Math.min(1, (lay.textY + line.y + WORD_DESCENT * size + lay.textX) / lay.h);
  const lines = lay.quote.layout.lines;
  const keys = [{ t: 0, v: share(lines[0]) }];
  lines.slice(1).forEach((line, i) => {
    const at = times.words[line.words[0].index]?.at ?? 0;
    // grown to the line by the time its first word arrives (it never spills past the paper)
    const from = Math.max(keys.at(-1).t, at - dur);
    keys.push({ t: from, v: share(lines[i]) }, { t: from + dur, v: share(line), ease });
  });
  const by = Math.max(keys.at(-1).t, times.by - dur);
  keys.push({ t: by, v: keys.at(-1).v }, { t: by + dur, v: 1, ease });
  const parts = asTextCard(hero, card.children).map((n) => (n.props.textCard ? node(n.type, n.id, { ...n.props, card: hero }, { tracks: n.tracks, children: n.children }) : n));
  const paper = node('group', `${hero}.grow.in`, { y: lay.h / HALF }, { children: parts });
  const grow = node('group', `${hero}.grow`, { y: -lay.h / HALF }, { tracks: { scaleY: track(keys) }, children: [paper] });
  return node('group', hero, { ...card.props }, { tracks: card.tracks, children: [grow, ...children] });
}

// The quotation's children on the card (growing with the text where data.grow says so).
function withCard(ctx, hero, box, lay, children, times, data) {
  const card = cardOf(ctx, hero, box, 0);
  return data.grow ? growingCard(card, hero, children, lay, times, ctx) : cardGroup(card, hero, children);
}

/** The desk quote: { nodes (the card group, the portrait), boxes } with the card group carrying the hero id. */
export function expandDeskQuote(shot, ctx, given, times, hero) {
  const { look, canvas, unit, seed } = ctx;
  // a look may let the quotation grow larger on a tall frame (data.maxTall, ledger), so it fills the height
  const data = !isWide(canvas) && given.maxTall !== undefined ? { ...given, max: given.maxTall } : given;
  const span = isWide(canvas) ? editorialSpan(ctx, FIRST_COLUMN, data.toWide) : editorialSpan(ctx, data.fromTall, data.toTall);
  const plan = portraitPlan(shot, ctx, data, span);
  const margin = look.grid.margin * unit;
  // on a tall frame in the platform safe zone the card centres in the composition band (editorial.mjs)
  const bounds = editorialBounds(ctx);
  const topLimit = (bounds.safe ? bounds.top : margin) + (plan === null ? 0 : plan.h + plan.keyline - plan.overlapY);
  const bottom = bounds.safe ? bounds.bottom : canvas.h - margin;
  const held = cardLayout(shot, ctx, data, { span, plan, room: bottom - topLimit });
  // the attribution goes when the quotation cannot keep the hero ratio over it at the secondary floor
  const lay = held.quote.layout.overflow && heroFloor(look, unit) > 0 ? cardLayout(shot, ctx, data, { span, plan, room: bottom - topLimit, keep: false }) : held;
  const top = Math.max(topLimit, Math.min((bounds.safe ? bounds.at(data.centre) : data.centre * canvas.h) - lay.h / HALF, bottom - lay.h));
  // a look may centre the card across the grid (data.centred, cosmos: a card on the margin left the frame lopsided)
  const grid = editorialSpan(ctx, 1, look.grid.columns);
  const box = [data.centred ? grid.x + (grid.w - lay.w) / HALF : span.x, top, lay.w, lay.h];
  // the card is on the desk from the shot's first frame (its words arrive as spoken): a shot never opens on the field
  // alone; a look may set the quotation with no card (data.card false, cosmos: plain type on the field, a frosted card
  // read as a web component), its texts in a group at the block's centre
  const cx = box[0] + lay.w / HALF, cy = box[1] + lay.h / HALF;
  const { children, placed, attrY } = cardChildren(shot, ctx, lay, times);
  const group = data.card === false ? node('group', hero, { x: cx, y: cy }, { children }) : withCard(ctx, hero, box, lay, children, times, data);
  const words = wordBoxes(placed.layout, cx + placed.x, cy + placed.y);
  const attr = lay.attr.layout;
  const boxes = {
    card: box, text: unionBox(words), ...Object.fromEntries(words.map((b, i) => [`word:${i}`, b])),
    ...(lay.dropped.length ? {} : { by: capBox(cx - lay.w / HALF + lay.attrX, cy + attrY + attr.lines[0].y, attr.width, attr.size) }),
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

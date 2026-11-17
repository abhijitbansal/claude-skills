// The `end` kind: the film's closing card. A closing line (`title`, else the say), a short call to action (`ask`), a
// wordmark or name (`mark`) and an optional logo picture (`src`). An editorial composition (desk) sets the title as the
// hero in the display face flush left on column 2, the ask under it in the text face, and the mark on a small taped card
// in the bottom right (label caps under the title and the ask, judged like any text); a stack (pop) sets the
// title as a stack under the mark as a tag, with the ask as its last line in the accent. A picture sits where the mark
// would (on the card, or over the stack), at most a sixth of the short side. The title's words arrive as they are spoken
// (its first word on the shot's first frame); the ask lands on its own first spoken word, else just after the title's
// last. How each look composes it is look data (look.kinds.end). Emphasis in the say is not drawn here (the review says
// so). Pure and DOM-free.
import { registries } from '../registry.mjs';
import { node } from '../graph/node.mjs';
import { layoutText } from '../text/layout.mjs';
import { gridX, kindData, kindSupportProblems } from '../looks/index.mjs';
import { entrance, roundedRect } from '../devices/shared.mjs';
import { track } from '../time/track.mjs';
import { editorialSpan, editorialBounds, editorialRight } from './editorial.mjs';
import { parseSay, SayError } from '../script/say.mjs';
import {
  CAP_HEIGHT, WORD_DESCENT, HERO_SCHEMA, sizeAt, fontFor, heroId, isWide, arrivesMatched, wordsOf, fitDisplay, setCase, isEditorial, heroProblems, fieldNode, enterTracks, onDevices, placeDevices, deviceCamera, unionBox, runInk, plainSay, endTimes, cutReveal, overlaps, wordBoxes, tagBox, ghostWords, stepUnder, fitLongestSide, NOT_BLANK, assertNoBlanks, cardOf, cardGroup,
} from './shared.mjs';
import { defaultCamera, driftReach } from './camera.mjs';
import { plainTag } from './plain-tag.mjs';
import { SLUG } from './slug.mjs';
import { expandWordmark } from './end-mark.mjs';
import { STACK, stackArea, composeStack, stackNodes, restack } from './stack.mjs';
import { MIN_HERO_RATIO } from '../review/frame.mjs';
import { HERO_MARGIN } from './secondary.mjs';
import { unmarked } from './shared.mjs';

const KIND = 'end';
const TITLE_MAX = 120;
const ASK_MAX = 60;
const MARK_MAX = 32;
const FIRST_COLUMN = 2; // the title starts on column 2; the card's right margin mirrors it
export const PICTURE_SHARE = 1 / 6; // of the short side: the longest side of a logo picture
const CARD_CLEAR = 2; // gutters between the title block's ink and the card (as a statement keeps off its slug)
const NO_WRAP = 1e6;
const HALF = 2;
const DEGREES_TO_RADIANS = Math.PI / 180;

// ---- the words ----

const titleOf = (shot) => shot.title ?? plainSay(shot.say);

// ---- the picture ----

/** A picture's size in canvas pixels: its longest side at most PICTURE_SHARE of the short side (a small logo is never
 *  enlarged), its aspect kept. */
export function pictureSize(picture, canvas) {
  return fitLongestSide(picture, Math.min(Math.min(canvas.w, canvas.h) * PICTURE_SHARE, Math.max(picture.width, picture.height)));
}

// ---- desk: the card ----

// The card's contents laid out (the mark, the picture over it) and its size: null with neither. The mark is set in the
// label face at the largest of data.markSteps that keeps the title three times it and the mark no larger than the ask, so
// the frame reads title, then ask, then mark.
function cardParts(shot, ctx, data, block) {
  if (shot.mark === undefined && shot.src === undefined) return null;
  const { look, unit, measure, canvas } = ctx;
  const pad = SLUG.pad * unit, gap = SLUG.gap * unit;
  let mark = null;
  if (shot.mark !== undefined) {
    const limits = [{ size: block.title.font.size, ratio: MIN_HERO_RATIO }, ...(block.ask === null ? [] : [{ size: block.ask.font.size, ratio: 1 }])];
    const font = fontFor(look, 'label', sizeAt(look, stepUnder(look, data.markSteps, unit, limits), unit), unit);
    const layout = layoutText({ text: setCase(look, 'label', shot.mark), font, maxWidth: NO_WRAP, measure });
    mark = { font, layout, ink: runInk(layout.lines[0], font, measure) };
  }
  const picture = shot.src === undefined ? null : pictureSize(ctx.asset(shot.src), canvas);
  const innerW = Math.max(mark ? mark.ink.right - mark.ink.left : 0, picture ? picture.w : 0);
  const innerH = (picture ? picture.h : 0) + (picture && mark ? gap : 0) + (mark ? mark.ink.up + mark.ink.down : 0);
  return { mark, picture, pad, gap, w: innerW + HALF * pad, h: innerH + HALF * pad };
}

// The card's unturned box (right edge mirroring the text margin, bottom on the bottom margin) and its box once turned.
function cardBox(parts, ctx, data) {
  const { look, canvas, unit } = ctx;
  // in the platform safe zone on a tall frame: the bottom right of the composition band (editorial.mjs)
  const bounds = editorialBounds(ctx);
  const right = bounds.safe ? editorialRight(ctx) : canvas.w - gridX(look, canvas, FIRST_COLUMN), bottom = bounds.bottom;
  const box = [right - parts.w, bottom - parts.h, parts.w, parts.h];
  const a = Math.abs(data.turn) * DEGREES_TO_RADIANS;
  const tw = parts.w * Math.cos(a) + parts.h * Math.sin(a), th = parts.w * Math.sin(a) + parts.h * Math.cos(a);
  const cx = box[0] + parts.w / HALF, cy = box[1] + parts.h / HALF;
  return { box, turned: [cx - tw / HALF, cy - th / HALF, tw, th] };
}

// The card kept clear of the block: where it is (bottom right), or, when the block set at y still meets it there, moved
// under the block's last line, flush with its left edge, a gutter (and the drift) below, as low as the margin allows.
function clearCard(card, block, y, ctx) {
  const { look, canvas, unit } = ctx;
  const by = CARD_CLEAR * look.grid.gutter * unit + driftReach(look, unit);
  const [cx, cy, cw, ch] = card.turned;
  const clear = [cx - by, cy - by, cw + HALF * by, ch + HALF * by];
  if (!blockParts(block, y).some((box) => overlaps(clear, box))) return card;
  const under = Math.max(...blockParts(block, y).map((box) => box[1] + box[3])) + by;
  const top = Math.min(under, editorialBounds(ctx).bottom - card.box[3]);
  const dx = block.span.x - card.box[0], dy = top - card.box[1];
  return { box: [card.box[0] + dx, top, card.box[2], card.box[3]], turned: [cx + dx, cy + dy, cw, ch] };
}

// The card's nodes: one group (the card's entrance, turned exactly data.turn, pinned to the frame) holding the card, the
// picture and the mark (judged like any text: it is the film's own sign-off, not a running head).
function cardNodes(shot, ctx, parts, placed, data) {
  const { look, unit, seed } = ctx;
  const id = `${shot.id}.mark`;
  const card = cardOf(ctx, id, placed.box, look.moves.enter.dur);
  const left = -parts.w / HALF + parts.pad, top = -parts.h / HALF + parts.pad;
  const picture = parts.picture === null ? [] : [node('image', `${id}.picture`, { src: shot.src, w: parts.picture.w, h: parts.picture.h, x: left, y: top })];
  const markTop = top + (parts.picture === null ? 0 : parts.picture.h + parts.gap);
  const mark = parts.mark === null ? [] : [node('text', `${id}.text`, {
    x: left - parts.mark.ink.left, y: markTop + parts.mark.ink.up - parts.mark.layout.lines[0].y, layout: parts.mark.layout, font: parts.mark.font,
    fill: look.palette.ink, role: 'mark',
  })];
  return [cardGroup(card, id, [...picture, ...mark], { rotate: data.turn, fixed: true }), ...ringNodes(id, placed.box, ctx, data)];
}

// The slow ring (look.kinds.end.ring: { gap, width, dur } in units and seconds): a rounded outline `gap` outside the
// mark's card, in the accent with round caps, drawing on over `dur` once the card has entered, pinned to the frame.
function ringNodes(id, [x, y, w, h], ctx, data) {
  if (!data.ring) return [];
  const { look, unit } = ctx;
  const gap = data.ring.gap * unit;
  const radius = (look.devices.card?.radius ?? 0) * unit + gap;
  const start = look.moves.enter.dur;
  const d = roundedRect(x - gap, y - gap, w + HALF * gap, h + HALF * gap, Math.min(radius, (h + HALF * gap) / HALF));
  const draw = track([{ t: 0, v: 0 }, { t: start, v: 0 }, { t: start + data.ring.dur, v: 1, ease: look.moves.draw.ease }]);
  return [node('path', `${id}.ring`, { d, stroke: look.palette.accent, strokeWidth: data.ring.width * unit, lineCap: 'round', fixed: true }, { tracks: { draw } })];
}

// ---- desk: the title and the ask ----


// The title fitted to columns 2..toWide (toTall on vertical formats) and the ask under it, at y = 0: { title, ask, span,
// top, bottom } with top the title's first cap line and bottom the block's last baseline (relative to y).
function deskBlock(shot, ctx, data) {
  const { look, canvas, unit, measure } = ctx;
  const span = editorialSpan(ctx, FIRST_COLUMN, isWide(canvas) ? data.toWide : data.toTall);
  const min = sizeAt(look, data.fromStep, unit), max = data.max * unit;
  const opts = { text: setCase(look, 'display', titleOf(shot)), font: fontFor(look, 'display', max, unit), maxWidth: span.w, align: 'left', measure, optical: true };
  const title = fitDisplay(opts, { min, max, maxHeight: editorialBounds(ctx).height(data.height), maxLines: look.maxLines.display }, look, unit);
  const size = title.font.size;
  const top = title.layout.lines[0].y - CAP_HEIGHT * size;
  const last = title.layout.lines.at(-1).y;
  if (shot.ask === undefined) return { title, ask: null, span, top, bottom: last };
  // the ask in the label face (look review 1: a small grotesque line read as off-system and vanished on the phone tile)
  // a third of the title, the largest the hero rule allows (director's note after look review 2: the step-2 ask was
  // lost on the phone tile); the title is the hero, the ask the second size, the mark the third
  const font = fontFor(look, 'label', size / MIN_HERO_RATIO, unit);
  const layout = layoutText({ text: setCase(look, 'label', shot.ask), font, maxWidth: span.w, measure });
  const y = last + data.askGap * size + CAP_HEIGHT * font.size - layout.lines[0].y;
  return { title, ask: { font, layout, y }, span, top, bottom: y + layout.lines.at(-1).y };
}


// The boxes the title and the ask cover with the block's top-left at y: from each one's first cap line to just under its
// last baseline, as wide as its widest line.
function blockParts(block, y) {
  const part = (layout, at, size) => {
    const top = at + layout.lines[0].y - CAP_HEIGHT * size;
    return [block.span.x, top, layout.width, at + layout.lines.at(-1).y + WORD_DESCENT * size - top];
  };
  const title = part(block.title.layout, y, block.title.font.size);
  return block.ask === null ? [title] : [title, part(block.ask.layout, y + block.ask.y, block.ask.font.size)];
}

// Where the block's top-left sits: its middle at data.centre of the height, moved up off the card (grown by CARD_CLEAR
// gutters, and across by the camera drift) as far as the top margin allows.
function deskY(block, card, ctx, data) {
  const { look, unit } = ctx;
  const bounds = editorialBounds(ctx);
  const y = bounds.at(data.centre) - (block.top + block.bottom) / HALF;
  if (card === null) return y;
  const by = CARD_CLEAR * look.grid.gutter * unit, drift = driftReach(look, unit);
  const [cx, cy, cw, ch] = card.turned;
  const clear = [cx - by - drift, cy - by, cw + HALF * (by + drift), ch + HALF * by];
  const hit = blockParts(block, y).filter((box) => overlaps(clear, box));
  if (hit.length === 0) return y;
  const up = Math.max(...hit.map((box) => box[1] + box[3] - clear[1]));
  return Math.max(bounds.top - block.top, y - up);
}

function expandDesk(shot, ctx, data, times) {
  const { look, unit } = ctx;
  const block = deskBlock(shot, ctx, data);
  const parts = cardParts(shot, ctx, data, block);
  const placed = parts === null ? null : cardBox(parts, ctx, data);
  const x = block.span.x, y = deskY(block, placed, ctx, data);
  const card = placed === null ? null : clearCard(placed, block, y, ctx); // under the block when the corner meets it
  const hero = heroId(shot, 'title');
  const matched = arrivesMatched(shot, ctx);
  const title = node('text', hero, { x, y, layout: block.title.layout, font: block.title.font, fill: look.palette.ink, role: 'hero' }, {
    wordTracks: times.title.map(({ at }) => (matched ? {} : enterTracks(look, unit, at))),
  });
  const words = wordBoxes(block.title.layout, x, y);
  const boxes = { title: unionBox(words), ...Object.fromEntries(words.map((box, i) => [`word:${i}`, box])) };
  const nodes = [title];
  if (block.ask !== null) {
    const askY = y + block.ask.y;
    nodes.push(node('text', `${shot.id}.ask`, { x, y: askY, layout: block.ask.layout, font: block.ask.font, fill: look.palette.ink, role: 'ask' }, {
      tracks: enterTracks(look, unit, times.ask, { y: askY }),
    }));
    boxes.ask = unionBox(wordBoxes(block.ask.layout, x, askY));
  }
  if (card !== null) boxes.mark = card.turned;
  const marks = card === null ? [] : cardNodes(shot, ctx, parts, card, data);
  return { nodes: [...marks, ...nodes], boxes, hero };
}

// ---- pop ----

function expandPop(shot, ctx, data, times) {
  const { look, unit } = ctx;
  const area = stackArea(ctx);
  // the ask is an action (look review 2): the look's tag in the accent, one line, under the stack; its words are part of
  // the hierarchy (review B I10), so the hero rule judges it (role 'ask'): the largest of data.askSteps the title's
  // largest line stays three times
  const picture = shot.src === undefined ? null : pictureSize(ctx.asset(shot.src), ctx.canvas);
  const above = picture === null ? 0 : picture.h + STACK.kickerGap * unit;
  const staged = { ...shot, kicker: shot.mark };
  const first = composeStack(setCase(look, 'display', titleOf(shot)), staged, ctx);
  // with the hero margin: at exactly three times, the page's measured sizes read 2.99 (review-browser, captions-browser)
  const stepFor = (p) => stepUnder(look, data.askSteps, unit, [{ size: Math.max(...p.lines.map((l) => l.font.size)), ratio: HERO_MARGIN * MIN_HERO_RATIO }]);
  const tagAt = (step) => (top, at) => plainTag(ctx, `${shot.id}.ask`, shot.ask, {
    left: area.left, top, maxWidth: area.w, at, fromStep: step, toStep: step, fill: 'accent', text: 'paper', snap: true, role: 'ask',
  });
  const placeWith = (step) => {
    const probe = shot.ask === undefined ? null : tagAt(step)(0, 0);
    return restack(first, ctx, { above, below: probe === null ? 0 : data.askGap * unit + probe.box[3] });
  };
  // the stack set again round the ask may come out smaller: then the ask is chosen again for the size it has
  let step = stepFor(first);
  let placed = placeWith(step);
  if (stepFor(placed) < step) placed = placeWith(step = stepFor(placed));
  const askTag = tagAt(step);
  const askProbe = shot.ask === undefined ? null : askTag(0, 0);
  const hero = heroId(shot, 'title');
  const flags = { ghost: ghostWords(ctx), matched: arrivesMatched(shot, ctx) };
  const stackTimes = times.title.map(({ at }) => ({ at, emphasised: false }));
  const built = stackNodes(staged, ctx, placed, { times: stackTimes, hero, ...flags });
  const boxes = { title: built.boxes.text, ...Object.fromEntries(Object.entries(built.boxes).filter(([k]) => k.startsWith('word:'))) };
  let group = built.group;
  const askNodes = [];
  if (askProbe !== null) {
    const last = placed.lines.at(-1);
    const tag = askTag(last.baseline + last.ink.down + data.askGap * unit, times.ask);
    askNodes.push(...tag.nodes);
    boxes.ask = tag.box;
  }
  const top = placed.kicker === null ? placed.lines[0].baseline - placed.lines[0].ink.up : placed.kicker.top;
  if (placed.kicker !== null) boxes.mark = tagBox(ctx, `${shot.id}.kicker`, shot.mark, placed.kicker.left, placed.kicker.top);
  const pictures = [];
  if (picture !== null) {
    const py = top - STACK.kickerGap * unit - picture.h;
    const image = node('image', `${shot.id}.picture.image`, { src: shot.src, w: picture.w, h: picture.h, x: -picture.w / HALF, y: -picture.h / HALF });
    pictures.push(entrance({ id: `${shot.id}.picture`, at: look.moves.enter.dur, look, unit, cx: area.left + picture.w / HALF, cy: py + picture.h / HALF, children: [image] }));
    boxes.mark = boxes.mark ?? [area.left, py, picture.w, picture.h];
  }
  return { nodes: [...pictures, ...built.kicker, group, ...askNodes], boxes, hero };
}

// ---- the kind ----

function expandEnd(shot, ctx) {
  assertNoBlanks(shot, 'end'); // a blank text is the validator's to refuse; expand names it rather than failing in layout
  const { look, timing, unit } = ctx;
  const data = kindData(look, KIND);
  const times = endTimes(shot, timing, cutReveal(shot, ctx));
  // a look may make the end a centred wordmark card (look.kinds.end.wordmark, cosmos: end-mark.mjs) when there is a mark
  const wordmark = isEditorial(look) && data.wordmark && shot.mark !== undefined && shot.src === undefined;
  const parts = wordmark ? expandWordmark(shot, ctx, data, times, titleOf(shot))
    : isEditorial(look) ? expandDesk(shot, ctx, data, times) : expandPop(shot, ctx, data, times);
  const behind = Object.fromEntries(Object.keys(parts.boxes).filter((k) => k === 'title' || k.startsWith('word:')).map((k) => [k, parts.hero]));
  const devices = onDevices(shot, ctx, { boxes: parts.boxes, defaultTarget: 'title', behind });
  return {
    nodes: placeDevices([fieldNode(shot, ctx), ...parts.nodes], devices),
    camera: [...defaultCamera(look, timing, unit), ...deviceCamera(devices)],
    boxes: parts.boxes,
    hero: parts.hero,
    background: look.palette.paper,
  };
}

// The kind's own rules: a reserved hero id, a card with no closing line, and a look with no data for the kind.
function endProblems(shot, { look } = {}) {
  const missing = wordsOf(titleOf(shot)).length === 0 ? [{ path: 'title', message: 'an end card needs a closing line: write "title" or "say"' }] : [];
  return [...heroProblems(shot), ...missing, ...kindSupportProblems(KIND, look)];
}

function endTargets(shot) {
  const words = wordsOf(titleOf(shot)).map((_, i) => `word:${i}`);
  return ['title', ...words, ...(shot.ask === undefined ? [] : ['ask']), ...(shot.mark === undefined && shot.src === undefined ? [] : ['mark'])];
}

// Emphasis is the look's own pointer on a statement; an end card does not draw it, so starred words are advice to drop.
function endReview(shot) {
  if (typeof shot.say !== 'string') return [];
  let tokens;
  try {
    tokens = parseSay(shot.say).tokens;
  } catch (err) {
    if (err instanceof SayError) return []; // the validator reports a say that does not parse
    throw err;
  }
  if (!tokens.some((t) => t.emphasis)) return [];
  return [{ path: 'say', at: 0, message: 'emphasis is not drawn on an end card; drop the *stars* from this say' }];
}

registries.kinds.add(KIND, {
  summary: 'The closing card: the closing line as the hero, a short ask under it (the last line of the stack in pop) and a mark (a name or wordmark, or a logo picture with src) on a taped card in desk or a tag in pop.',
  example: { id: 'close', show: 'end', say: 'Every number, with its source.', ask: 'Start today', mark: 'make-motion' },
  schema: {
    properties: {
      title: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: TITLE_MAX },
      ask: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: ASK_MAX },
      mark: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: MARK_MAX },
      src: { type: 'string', minLength: 1 },
      hero: HERO_SCHEMA,
    },
  },
  srcFields: ['src'],
  heroTarget: 'title',
  targets: endTargets,
  ids: (shot) => [heroId(shot, 'title')],
  // the field a node shows, for a review finding's path (scripts/v2/review.mjs): the ask, or the title (the say when the
  // shot has no title, which then shows its say); undefined for any other node (the mark)
  nodeField: (shot, id) => {
    const hero = heroId(shot, 'title');
    if (shot.ask !== undefined && (id === `${shot.id}.ask` || id.startsWith(`${shot.id}.ask.`) || id === `${hero}.ask`)) return 'ask';
    if (shot.mark !== undefined && (id.startsWith(`${shot.id}.mark.`) || id.startsWith(`${shot.id}.kicker`))) return 'mark';
    if (id === hero || id.startsWith(`${hero}.`)) return shot.title !== undefined ? 'title' : 'say';
    return undefined;
  },
  validate: endProblems,
  expand: (shot, ctx) => expandEnd(unmarked(shot), ctx),
  review: endReview,
  lookData: true, // a look ships it only with a kinds.end entry (engine/looks/index.mjs listedKinds)
  numbered: false, // no slug: the card closes the film and takes no place among its numbered shots
  showsWords: true, // its narration is the picture: never captioned (engine/captions)
});

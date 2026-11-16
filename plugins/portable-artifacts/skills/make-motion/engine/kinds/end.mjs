// The `end` kind: the film's closing card. A closing line (`title`, else the say), a short call to action (`ask`), a
// wordmark or name (`mark`) and an optional logo picture (`src`). An editorial composition (desk) sets the title as the
// hero in the display face flush left on column 2, the ask under it in the text face, and the mark on a small taped card
// in the bottom right (the slug's card without its number: frame furniture, never a second hero); a stack (pop) sets the
// title as a stack under the mark as a tag, with the ask as its last line in the accent. A picture sits where the mark
// would (on the card, or over the stack), at most a sixth of the short side. The title's words arrive as they are spoken
// (its first word on the shot's first frame); the ask lands on its own first spoken word, else just after the title's
// last. How each look composes it is look data (look.kinds.end). Emphasis in the say is not drawn here (the review says
// so). Pure and DOM-free.
import { registries } from '../registry.mjs';
import { node } from '../graph/node.mjs';
import { layoutText } from '../text/layout.mjs';
import { gridSpan, gridX, kindData, kindSupportProblems } from '../looks/index.mjs';
import { entrance, landing } from '../devices/shared.mjs';
import { parseSay, SayError } from '../script/say.mjs';
import {
  CAP_HEIGHT, WORD_DESCENT, HERO_SCHEMA, sizeAt, fontFor, heroId, isWide, arrivesMatched, wordsOf, fitDisplay, setCase, capBox,
  isEditorial, heroProblems, fieldNode, enterTracks, defaultCamera, onDevices, placeDevices, deviceCamera, unionBox, runInk,
  asTextCard, ghostTracks, driftReach,
} from './shared.mjs';
import { wordTimes } from './words.mjs';
import { SLUG } from './slug.mjs';
import { STACK, stackArea, composeStack, stackNodes } from './stack.mjs';
import { ghostWords } from './statement.mjs';
import { MIN_HERO_RATIO } from '../review/frame.mjs';

const KIND = 'end';
const TITLE_MAX = 120;
const ASK_MAX = 60;
const MARK_MAX = 32;
const FIRST_COLUMN = 2; // the title starts on column 2; the card's right margin mirrors it
export const PICTURE_SHARE = 1 / 6; // of the short side: the longest side of a logo picture
const ASK_LAG = 0.4; // seconds after the title's last word, for an ask that is not spoken
const ASK_HOLD = 0.6; // seconds an unspoken ask is on screen, at least, before the shot ends
const CARD_CLEAR = 2; // gutters between the title block's ink and the card (as a statement keeps off its slug)
const FIT_PASSES = 3;
const FIT_SLACK = 0.5; // px: a stack line is fitted this far inside the width
const WIDTH_TOLERANCE = 1; // px
const NO_WRAP = 1e6;
const EPSILON = 1e-6;
const HALF = 2;
const DEGREES_TO_RADIANS = Math.PI / 180;

// ---- the words ----

// A say that does not parse has its own validation error; it then gives no words.
function plainSay(say) {
  if (typeof say !== 'string') return '';
  try {
    return parseSay(say).plain;
  } catch (err) {
    if (err instanceof SayError) return '';
    throw err;
  }
}

const titleOf = (shot) => shot.title ?? plainSay(shot.say);

/** When the title's words and the ask land, in shot seconds: { title: [{ at }], ask }. An ask whose words are spoken
 *  lands on the first of them; otherwise ASK_LAG after the title's last word, ASK_HOLD before the shot ends at the
 *  latest (never before that last word). With no narration the title's first word lands at 0. */
export function endTimes(shot, timing) {
  const title = wordsOf(titleOf(shot));
  const ask = shot.ask === undefined ? [] : wordsOf(shot.ask);
  const times = wordTimes([...title, ...ask], timing);
  const titleTimes = times.slice(0, title.length);
  if (ask.length === 0) return { title: titleTimes, ask: null };
  const spoken = times.slice(title.length).find((t) => t.spoken !== null);
  if (spoken) return { title: titleTimes, ask: spoken.at };
  const last = titleTimes.at(-1)?.at ?? 0;
  return { title: titleTimes, ask: Math.max(last, Math.min(last + ASK_LAG, timing.duration - ASK_HOLD)) };
}

// ---- the picture ----

/** A picture's size in canvas pixels: its longest side PICTURE_SHARE of the short side, its aspect kept. */
export function pictureSize(picture, canvas) {
  const longest = Math.min(canvas.w, canvas.h) * PICTURE_SHARE;
  const scale = longest / Math.max(picture.width, picture.height);
  return { w: picture.width * scale, h: picture.height * scale };
}

// ---- desk: the card ----

// The card's contents laid out (the mark, the picture over it) and its size: null with neither.
function cardParts(shot, ctx, data) {
  if (shot.mark === undefined && shot.src === undefined) return null;
  const { look, unit, measure, canvas } = ctx;
  const pad = SLUG.pad * unit, gap = SLUG.gap * unit;
  let mark = null;
  if (shot.mark !== undefined) {
    const font = fontFor(look, 'display', sizeAt(look, data.markStep, unit), unit);
    const layout = layoutText({ text: setCase(look, 'display', shot.mark), font, maxWidth: NO_WRAP, measure });
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
  const right = canvas.w - gridX(look, canvas, FIRST_COLUMN), bottom = canvas.h - look.grid.margin * unit;
  const box = [right - parts.w, bottom - parts.h, parts.w, parts.h];
  const a = Math.abs(data.turn) * DEGREES_TO_RADIANS;
  const tw = parts.w * Math.cos(a) + parts.h * Math.sin(a), th = parts.w * Math.sin(a) + parts.h * Math.cos(a);
  const cx = box[0] + parts.w / HALF, cy = box[1] + parts.h / HALF;
  return { box, turned: [cx - tw / HALF, cy - th / HALF, tw, th] };
}

// The card's nodes: one group (the card's entrance, turned exactly data.turn, pinned to the frame) holding the card, the
// picture and the mark (frame furniture, as a slug's texts are).
function cardNodes(shot, ctx, parts, placed, data) {
  const { look, unit, seed } = ctx;
  const id = `${shot.id}.mark`;
  const card = registries.devices.get('card').build({ id, box: placed.box, at: look.moves.enter.dur, look, unit, seed }).nodes[0];
  const left = -parts.w / HALF + parts.pad, top = -parts.h / HALF + parts.pad;
  const picture = parts.picture === null ? [] : [node('image', `${id}.picture`, { src: shot.src, w: parts.picture.w, h: parts.picture.h, x: left, y: top })];
  const markTop = top + (parts.picture === null ? 0 : parts.picture.h + parts.gap);
  const mark = parts.mark === null ? [] : [node('text', `${id}.text`, {
    x: left - parts.mark.ink.left, y: markTop + parts.mark.ink.up - parts.mark.layout.lines[0].y, layout: parts.mark.layout, font: parts.mark.font,
    fill: look.palette.ink, role: 'mark', furniture: true,
  })];
  return [node('group', id, { ...card.props, rotate: data.turn, fixed: true }, { tracks: card.tracks, children: [...asTextCard(id, card.children), ...picture, ...mark] })];
}

// ---- desk: the title and the ask ----

// The ask's scale step: the largest of data.askSteps that keeps the title MIN_HERO_RATIO times its size (else the smallest).
function askStepFor(look, data, titleSize, unit) {
  const fits = data.askSteps.filter((step) => MIN_HERO_RATIO * sizeAt(look, step, unit) <= titleSize + EPSILON);
  return fits.length > 0 ? Math.max(...fits) : Math.min(...data.askSteps);
}

// The title fitted to columns 2..toWide (toTall on vertical formats) and the ask under it, at y = 0: { title, ask, span,
// top, bottom } with top the title's first cap line and bottom the block's last baseline (relative to y).
function deskBlock(shot, ctx, data) {
  const { look, canvas, unit, measure } = ctx;
  const span = gridSpan(look, canvas, FIRST_COLUMN, isWide(canvas) ? data.toWide : data.toTall);
  const min = sizeAt(look, data.fromStep, unit), max = data.max * unit;
  const opts = { text: setCase(look, 'display', titleOf(shot)), font: fontFor(look, 'display', max, unit), maxWidth: span.w, align: 'left', measure, optical: true };
  const title = fitDisplay(opts, { min, max, maxHeight: data.height * canvas.h, maxLines: look.maxLines.display }, look, unit);
  const size = title.font.size;
  const top = title.layout.lines[0].y - CAP_HEIGHT * size;
  const last = title.layout.lines.at(-1).y;
  if (shot.ask === undefined) return { title, ask: null, span, top, bottom: last };
  const font = fontFor(look, 'text', sizeAt(look, askStepFor(look, data, size, unit), unit), unit);
  const layout = layoutText({ text: setCase(look, 'text', shot.ask), font, maxWidth: span.w, measure });
  const y = last + data.askGap * size + CAP_HEIGHT * font.size - layout.lines[0].y;
  return { title, ask: { font, layout, y }, span, top, bottom: y + layout.lines.at(-1).y };
}

const overlaps = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];

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
  const { look, canvas, unit } = ctx;
  const y = data.centre * canvas.h - (block.top + block.bottom) / HALF;
  if (card === null) return y;
  const by = CARD_CLEAR * look.grid.gutter * unit, drift = driftReach(look, unit);
  const [cx, cy, cw, ch] = card.turned;
  const clear = [cx - by - drift, cy - by, cw + HALF * (by + drift), ch + HALF * by];
  const hit = blockParts(block, y).filter((box) => overlaps(clear, box));
  if (hit.length === 0) return y;
  const up = Math.max(...hit.map((box) => box[1] + box[3] - clear[1]));
  return Math.max(look.grid.margin * unit - block.top, y - up);
}

// The words' boxes of a laid-out text at (x, y), in canvas pixels, by word index.
const wordBoxes = (layout, x, y) => layout.lines.flatMap((line) => line.words.map((w) => ({ index: w.index, box: capBox(x + line.x + w.x, y + line.y, w.width, layout.size) })))
  .sort((a, b) => a.index - b.index).map((w) => w.box);

function expandDesk(shot, ctx, data, times) {
  const { look, unit } = ctx;
  const parts = cardParts(shot, ctx, data);
  const card = parts === null ? null : cardBox(parts, ctx, data);
  const block = deskBlock(shot, ctx, data);
  const x = block.span.x, y = deskY(block, card, ctx, data);
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

// One display line of `text` at `size`: { font, layout, ink, width } with the ink in the line's own space.
function lineAt(text, size, ctx) {
  const font = fontFor(ctx.look, 'display', size, ctx.unit);
  const layout = layoutText({ text, font, maxWidth: NO_WRAP, measure: ctx.measure });
  const ink = runInk(layout.lines[0], font, ctx.measure);
  return { font, layout, ink, width: ink.right - ink.left };
}

const lineText = (line) => line.layout.lines[0].words.map((w) => w.text).join(' ');
const lineGap = (a, b) => STACK.gap * Math.max(a.font.size, b.font.size);
const stackHeight = (lines) => lines.reduce((sum, l, k) => sum + l.ink.up + l.ink.down + (k === 0 ? 0 : lineGap(l, lines[k - 1])), 0);

/**
 * A composed stack (stack.mjs composeStack) set again with room kept `above` its tag (or first line) and `below` its last
 * line, in px: its lines set smaller in proportion when stack, tag and room do not fit the stack's area (a line under
 * scale step 3 says so, overflow: true, as composeStack does), and the whole, room included, centred in the area.
 */
export function restack(placed, ctx, { above = 0, below = 0 }) {
  const { area } = placed;
  const first = placed.lines[0];
  const tag = placed.kicker === null ? 0 : first.baseline - first.ink.up - placed.kicker.top; // the tag and its gap
  const min = sizeAt(ctx.look, STACK.fromStep, ctx.unit);
  const room = area.h - tag - above - below;
  let lines = placed.lines;
  for (let i = 0; i < FIT_PASSES && stackHeight(lines) > room + EPSILON; i++) {
    const share = room / stackHeight(lines);
    lines = lines.map((line) => {
      const next = lineAt(lineText(line), line.font.size * share, ctx);
      return next.font.size < min ? { ...next, layout: { ...next.layout, overflow: true } } : next;
    });
  }
  let top = area.top + (area.h - stackHeight(lines) - tag - above - below) / HALF + above + tag;
  const out = lines.map((line, k) => {
    if (k > 0) top += lineGap(line, lines[k - 1]);
    const baseline = top + line.ink.up;
    top = baseline + line.ink.down;
    return { ...line, x: area.left - line.ink.left, baseline };
  });
  const kicker = placed.kicker === null ? null : { ...placed.kicker, top: out[0].baseline - out[0].ink.up - tag };
  return { ...placed, lines: out, kicker };
}

/** One line fitted so its ink fills `width`, between `min` and `max` px; one still too wide at `min` says so (overflow). */
export function fittedLine(text, width, { min, max }, ctx) {
  let line = lineAt(text, max, ctx);
  for (let i = 0; i < FIT_PASSES; i++) {
    const size = Math.min(max, Math.max(min, (line.font.size * (width - FIT_SLACK)) / line.width));
    if (size === line.font.size) break;
    line = lineAt(text, size, ctx);
  }
  return line.width <= width + WIDTH_TOLERANCE ? line : { ...line, layout: { ...line.layout, overflow: true } };
}

// A word's tracks in a stack line: a ghost lit when spoken (a mode that reads from frame 0), else a fade on its time.
function stackWordTracks(look, at, lit, { ghost, matched }) {
  if (ghost) return ghostTracks(look, at, lit);
  return matched ? {} : { opacity: landing(at, look.moves.enter, 0, 1) };
}

/** The tag's plate box as the tag device builds it at (left, top), [x, y, w, h] in canvas pixels. */
export const tagBox =(ctx, id, text, left, top) => registries.devices.get('tag').build({
  id, text, box: [left, top, 1, 1], at: 0, look: ctx.look, unit: ctx.unit, seed: ctx.seed, measure: ctx.measure,
}).boxes.tag;

function expandPop(shot, ctx, data, times) {
  const { look, unit } = ctx;
  const area = stackArea(ctx);
  const ask = shot.ask === undefined ? null
    : fittedLine(setCase(look, 'display', shot.ask), area.w, { min: sizeAt(look, data.askFromStep, unit), max: sizeAt(look, data.askToStep, unit) }, ctx);
  const picture = shot.src === undefined ? null : pictureSize(ctx.asset(shot.src), ctx.canvas);
  const askRoom = ask === null ? 0 : data.askGap * unit + ask.ink.up + ask.ink.down;
  const above = picture === null ? 0 : picture.h + STACK.kickerGap * unit;
  const staged = { ...shot, kicker: shot.mark };
  const placed = restack(composeStack(setCase(look, 'display', titleOf(shot)), staged, ctx), ctx, { above, below: askRoom });
  const hero = heroId(shot, 'title');
  const flags = { ghost: ghostWords(ctx), matched: arrivesMatched(shot, ctx) };
  const stackTimes = times.title.map(({ at }) => ({ at, emphasised: false }));
  const built = stackNodes(staged, ctx, placed, { times: stackTimes, hero, ...flags });
  const boxes = { title: built.boxes.text, ...Object.fromEntries(Object.entries(built.boxes).filter(([k]) => k.startsWith('word:'))) };
  let group = built.group;
  if (ask !== null) {
    const last = placed.lines.at(-1);
    const baseline = last.baseline + last.ink.down + data.askGap * unit + ask.ink.up;
    const x = area.left - ask.ink.left;
    const askNode = node('text', `${hero}.ask`, { x, y: baseline - ask.layout.lines[0].y, layout: ask.layout, font: ask.font, fill: look.palette.accent, role: 'hero', stack: hero }, {
      wordTracks: ask.layout.lines[0].words.map(() => stackWordTracks(look, times.ask, look.palette.accent, flags)),
    });
    group = node('group', hero, {}, { children: [...group.children, askNode] });
    boxes.ask = capBox(area.left, baseline, ask.width, ask.font.size);
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
  return { nodes: [...pictures, ...built.kicker, group], boxes, hero };
}

// ---- the kind ----

function expandEnd(shot, ctx) {
  const { look, timing, unit } = ctx;
  const data = kindData(look, KIND);
  const times = endTimes(shot, timing);
  const parts = isEditorial(look) ? expandDesk(shot, ctx, data, times) : expandPop(shot, ctx, data, times);
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
      title: { type: 'string', minLength: 1, maxLength: TITLE_MAX },
      ask: { type: 'string', minLength: 1, maxLength: ASK_MAX },
      mark: { type: 'string', minLength: 1, maxLength: MARK_MAX },
      src: { type: 'string', minLength: 1 },
      hero: HERO_SCHEMA,
    },
  },
  srcFields: ['src'],
  heroTarget: 'title',
  targets: endTargets,
  ids: (shot) => [heroId(shot, 'title')],
  validate: endProblems,
  expand: expandEnd,
  review: endReview,
  numbered: false, // no slug: the card closes the film and takes no place among its numbered shots
  showsWords: true, // its narration is the picture: never captioned (engine/captions)
});

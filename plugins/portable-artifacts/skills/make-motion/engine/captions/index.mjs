// Captions (design 9.3): the spoken words of a narrated shot whose kind does not show its own words (a kind declares
// `showsWords: true`; statement and number do), drawn in the look's caption style. Importing this file registers the
// styles `lower` (desk) and `stack` (pop) in registries.captions (once: a second evaluation leaves the registry as it is).
//
// A caption style is { summary, zone(ctx) -> [x, y, w, h], compose(words, ctx) -> nodes }: `zone` is the canvas-pixel
// rectangle its text stays inside on this canvas, `compose` the shot's caption nodes from the timeline's words (measured
// or estimated, shot seconds). `ctx` is the shot's ctx (graph/film.mjs shotContext) plus `captionId` (the id every
// caption node starts with), `hero` (the id of the shot's hero node, or null) and `filmStart` (the film second the shot
// starts at). Each caption text node carries props.role 'caption', props.furniture and props.caption = { zone, end,
// hero, emphasis }: its zone, the film second its last word ends, the hero id and the word indexes (of its layout) that
// are emphasised, which the frame review's caption rules read (engine/review/frame.mjs). A clipping's own `caption` (the
// author's line on a card) is a different thing and carries no props.caption.
//
// Timing: a group shows from its first word's start until the next group starts or CAPTION_HOLD after its last word
// ends, whichever is first, and never past the shot: stepped, so every frame it is on screen it is whole (the review
// judges a text only once it has landed). Pure and DOM-free.
import { registries } from '../registry.mjs';
import { endsSentence } from '../text/breaks.mjs';
import { sampleGraph } from '../graph/sample.mjs';
import { pathPoints } from '../devices/shared.mjs';
import { compositionRect } from '../kinds/shared.mjs';
import { lower } from './lower.mjs';
import { stack } from './stack.mjs';

/** Seconds a caption group stays after its last word ends (the review allows 0.3). */
export const CAPTION_HOLD = 0.2;
// A word that ends a clause: , ; : or a dash (spaced, or closing the word), with any closing quote or bracket after it.
const CLAUSE_END = /[,;:–—-]["'”’)\]]*$/;
// Costs of the grouping's dynamic program: every group, a group of one word in a sentence of more, a break that is not
// after clause punctuation, and the squared share of a group's unused characters (balance).
const COST = Object.freeze({ group: 1, lone: 100, offClause: 2, balance: 1 });
const AVOID_STEP = 0.1; // seconds between the samples of where a pinned card stands
const DEGREES_TO_RADIANS = Math.PI / 180;

const isWhole = (n) => Number.isInteger(n) && n >= 1;

// The words as units that are never split: a merged run (consecutive words sharing one start and end, as a voice gives
// "$5 million") is one unit. Each unit is { first, last } (word indexes, inclusive).
function unitsOf(words) {
  const units = [];
  words.forEach((w, i) => {
    const prev = units.at(-1);
    const shares = prev && words[prev.last].start === w.start && words[prev.last].end === w.end;
    if (shares) prev.last = i;
    else units.push({ first: i, last: i });
  });
  return units;
}

// The units split into sentences: a sentence ends at a unit whose last word ends one (or at the last unit).
function sentencesOf(units, words) {
  const sentences = [[]];
  units.forEach((u, k) => {
    sentences.at(-1).push(u);
    if (endsSentence(words[u.last].text) && k < units.length - 1) sentences.push([]);
  });
  return sentences;
}

// The cost of one group: units[i..j) of a sentence of `units`, Infinity when it breaks the limits (a single unit never
// does: it cannot be split).
function groupCost(units, i, j, words, { maxWords, maxChars }) {
  const first = units[i].first, last = units[j - 1].last;
  const count = last - first + 1;
  const chars = words.slice(first, last + 1).map((w) => w.text).join(' ').length;
  if (j - i > 1 && (count > maxWords || chars > maxChars)) return Infinity;
  const sentenceWords = units.at(-1).last - units[0].first + 1;
  const lone = count === 1 && sentenceWords > 1 ? COST.lone : 0;
  const offClause = j < units.length && !CLAUSE_END.test(words[last].text) ? COST.offClause : 0;
  const slack = Math.max(0, maxChars - chars) / maxChars;
  return COST.group + lone + offClause + COST.balance * slack * slack;
}

// One sentence's units as groups, by a dynamic program over break points (fewest groups, breaks after clause
// punctuation, no group of one word, balanced). Ties keep the earlier break.
function sentenceGroups(units, words, limits) {
  const best = [0], from = [0];
  for (let j = 1; j <= units.length; j++) {
    best[j] = Infinity;
    for (let i = 0; i < j; i++) {
      const cost = best[i] + groupCost(units, i, j, words, limits);
      if (cost < best[j]) { best[j] = cost; from[j] = i; }
    }
  }
  const groups = [];
  for (let j = units.length; j > 0; j = from[j]) groups.unshift({ first: units[from[j]].first, last: units[j - 1].last });
  return groups;
}

/**
 * The words of a shot as caption groups, in order: { first, last, words } (word indexes, inclusive, and the words).
 * Breaks at sentence ends first (a group never runs across one), then after clause punctuation; never splits a merged
 * pair (two words sharing one time); never leaves a group of one word unless its sentence is one word; a group holds at
 * most `maxWords` words and `maxChars` characters (spaces included) unless it is one unbreakable unit.
 * @param {{ text: string, start: number, end: number }[]} words @param {{ maxWords: number, maxChars: number }} limits
 */
export function captionGroups(words, { maxWords, maxChars } = {}) {
  if (!isWhole(maxWords) || !isWhole(maxChars)) throw new RangeError(`captionGroups: maxWords and maxChars must be whole numbers of 1 or more, got ${maxWords} and ${maxChars}`);
  if (!Array.isArray(words)) throw new TypeError('captionGroups: words must be an array of timeline words');
  if (words.length === 0) return [];
  return sentencesOf(unitsOf(words), words)
    .flatMap((sentence) => sentenceGroups(sentence, words, { maxWords, maxChars }))
    .map(({ first, last }) => ({ first, last, words: words.slice(first, last + 1) }));
}

/**
 * When each group is on screen, in shot seconds: { at, until, end } with `end` its last word's end. `until` is the next
 * group's start or `end + CAPTION_HOLD`, whichever is first, inside the shot, and at least one frame after `at`.
 */
export function groupTimes(groups, { duration, fps }) {
  return groups.map((g, k) => {
    const at = g.words[0].start;
    const end = Math.max(...g.words.map((w) => w.end));
    const next = groups[k + 1]?.words[0].start ?? Infinity;
    const until = Math.min(next, end + CAPTION_HOLD, duration);
    return { at, end, until: Math.min(duration, Math.max(until, at + 1 / fps)) };
  });
}

/** Is the film captioned? Its `captions` (true or false) when it says, else the mode's data. */
export function captionsOn(film, mode) {
  if (film.captions === undefined) return mode.captions === true;
  if (typeof film.captions !== 'boolean') throw new TypeError(`captions must be true or false, got ${JSON.stringify(film.captions)}`);
  return film.captions;
}

// A point turned by `deg` degrees about the origin.
function turn([x, y], deg) {
  const a = deg * DEGREES_TO_RADIANS, cos = Math.cos(a), sin = Math.sin(a);
  return [x * cos - y * sin, x * sin + y * cos];
}

// The canvas box of a sampled card paper `paper` inside the sampled pinned group `group`.
function paperBox(group, paper) {
  const pts = pathPoints(paper.props.d).map((p) => {
    const [px, py] = turn(p, paper.rotate);
    const [gx, gy] = turn([(px + paper.x) * group.scale, (py + paper.y) * group.scale], group.rotate);
    return [group.x + gx, group.y + gy];
  });
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
}

/**
 * Where the kind's pinned text cards (a slug, a clipping's caption card: a top-level node with props.fixed holding a
 * paper with props.textCard) stand over the shot: their paper boxes in canvas pixels, every AVOID_STEP seconds and on the
 * last instant. Pinned nodes ignore the camera, so their own tracks place them.
 */
export function pinnedCards(nodes, duration) {
  const cards = nodes.filter((n) => n.props.fixed === true && n.children.some((c) => c.props.textCard === true));
  if (cards.length === 0) return [];
  const times = [...Array.from({ length: Math.floor(duration / AVOID_STEP) + 1 }, (_, i) => i * AVOID_STEP), duration];
  return times.flatMap((t) => sampleGraph(cards, t).filter((g) => g.opacity > 0)
    .flatMap((g) => g.children.filter((c) => c.props.textCard === true).map((paper) => paperBox(g, paper))));
}

const captioned = (kind, ctx) => kind.showsWords !== true && ctx.timing.words.length > 0;

/**
 * The ctx a shot's kind composes in. A captioned shot whose look composes inside the platform safe zone (compositionRect
 * safe: pop on 9:16) gives up the caption zone at the bottom of that zone, and a gutter over it: they come off the
 * bottom of ctx.viralInsets, so the picture, the clipping's own caption and the rest keep clear of the captions. Any
 * other shot composes in `ctx` as it is.
 * @param {object} film @param {object} kind @param {object} ctx the shot's ctx (shotContext)
 */
export function kindContext(film, kind, ctx) {
  if (!ctx.viralInsets || !captionsOn(film, ctx.mode) || !captioned(kind, ctx)) return ctx;
  const rect = compositionRect(ctx);
  if (!rect.safe) return ctx;
  const zone = registries.captions.get(ctx.look.captions).zone(ctx);
  const room = rect.top + rect.h - zone[1] + ctx.look.grid.gutter * ctx.unit;
  return room > 0 ? { ...ctx, viralInsets: { ...ctx.viralInsets, bottom: ctx.viralInsets.bottom + room } } : ctx;
}

/**
 * The caption nodes of one shot (none when its kind shows its own words or it has no narration), from the look's style.
 * The style's ctx also carries `avoid`: the boxes of the kind's pinned text cards over the shot (pinnedCards).
 * @param {object} shot @param {object} ctx the shot's ctx (shotContext)
 * @param {{ kind: object, hero: string | null, filmStart: number, nodes: object[] }} p nodes: the kind's nodes
 */
export function shotCaptions(shot, ctx, { kind, hero, filmStart, nodes }) {
  if (!captioned(kind, ctx)) return [];
  const style = registries.captions.get(ctx.look.captions);
  const avoid = pinnedCards(nodes, ctx.timing.duration);
  return style.compose(ctx.timing.words, { ...ctx, captionId: `${shot.id}.captions`, hero, filmStart, avoid });
}

for (const style of [lower, stack]) {
  if (!registries.captions.has(style.name)) registries.captions.add(style.name, Object.freeze(style));
}

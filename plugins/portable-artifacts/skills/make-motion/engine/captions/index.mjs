// Captions (design 9.3): the spoken words of a narrated shot whose kind does not show its own words (a kind declares
// `showsWords: true`; statement and number do), drawn in the look's caption style. Importing this file registers the
// styles `lower` (desk), `stack` (pop) and `pill` (cosmos) in registries.captions (once: a second evaluation leaves the
// registry as it is);
// a style added to that registry must be { summary, zone, compose } (validateCaptionStyle).
//
// A caption style is { summary, zone(ctx) -> [x, y, w, h], compose(words, ctx) -> nodes }: `zone` is the canvas-pixel
// rectangle its text stays inside on this canvas, `compose` the shot's caption nodes from the timeline's words (measured
// or estimated, shot seconds). `ctx` is the shot's ctx (graph/film.mjs shotContext) plus `captionId` (the id every
// caption node starts with), `hero` (the id of the shot's hero node, or null), `filmStart` (the film second the shot
// starts at), `avoid` (the boxes of the kind's pinned text cards over the shot), `markIds` (the ids of the shot's mark
// devices: a highlight, circle, underline, bracket or focus event, `<shot>.on<j>`) and `marks` (where those stand on the
// frame, camera applied, over the shot). Each caption text node carries props.role 'caption', props.furniture and
// props.caption = { zone, end, hero, emphasis, marks }: its zone, the film second its last word ends, the hero id, the
// word indexes (of its layout) that are emphasised and the mark ids, which the frame review's caption rules read
// (engine/review/frame.mjs). A clipping's own `caption` (the author's line on a card) carries no props.caption.
//
// Grouping and timing live in groups.mjs (re-exported here), which imports no style, so any caption module can be
// imported first. Pure and DOM-free.
import { registries } from '../registry.mjs';
import { sampleGraph } from '../graph/sample.mjs';
import { applyCamera } from '../graph/camera.mjs';
import { compositionRect } from '../kinds/shared.mjs';
import { markBoxes, pathBox, walkPlaced } from '../review/marks.mjs';
import { lower } from './lower.mjs';
import { stack } from './stack.mjs';
import { pill } from './pill.mjs';

export { CAPTION_HOLD, captionGroups, groupTimes } from './groups.mjs';

/** The devices whose event marks a region or a text: a caption keeps off what they mark while they are on screen. */
export const MARK_DEVICES = Object.freeze(['highlight', 'circle', 'underline', 'bracket', 'focus']);
const AVOID_STEP = 0.1; // seconds between the samples of where a pinned card or a mark stands
const STYLE_FIELDS = Object.freeze([['summary', 'string'], ['zone', 'function'], ['compose', 'function']]);

/** Is the film captioned? Its `captions` (true or false) when it says, else the mode's data. */
export function captionsOn(film, mode) {
  if (film.captions === undefined) return mode.captions === true;
  if (typeof film.captions !== 'boolean') throw new TypeError(`captions must be true or false, got ${JSON.stringify(film.captions)}`);
  return film.captions;
}

// ---- where things stand on the frame ----

/**
 * Where the marks `ids` stand in a sampled tree (camera applied), as canvas boxes: engine/review/marks.mjs markBoxes,
 * the computation the frame review judges a caption over a mark with, so the two never disagree.
 */
export const markedBoxes = (sampled, ids) => markBoxes(sampled, ids).map((m) => m.box);

/** The ids of a shot's mark devices (MARK_DEVICES events), as the kinds name them: `<shot id>.on<j>`. */
export const markIds = (shot) => (shot.on ?? []).flatMap((item, j) => (MARK_DEVICES.includes(item.do) ? [`${shot.id}.on${j}`] : []));

const sampleTimes = (duration) => [...Array.from({ length: Math.floor(duration / AVOID_STEP) + 1 }, (_, i) => i * AVOID_STEP), duration];

// Where a shot's marks stand over the shot: markedBoxes every AVOID_STEP seconds, the shot's camera applied.
function marksOver(nodes, camera, canvas, duration, ids) {
  if (ids.length === 0 || typeof camera !== 'function') return [];
  return sampleTimes(duration).flatMap((t) => markedBoxes(applyCamera(sampleGraph(nodes, t), camera(t), canvas), ids));
}

// The paper boxes of the pinned text cards in one sampled list of cards (each card a top-level node).
function cardPapers(sampled) {
  const roots = new Set(sampled), boxes = [];
  walkPlaced(sampled, (n, m, parent) => {
    const box = parent !== null && roots.has(parent) && n.props.textCard === true ? pathBox(n, m) : null;
    if (box !== null) boxes.push(box);
  });
  return boxes;
}

/**
 * Where the kind's pinned text cards (a slug, a clipping's caption card: a top-level node with props.fixed holding a
 * paper with props.textCard) stand over the shot: their paper boxes in canvas pixels, every AVOID_STEP seconds and on the
 * last instant. Pinned nodes ignore the camera, so their own tracks place them.
 */
export function pinnedCards(nodes, duration) {
  const cards = nodes.filter((n) => n.props.fixed === true && n.children.some((c) => c.props.textCard === true));
  if (cards.length === 0) return [];
  return sampleTimes(duration).flatMap((t) => cardPapers(sampleGraph(cards, t)));
}

// ---- a shot's captions ----

/** Does `kind` show the narration of `shot` itself? Its `showsWords`: true, or a function of the shot (media: only
 *  when it has a caption). */
export const showsWordsOf = (kind, shot) => (typeof kind.showsWords === 'function' ? kind.showsWords(shot) === true : kind.showsWords === true);

const captioned = (kind, ctx, shot) => !showsWordsOf(kind, shot) && ctx.timing.words.length > 0;

/**
 * The ctx a shot's kind composes in. A captioned shot whose look composes inside the platform safe zone (compositionRect
 * safe: pop on 9:16) gives up the caption zone at the bottom of that zone, and a gutter over it: ctx.captionRoom, which
 * compositionRect takes off the bottom, so the picture, the clipping's own caption and the rest keep clear of the captions. Any
 * other shot composes in `ctx` as it is.
 * @param {object} film @param {object} kind @param {object} ctx the shot's ctx (shotContext)
 */
export function kindContext(film, kind, ctx) {
  if (!ctx.viralInsets || !captionsOn(film, ctx.mode) || !captioned(kind, ctx, film.shots[ctx.timing.index])) return ctx;
  const rect = compositionRect(ctx);
  if (!rect.safe) return ctx;
  const zone = registries.captions.get(ctx.look.captions).zone(ctx);
  const room = rect.top + rect.h - zone[1] + ctx.look.grid.gutter * ctx.unit;
  return room > 0 ? { ...ctx, captionRoom: room } : ctx; // compositionRect takes it off the bottom
}

/**
 * The caption nodes of one shot (none when its kind shows its own words or it has no narration), from the look's style.
 * @param {object} shot @param {object} ctx the shot's ctx (shotContext)
 * @param {{ kind: object, hero: string | null, filmStart: number, nodes: object[], camera?: Function }} p nodes: the
 *   kind's nodes; camera: the shot's camera, (t) => { x, y, zoom, rotate } (graph/film.mjs), for where its marks stand
 */
export function shotCaptions(shot, ctx, { kind, hero, filmStart, nodes, camera }) {
  if (!captioned(kind, ctx, shot)) return [];
  const style = registries.captions.get(ctx.look.captions);
  const ids = markIds(shot);
  const marks = marksOver(nodes, camera, ctx.canvas, ctx.timing.duration, ids);
  return style.compose(ctx.timing.words, { ...ctx, captionId: `${shot.id}.captions`, hero, filmStart, avoid: pinnedCards(nodes, ctx.timing.duration), markIds: ids, marks });
}

// ---- registration ----

/** Throws a RangeError naming the style and the field when `style` is not { summary: string, zone, compose }. */
export function validateCaptionStyle(name, style) {
  for (const [field, type] of STYLE_FIELDS) {
    if (typeof style?.[field] !== type) throw new RangeError(`caption style "${name}": ${field} must be a ${type}, got ${typeof style?.[field]}`);
  }
  return style;
}

// Every style added to the shared registry is checked as it is added, as looks and modes are (once: a second evaluation
// of this file keeps the first wrapper).
const addStyle = registries.captions.add;
if (!addStyle.validatesStyles) {
  const checkedAdd = (name, style) => {
    validateCaptionStyle(name, style);
    addStyle(name, style);
  };
  checkedAdd.validatesStyles = true;
  registries.captions.add = checkedAdd;
}

for (const style of [lower, stack, pill]) {
  if (!registries.captions.has(style.name)) registries.captions.add(style.name, Object.freeze(style));
}

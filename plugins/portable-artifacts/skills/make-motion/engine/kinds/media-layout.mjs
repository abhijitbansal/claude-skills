// How the `media` kind lays out (media.mjs registers it): the cover crop of a picture around its focus, the caption fitted
// to its room at the largest of the look's steps, the credit at the format's reading floor (drawn only where the caption
// is three times it), the picture group that pushes slowly from look.kinds.media.push to 1 over the shot, and the two
// fits: `bleed` (the picture covers the frame; the caption on the look's card low on the left columns, desk taped paper,
// pop a white plate) and `cutout` (the picture as an object, the caption beside it on a wide frame and under it on a
// tall one, the picture then cropped to fill what the caption leaves). Pure and DOM-free.
import { registries } from '../registry.mjs';
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';
import { layoutText } from '../text/layout.mjs';
import { gridSpan } from '../looks/index.mjs';
import { colourOf } from '../devices/shared.mjs';
import { treatmentFor } from '../devices/treatments.mjs';
import { fontFor, sizeAt, isWide, isEditorial, compositionRect, captionTop, setCase, easePeak, cardOf, cardGroup } from './shared.mjs';
import { driftReach } from './camera.mjs';
import { arrivalTrack, revealTimes, editorialLeft, EDITORIAL_WIDE_COLUMN } from './arrivals.mjs';
import { clipFrameTrack } from './media-clip.mjs';

const HALF = 2;
const STEP_EPSILON = 1e-6;
const MIN_TALL_ASPECT = 0.5; // a tall frame's cut-out is never cropped narrower than 1:2
const CREDIT_PAD = 10; // units of plate round the credit
const NO_WRAP = 1e6; // px: a credit is one line
// the marked subject: `focus` and this share of the picture's height either side of it, which a caption card keeps clear
const SUBJECT_REACH = 0.25;
const MAX_LIFT = 1.5; // the bleed picture is drawn at most this much larger to lift its subject clear of the card
const PUSH_EASE = 'outCubic'; // the push's ease where the look's settle overshoots (a spring would dip under 1)

/** The window [sx, sy, sw, sh] of `picture` that covers a `box` ({ w, h }) at its aspect, centred on `focus` ([x, y]
 *  fractions of the picture) as far as the picture allows. */
export function coverCrop(picture, box, [fx, fy]) {
  const aspect = box.w / box.h;
  const clamp = (v, hi) => Math.min(Math.max(v, 0), hi);
  if (picture.width / picture.height > aspect) {
    const sw = picture.height * aspect;
    return [clamp(fx * picture.width - sw / HALF, picture.width - sw), 0, sw, picture.height];
  }
  const sh = picture.width / aspect;
  return [0, clamp(fy * picture.height - sh / HALF, picture.height - sh), picture.width, sh];
}

// ---- text ----

// The caption fitted to `maxWidth` in the display face: the largest of `steps` at which it takes at most `maxLines`
// lines and no line (a long word included) is wider than `maxWidth`, else the smallest step. Null without a caption.
export function fitCaption(shot, ctx, steps, maxWidth, maxLines) {
  if (shot.caption === undefined) return null;
  const { look, unit, measure } = ctx;
  const text = setCase(look, 'display', shot.caption);
  const sized = [...steps].sort((a, b) => b - a).map((step) => {
    const font = fontFor(look, 'display', sizeAt(look, step, unit), unit);
    return { font, layout: layoutText({ text, font, maxWidth, measure }) };
  });
  return sized.find((s) => s.layout.lines.length <= maxLines && s.layout.width <= maxWidth + STEP_EPSILON) ?? sized.at(-1);
}

// The credit at the format's reading floor (the look's second step on a tall frame, its first on a wide one), in the
// label face; `drawn` only when there is no caption or the caption is three times it.
export function fitCredit(shot, ctx, caption) {
  if (shot.credit === undefined) return null;
  const { look, unit, measure, canvas } = ctx;
  const font = fontFor(look, 'label', sizeAt(look, isWide(canvas) ? 1 : 2, unit), unit);
  const layout = layoutText({ text: setCase(look, 'label', shot.credit), font, maxWidth: NO_WRAP, measure });
  const drawn = caption === null || caption.font.size >= 3 * font.size - STEP_EPSILON;
  return { font, layout, drawn };
}

// The colour of text set on the look's card: paper on a card filled with ink (pop's white plate), else ink.
const onCard = (look) => (colourOf(look, look.devices.card?.fill ?? 'paper') === look.palette.ink ? look.palette.paper : look.palette.ink);

// The caption text node at (x, y) in `fill`, each word shown as it is spoken (arrivals.mjs revealTimes); it names the
// credit as left out when the credit was not drawn (the frame review's "dropped" finding).
function captionNode(shot, ctx, caption, [x, y], credit, fill) {
  const times = revealTimes(caption.layout, ctx.timing);
  return node('text', `${shot.id}.caption`, {
    x, y, layout: caption.layout, font: caption.font, fill,
    ...(credit && !credit.drawn ? { dropped: ['credit'] } : {}),
  }, { wordTracks: times.map((at) => ({ opacity: arrivalTrack(at) })) });
}

// The credit on a small plate in the card's colour, its top right corner at `corner`, moved right where it would cross
// the room's left edge (a narrow picture).
function creditNodes(shot, ctx, credit, [corner, top]) {
  if (!credit?.drawn) return [];
  const pad = CREDIT_PAD * ctx.unit;
  const w = credit.layout.width + HALF * pad, h = credit.layout.height + HALF * pad;
  const right = Math.max(corner, roomOf(ctx).left + w);
  const fill = colourOf(ctx.look, ctx.look.devices.card?.fill ?? 'paper');
  return [
    node('path', `${shot.id}.credit.plate`, { d: `M${right - w} ${top}H${right}V${top + h}H${right - w}Z`, fill }),
    node('text', `${shot.id}.credit`, { x: right - w + pad, y: top + pad, layout: credit.layout, font: credit.font, fill: onCard(ctx.look) }),
  ];
}

// ---- the picture ----

// The group that pushes in: from look.kinds.media.push at 0 to 1 at the shot's end, with the look's settle ease where it
// does not overshoot.
function pushTrack(ctx, data) {
  const settle = ctx.look.moves.settle?.ease ?? PUSH_EASE;
  const ease = easePeak(settle) > 1 ? PUSH_EASE : settle;
  return track([{ t: 0, v: data.push }, { t: ctx.timing.duration, v: 1, ease }]);
}

// A still in the look's treatment; a clip as filmed, its decoded frame count in props.video (media-clip.mjs).
const imageProps = (shot, ctx, w, h, clip) => {
  const video = ctx.asset(shot.src).clip;
  if (video) return { src: shot.src, w, h, clip, video: { count: video.count } };
  const treatment = treatmentFor(ctx.look, shot.treatment ?? ctx.data.treatment, ctx.unit);
  return { src: shot.src, w, h, clip, ...(treatment ? { treatment } : {}) };
};

// A clip's picture plays its frames: a `frame` track from the shot's in, one decoded frame per film frame.
const frameTracks = (shot, ctx) => {
  const video = ctx.asset(shot.src).clip;
  return video ? { frame: clipFrameTrack(video, shot, ctx.timing.duration) } : {};
};

// The picture group about its box's centre: the image itself (bleed) or the look's cutout (keyline and shadow).
function pictureGroup(shot, ctx, [x, y, w, h], clip, asCutout) {
  const hero = `${shot.id}.picture`;
  const image = node('image', `${hero}.image`, { ...imageProps(shot, ctx, w, h, clip), x: -w / HALF, y: -h / HALF }, { tracks: frameTracks(shot, ctx) });
  const children = asCutout
    ? registries.devices.get('cutout').build({ id: `${hero}.cutout`, box: [-w / HALF, -h / HALF, w, h], at: 0, look: ctx.look, unit: ctx.unit, seed: ctx.seed, image, alpha: ctx.asset(shot.src).alpha === true }).nodes
    : [image];
  return node('group', hero, { x: x + w / HALF, y: y + h / HALF }, { tracks: { scale: pushTrack(ctx, ctx.data) }, children });
}

// The room a shot composes in, in px: the platform safe band (pop on 9:16), else the margins, over a captions band.
function roomOf(ctx) {
  const { look, canvas, unit } = ctx;
  const rect = compositionRect(ctx);
  const margin = look.grid.margin * unit;
  if (rect.safe) return { left: rect.left, top: rect.top, right: rect.left + rect.w, bottom: rect.top + rect.h };
  const bottom = Math.min(canvas.h - margin, captionTop(ctx) - look.grid.gutter * unit);
  return { left: margin, top: margin, right: canvas.w - margin, bottom };
}

// ---- the two fits ----

// The picture box [x, y, w, h] that keeps the marked subject (the band SUBJECT_REACH of the picture's height either side
// of `focus`) above `limit`: the cover box drawn larger about the frame's centre line and flush at its bottom, so it still
// covers the frame, by as much as that takes (at most MAX_LIFT times); the box unchanged when the subject already clears.
function liftedBox([bx, by, bw, bh], picture, clip, fy, limit) {
  const subject = Math.min(1, ((fy + SUBJECT_REACH) * picture.height - clip[1]) / clip[3]); // its bottom, a share of the box
  const bottom = by + bh;
  if (subject >= 1 || by + subject * bh <= limit) return [bx, by, bw, bh];
  const k = Math.min(MAX_LIFT, Math.max(1, (bottom - limit) / ((1 - subject) * bh)));
  const w = bw * k, h = bh * k;
  return [bx - (w - bw) / HALF, bottom - h, w, h];
}

/** Full bleed: the picture covers the frame (and the camera's drift), the caption on the card low on the left columns,
 *  the credit at the room's top right; a caption card never covers the marked subject (liftedBox). */
export function bleedLayout(shot, ctx) {
  const { look, canvas, unit, data } = ctx;
  const reach = driftReach(look, unit);
  const cover = [-reach, -reach, canvas.w + HALF * reach, canvas.h + HALF * reach];
  const focus = shot.focus ?? [0.5, 0.5];
  const picture = ctx.asset(shot.src);
  const clip = coverCrop(picture, { w: cover[2], h: cover[3] }, focus);
  const room = roomOf(ctx);
  const span = gridSpan(look, canvas, 1, isWide(canvas) ? data.toWide : data.toTall);
  const left = Math.max(span.x, room.left, editorialLeft(look, canvas, unit)), width = Math.min(span.x + span.w, room.right) - left;
  const pad = data.cardPad * unit;
  const caption = fitCaption(shot, ctx, data.captionSteps, width - HALF * pad, data.captionLines);
  const credit = fitCredit(shot, ctx, caption);
  const cardBox = caption ? cardBoxOf(caption, { left, width, pad, bottom: room.bottom }) : null;
  const box = cardBox ? liftedBox(cover, picture, clip, focus[1], cardBox[1] - look.grid.gutter * unit) : cover;
  const nodes = [pictureGroup(shot, ctx, box, clip, false)];
  const boxes = { picture: [0, 0, canvas.w, canvas.h] };
  if (caption) {
    const [, , cw, ch] = cardBox;
    const card = cardOf(ctx, `${shot.id}.card`, cardBox, 0);
    nodes.push(cardGroup(card, `${shot.id}.card`, [captionNode(shot, ctx, caption, [-cw / HALF + pad, -ch / HALF + pad], credit, onCard(look))]));
    boxes.caption = cardBox;
  }
  nodes.push(...creditNodes(shot, ctx, credit, [room.right, room.top]));
  return { nodes, boxes, hero: `${shot.id}.picture` };
}

// The caption card's box: the caption plus `pad` round it, no wider than `width`, its bottom on `bottom`.
function cardBoxOf(caption, { left, width, pad, bottom }) {
  const cw = Math.min(width, caption.layout.width + HALF * pad), ch = caption.layout.height + HALF * pad;
  return [left, bottom - ch, cw, ch];
}

// A picture of aspect `aspect` contained in a w x h room: its [w, h].
const contain = (aspect, w, h) => (w / h > aspect ? [h * aspect, h] : [w, w / aspect]);

/** Wide cut-out: the picture off-centre on the left columns, the caption as the hero on the right ones (no caption: the
 *  picture centred, larger). */
function cutoutWide(shot, ctx, picture) {
  const { look, canvas, data } = ctx;
  const room = roomOf(ctx);
  const text = gridSpan(look, canvas, data.besideFrom, look.grid.columns);
  const caption = fitCaption(shot, ctx, data.heroSteps, text.w, data.maxLines);
  const first = isEditorial(look) ? EDITORIAL_WIDE_COLUMN : 1; // one left margin with the statement and the chart
  const area = caption ? gridSpan(look, canvas, first, data.besideFrom - 2) : gridSpan(look, canvas, 2, look.grid.columns - 1);
  const [w, h] = contain(picture.width / picture.height, area.w, room.bottom - room.top);
  const box = [caption ? area.x : area.x + (area.w - w) / HALF, room.top + (room.bottom - room.top - h) / HALF, w, h];
  const placed = caption ? [text.x, box[1] + h / HALF - caption.layout.height / HALF] : null;
  return { box, clip: undefined, caption, placed };
}

/** Tall cut-out: the caption under the picture across the room, the picture cropped (around its focus) to fill the rest. */
function cutoutTall(shot, ctx, picture) {
  const { data, unit } = ctx;
  const room = roomOf(ctx);
  const width = room.right - room.left;
  const caption = fitCaption(shot, ctx, data.heroSteps, width, data.maxLines);
  const below = caption ? caption.layout.height + data.gap * unit : 0;
  const height = room.bottom - room.top - below;
  const w = Math.min(width, height * Math.max(MIN_TALL_ASPECT, Math.min(picture.width / picture.height, width / height)));
  const clip = coverCrop(picture, { w, h: height }, shot.focus ?? [0.5, 0.5]);
  const box = [room.left, room.top, w, height];
  return { box, clip, caption, placed: caption ? [room.left, room.top + height + data.gap * unit] : null };
}

/** A cut-out: the picture as an object with the caption beside it (wide) or under it (tall), the credit on its edge. */
export function cutoutLayout(shot, ctx) {
  const picture = ctx.asset(shot.src);
  const laid = isWide(ctx.canvas) ? cutoutWide(shot, ctx, picture) : cutoutTall(shot, ctx, picture);
  const credit = fitCredit(shot, ctx, laid.caption);
  const [x, y, w] = laid.box;
  const nodes = [pictureGroup(shot, ctx, laid.box, laid.clip, true)];
  const boxes = { picture: laid.box };
  if (laid.caption) {
    // on the field, not on a card: the caption in ink (pop: white on its black field)
    nodes.push(captionNode(shot, ctx, laid.caption, laid.placed, credit, ctx.look.palette.ink));
    boxes.caption = [...laid.placed, laid.caption.layout.width, laid.caption.layout.height];
  }
  nodes.push(...creditNodes(shot, ctx, credit, [x + w, y]));
  return { nodes, boxes, hero: `${shot.id}.picture` };
}

// The shot's fit: its own, else on a tall frame the look's `fitTall` (look.kinds.media; poster's cut-out, which fills the
// band with the picture over its caption), else bleed.
export const isBleed = (shot, ctx) => (shot.fit ?? (ctx !== undefined && !isWide(ctx.canvas) ? ctx.data?.fitTall : undefined) ?? 'bleed') === 'bleed';

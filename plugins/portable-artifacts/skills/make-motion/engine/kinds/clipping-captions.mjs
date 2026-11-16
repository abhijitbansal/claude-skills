// What a clipping sets around its picture, pinned to the frame (props.fixed: a camera push leaves it in place) and drawn
// over the picture so that it is never covered: the kicker (the slug in an editorial look, slug.mjs; a tag in a stack
// look, as a statement sets it) and the caption (label caps on a small paper card, upright, for the whole shot, in an
// editorial look: bottom left on column 2 while the whole picture is seen, then, moving with a camera push, directly under
// the pushed region's marker frame; one line in the display face, flush left on the stack edge, directly under the
// picture or the close-up, in a stack look). Pure and DOM-free.
import { registries } from '../registry.mjs';
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';
import { layoutText } from '../text/layout.mjs';
import { gridX, gridSpan } from '../looks/index.mjs';
import { slugNodes, SLUG } from './slug.mjs';
import { CAP_HEIGHT, sizeAt, fontFor, setCase, inkBox, isEditorial, requireDevice, pinned, shownFrom, runInk, asTextCard } from './shared.mjs';

// editorial caption: label caps at step 2 in ink2 (as the slug's kicker), wrapped to 4 columns, on a card whose left edge
// sits on column 2 and whose bottom sits on the bottom margin
const CARD_CAPTION = Object.freeze({ step: 2, columns: 4, column: 2 });
// stack caption: one line in the display face at step 3, its cap line `gap` units under the picture's keyline and shadow
// descent: em kept under the line for a tail (a Q in heavy caps reaches past WORD_DESCENT)
const LINE_CAPTION = Object.freeze({ step: 3, fromStep: 2, gap: 24, descent: 0.25 });
const KICKER_GAP = 28; // units between a stack kicker tag and the picture under it (as over a stack's first line)
const NO_WRAP = 1e6;
const HALF = 2;

// How far a cut-out's keyline and hard shadow reach past its picture.
// how far past the picture its keyline and shadow reach: the emphasised shadow's offset where a highlight grows it
const reachOf = (look, unit) => (look.keyline + Math.max(look.shadow.dx, look.shadow.dy, look.devices.cutout?.emphasis?.offset ?? 0)) * unit;

// A stack kicker's tag params (the tag device sizes itself from its text) and its plate height.
function kickerTag(shot, ctx) {
  requireDevice(ctx.look, 'tag', 'clipping');
  const tag = registries.devices.get('tag');
  const params = { id: `${shot.id}.kicker`, text: shot.kicker, at: ctx.look.moves.enter.dur, look: ctx.look, unit: ctx.unit, seed: ctx.seed, measure: ctx.measure };
  return { tag, params, h: tag.build({ ...params, box: [0, 0, 1, 1] }).boxes.tag[3] };
}

/** The room a stack look keeps around its picture for what is pinned there: `above` for the kicker tag and its gap,
 *  `below` for the caption (keyline and shadow, the gap and one line of type). Both 0 in an editorial look. */
export function pinnedRoom(shot, ctx) {
  const { look, unit } = ctx;
  if (isEditorial(look)) return { above: 0, below: 0 };
  const above = shot.kicker === undefined ? 0 : kickerTag(shot, ctx).h + KICKER_GAP * unit;
  const below = shot.caption === undefined ? 0 : reachOf(look, unit) + LINE_CAPTION.gap * unit + (CAP_HEIGHT + LINE_CAPTION.descent) * sizeAt(look, LINE_CAPTION.step, unit);
  return { above, below };
}

/** The kicker's nodes: the slug (editorial), or a tag KICKER_GAP units over `pictureTop`, flush left at `left` (stack). */
export function kickerNodes(shot, ctx, { left, pictureTop }) {
  if (shot.kicker === undefined) return [];
  if (isEditorial(ctx.look)) return slugNodes(shot, ctx);
  const { tag, params, h } = kickerTag(shot, ctx);
  return tag.build({ ...params, box: [left, pictureTop - KICKER_GAP * ctx.unit - h, 1, 1] }).nodes.map(pinned);
}

/**
 * Where an editorial caption card goes once the camera has pushed in on a region, as [x, y, w, h] on screen: its left
 * edge on the region's left edge and its top `gutter` under the frame's lowest ink; above the frame when that would run
 * past the bottom of `area`; inside `area` always (moved left off its right edge, and into it when neither fits).
 * @param {{ region: number[], frame: number[], size: { w: number, h: number }, gutter: number, area: { left: number, top: number, right: number, bottom: number } }} p
 *   region and frame are [x, y, w, h] on screen
 */
export function captionAfterPush({ region, frame, size, gutter, area }) {
  const x = Math.max(area.left, Math.min(region[0], area.right - size.w));
  const under = frame[1] + frame[3] + gutter, above = frame[1] - gutter - size.h;
  if (under + size.h <= area.bottom) return [x, under, size.w, size.h];
  if (above >= area.top) return [x, above, size.w, size.h];
  return [x, Math.max(area.top, Math.min(under, area.bottom - size.h)), size.w, size.h];
}

// A canvas box at rest as the camera `cam` shows a depth-0 node there (zoom about the centre, then the pan).
function onScreen(canvas, cam, [x, y, w, h]) {
  const cx = canvas.w / HALF, cy = canvas.h / HALF;
  return [cx + (x - cx) * cam.zoom - cam.x, cy + (y - cy) * cam.zoom - cam.y, w * cam.zoom, h * cam.zoom];
}

// The caption card's tracks with a push added: its x and y move from where it rests to captionAfterPush's place over
// the push (the push's keys and ease, starting no earlier than the card's own entrance has ended), and x then follows the
// camera drift to the end of the shot, so the card stays under the region; pinned to the frame, it is never zoomed.
function followTracks(card, box, ctx, { region, frame, push, camera }) {
  const { look, canvas, unit, timing } = ctx;
  const landed = push.at(-1), camAt = camera(landed.t), camEnd = camera(timing.duration);
  const margin = look.grid.margin * unit;
  const area = { left: margin, top: margin, right: canvas.w - margin, bottom: canvas.h - margin };
  const to = captionAfterPush({ region: onScreen(canvas, camAt, region), frame: onScreen(canvas, camAt, frame), size: { w: box[2], h: box[3] }, gutter: look.grid.gutter * unit, area });
  const [x0, y0] = [card.props.x, card.props.y], [x1, y1] = [x0 + to[0] - box[0], y0 + to[1] - box[1]];
  const rise = card.tracks.y ? card.tracks.y.points.map((p, i) => ({ t: p.t, v: p.v, ...(i > 0 ? { ease: look.moves.enter.ease } : {}) })) : [{ t: 0, v: y0 }];
  const start = Math.min(landed.t, Math.max(push[0].t, rise.at(-1).t));
  return {
    ...card.tracks,
    x: track([{ t: 0, v: x0 }, { t: start, v: x0 }, { t: landed.t, v: x1, ease: landed.ease }, { t: Math.max(landed.t, timing.duration), v: x1 - (camEnd.x - camAt.x) }]),
    y: track([...rise, { t: start, v: y0 }, { t: landed.t, v: y1, ease: landed.ease }]),
  };
}

// editorial: the caption on a card device, upright, in with the look's enter move as the slug is, for the whole shot:
// bottom left on column 2 until a push, then under the pushed region (followTracks).
function cardCaption(shot, ctx, follow) {
  const { look, canvas, unit, seed, measure } = ctx;
  const font = fontFor(look, 'label', sizeAt(look, CARD_CAPTION.step, unit), unit);
  const layout = layoutText({ text: setCase(look, 'label', shot.caption), font, maxWidth: gridSpan(look, canvas, 1, CARD_CAPTION.columns).w, measure });
  const ink = runInk(layout.lines[0], font, measure);
  const pad = SLUG.pad * unit;
  const w = layout.width + HALF * pad, h = HALF * pad + ink.up + layout.lines.at(-1).y - layout.lines[0].y;
  const box = [gridX(look, canvas, CARD_CAPTION.column), canvas.h - look.grid.margin * unit - h, w, h];
  const id = `${shot.id}.caption.card`;
  const card = registries.devices.get('card').build({ id, box, at: look.moves.enter.dur, look, unit, seed }).nodes[0];
  const x = -w / HALF + pad - ink.left, y = -h / HALF + pad + ink.up - layout.lines[0].y;
  // frame furniture: the review's sizes and hero rules leave the texts of a card out
  const text = node('text', `${shot.id}.caption`, { x, y, layout, font, fill: look.palette.ink2, role: 'caption', furniture: true });
  // the card's own hand tilt is replaced: a caption card sits square on the grid
  const tracks = follow ? followTracks(card, box, ctx, follow) : card.tracks;
  const group = node('group', id, { ...card.props, rotate: 0, fixed: true }, { tracks, children: [...asTextCard(id, card.children), text] });
  return { nodes: [group], box: inkBox(card.props.x + x, card.props.y + y, layout) };
}

// stack: one line in the display face, its ink flush left at `left`, its cap line LINE_CAPTION.gap under the keyline and
// shadow of `anchor` (the picture or close-up box it captions), shown from `at` to the end of the shot. A line wider than
// `maxWidth` at step 3 stays one line, set smaller in proportion (not below LINE_CAPTION.fromStep) so that it keeps inside
// the safe width, and says it overflows, as a statement that cannot fit does: the review asks for fewer words.
function lineCaption(shot, ctx, { left, maxWidth, anchor, at }) {
  const { look, unit, measure } = ctx;
  const text = setCase(look, 'display', shot.caption);
  const lineAt = (size) => {
    const font = fontFor(look, 'display', size, unit);
    const set = layoutText({ text, font, maxWidth: NO_WRAP, measure });
    return { font, set, ink: runInk(set.lines[0], font, measure) };
  };
  const wide = (line) => line.ink.right - line.ink.left > maxWidth;
  let line = lineAt(sizeAt(look, LINE_CAPTION.step, unit));
  const tooWide = wide(line);
  if (tooWide) line = lineAt(Math.max(sizeAt(look, LINE_CAPTION.fromStep, unit), (line.font.size * maxWidth) / (line.ink.right - line.ink.left)));
  const { font, ink } = line;
  const layout = tooWide ? { ...line.set, overflow: true } : line.set;
  const capLine = anchor[1] + anchor[3] + reachOf(look, unit) + LINE_CAPTION.gap * unit;
  const x = left - ink.left, y = capLine + CAP_HEIGHT * font.size - layout.lines[0].y;
  const caption = node('text', `${shot.id}.caption`, { x, y, layout, font, fill: look.palette.ink, role: 'caption', fixed: true }, { tracks: { opacity: shownFrom(at) } });
  const advance = inkBox(x, y, layout);
  return { nodes: [caption], box: [left, advance[1], advance[0] + advance[2] - left, advance[3]] };
}

/**
 * The caption as { nodes, box } (the box where it rests), or null without one.
 * @param {{ left: number, maxWidth: number, anchor: number[], at: number, follow: object | null }} place for a stack
 *   look: the stack edge, the width it may take, the box it captions and when it arrives; for an editorial look (which
 *   places its card on the grid) `follow`, the push it moves with ({ region, frame, push, camera }), or null
 */
export function captionNodes(shot, ctx, place) {
  if (shot.caption === undefined) return null;
  return isEditorial(ctx.look) ? cardCaption(shot, ctx, place.follow) : lineCaption(shot, ctx, place);
}

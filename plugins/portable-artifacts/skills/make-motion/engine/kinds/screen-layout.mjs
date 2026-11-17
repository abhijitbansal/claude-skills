// How the `screen` kind lays out (screen.mjs registers it): the framed screenshot placed in its room, its regions mapped
// onto the drawn picture, and the zoom: a camera push with the rest dimmed (desk, a moving camera), a cut to a close-up
// of the region (pop, a locked camera; kinds/close-ups.mjs), or, for a wide screen on a tall frame, a second panel under
// the screen that enlarges the region and arrives with the zoom, joined to it by a route line. Pure and DOM-free.
import { registries } from '../registry.mjs';
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';
import { landing } from '../devices/shared.mjs';
import { moveOf } from '../moves/index.mjs';
import { REGION_PREFIX, isWide, compositionRect, captionTop, cutsToCloseUp, regionOf, paperScrim } from './shared.mjs';
import { pushLayer, pushZoom } from './camera.mjs';
import { closeUps } from './close-ups.mjs';
import { arrivalTrack } from './arrivals.mjs';
import { defaultFrame, outerOf, frameNodes, chromeOf } from './screen-frame.mjs';

const HALF = 2;
const MIN_PANEL = 0.25; // a second panel is at least this share of the room's height
const NATIVE = 1; // frame pixels per picture pixel, at most, in a zoom (more is a soft upscale)
const PUSH_COVER = 4; // the push mask covers the frame grown this much about its centre (PUSH.max is 3.2)

/** The frame a shot shows: its `frame`, else by its picture's shape. */
export const frameFor = (shot, picture) => shot.frame ?? defaultFrame(picture);

/** Is this a wide screen on a tall frame (two panels)? */
export const isTwoPanel = (shot, picture, canvas) => !isWide(canvas) && frameFor(shot, picture) !== 'phone';

// The room a screen composes in, in px: the platform safe band (pop on 9:16), else the margins over a captions band.
function roomOf(ctx) {
  const { look, canvas, unit } = ctx;
  const rect = compositionRect(ctx);
  if (rect.safe) return { x: rect.left, y: rect.top, w: rect.w, h: rect.h };
  const margin = look.grid.margin * unit;
  const bottom = Math.min(canvas.h - margin, captionTop(ctx) - look.grid.gutter * unit);
  return { x: margin, y: margin, w: canvas.w - HALF * margin, h: bottom - margin };
}

// The image box whose frame is as large as fits a w x h space at (x, y), centred in it.
function fitFramed(frame, unit, picture, { x, y, w, h }) {
  const c = chromeOf(frame, unit);
  const scale = Math.min((w - HALF * c.side) / picture.width, (h - c.top - c.bottom) / picture.height);
  const iw = picture.width * scale, ih = picture.height * scale;
  const outerW = iw + HALF * c.side, outerH = ih + c.top + c.bottom;
  return [x + (w - outerW) / HALF + c.side, y + (h - outerH) / HALF + c.top, iw, ih];
}

/** A region (fractions of the picture) on the drawn image box. */
export const regionBox = ([x, y, w, h], [fx, fy, fw, fh]) => [x + fx * w, y + fy * h, fw * w, fh * h];

// The chrome texts (title, url) fading out over CHROME_FADE seconds from `from`: as a push begins they leave the frame,
// and a text half out of it would be cut at the edge.
const CHROME_FADE = 0.25;
const isChromeText = (shot, n) => n.id === `${shot.id}.title` || n.id === `${shot.id}.url`;
function fadingChrome(shot, children, from) {
  if (from === undefined) return children;
  const opacity = track([{ t: 0, v: 1 }, { t: from, v: 1 }, { t: from + CHROME_FADE, v: 0 }]);
  return children.map((n) => (isChromeText(shot, n) ? node(n.type, n.id, n.props, { tracks: { ...n.tracks, opacity }, children: n.children }) : n));
}

// The screen group: the frame and its screenshot, whole from frame 0 (hidden from `hideAt` on, when a close-up replaces
// it); its chrome texts fade from `fadeAt` on (a push).
function screenGroup(shot, ctx, frame, image, hideAt, fadeAt) {
  const content = node('image', `${shot.id}.screen.image`, { src: shot.src, w: image[2], h: image[3], x: image[0], y: image[1] });
  const children = fadingChrome(shot, frameNodes(shot, ctx, { frame, image, data: ctx.data, content }), fadeAt);
  const tracks = hideAt === undefined ? {} : { opacity: track([{ t: 0, v: 1 }, { t: hideAt, v: 1 }, { t: hideAt, v: 0 }]) };
  return node('group', `${shot.id}.screen`, {}, { tracks, children });
}

// The second panel: the region enlarged as a framed crop (the look's cut-out: keyline and shadow) that arrives with the
// zoom, by the look's `pop` move; the route from the region to it draws on as it comes.
// The crop window [sx, sy, sw, sh] of the picture around `region` at the panel's aspect, inside the picture.
function panelCrop(picture, region, aspect) {
  const [fx, fy, fw, fh] = region;
  let w = fw * picture.width, h = fh * picture.height;
  if (w / h > aspect) h = w / aspect; else w = h * aspect;
  const scale = Math.min(1, picture.width / w, picture.height / h);
  w *= scale; h *= scale;
  const cx = (fx + fw / HALF) * picture.width, cy = (fy + fh / HALF) * picture.height;
  return [Math.min(Math.max(cx - w / HALF, 0), picture.width - w), Math.min(Math.max(cy - h / HALF, 0), picture.height - h), w, h];
}

// The panel's crop and its scale onto the area: as large as fits, never past the picture's own pixels (one picture
// pixel to one frame pixel at most; larger is a soft upscale). `wanted` is the scale it would take with no cap.
function panelFit(picture, region, area) {
  const crop = panelCrop(picture, region, area.w / area.h);
  const wanted = Math.min(area.w / crop[2], area.h / crop[3]);
  return { crop, wanted, fit: Math.min(NATIVE, wanted) };
}

function panelNodes(shot, ctx, { picture, region, area, zoomAt, regionAt }) {
  const { look, unit, seed } = ctx;
  const { crop, fit } = panelFit(picture, region, area);
  const [w, h] = [crop[2] * fit, crop[3] * fit];
  const box = [area.x + (area.w - w) / HALF, area.y, w, h];
  const image = node('image', `${shot.id}.panel.image`, { src: shot.src, w, h, clip: crop });
  const cutout = registries.devices.get('cutout').build({ id: `${shot.id}.panel.cutout`, box: [-w / HALF, -h / HALF, w, h], at: 0, look, unit, seed, image }).nodes;
  const move = moveOf(look, 'pop');
  const tracks = { opacity: arrivalTrack(zoomAt), ...(move.scale === undefined ? {} : { scale: landing(zoomAt + move.dur, move, move.scale, 1) }) };
  const panel = node('group', `${shot.id}.panel`, { x: box[0] + w / HALF, y: box[1] + h / HALF }, { tracks, children: cutout });
  const from = [regionAt[0] + regionAt[2] / HALF, regionAt[1] + regionAt[3]];
  const to = [box[0] + w / HALF, box[1]];
  const route = registries.devices.get('route').build({ id: `${shot.id}.link`, at: zoomAt, look, unit, seed, points: [from, [(from[0] + to[0]) / HALF, (from[1] + to[1]) / HALF], to], pins: false }).nodes;
  return { nodes: [...route, panel], box };
}

/** A wide screen on a tall frame: the whole screen across the top of the room, the region panel under it. */
export function twoPanelLayout(shot, ctx, { picture, zoom }) {
  const { unit, data } = ctx;
  const room = roomOf(ctx);
  const frame = frameFor(shot, picture);
  const topH = Math.min(room.h * (1 - MIN_PANEL), (outerOf(frame, unit, [0, 0, room.w, (room.w * picture.height) / picture.width])[3]));
  const image = fitFramed(frame, unit, picture, { x: room.x, y: room.y, w: room.w, h: topH });
  const outer = outerOf(frame, unit, image);
  const regions = regionBoxes(shot, image);
  // until the panel comes the screen waits centred in the room, then settles to the top as the panel arrives
  const drop = (room.y + (room.h - outer[3]) / HALF) - outer[1];
  const settle = moveOf(ctx.look, 'settle');
  const group = screenGroup(shot, ctx, frame, image);
  const moving = zoom && drop > 0
    ? node('group', group.id, group.props, { tracks: { ...group.tracks, y: landing(zoom.at, settle, drop, 0) }, children: group.children })
    : group;
  const nodes = [moving];
  const boxes = { screen: outer, image, ...regions };
  if (zoom) {
    const top = outer[1] + outer[3] + data.gap * unit;
    const area = { x: room.x, y: top, w: room.w, h: room.y + room.h - top };
    const panel = panelNodes(shot, ctx, { picture, region: shot.regions[zoom.region], area, zoomAt: zoom.at, regionAt: regions[`${REGION_PREFIX}${zoom.region}`] });
    nodes.push(...panel.nodes);
    boxes.panel = panel.box;
  }
  return { nodes, boxes, camera: [] };
}

// The zoom at which the drawn picture shows one picture pixel per frame pixel: a push past it is a soft upscale.
const nativeZoom = (picture, image) => (NATIVE * picture.width) / image[2];

// A push's mask (look.kinds.screen.pushDim, desk: the paper whole): the paper over everything but the region, rising
// with the push, so at rest the frame holds the region alone and no part-cut panel or text sits at the frame's edge.
// The cover is the frame grown about its centre by the push's largest zoom, so it still covers the frame zoomed.
function pushMask(shot, ctx, box, at) {
  const { canvas, look, data } = ctx;
  const grow = (PUSH_COVER - 1) / HALF;
  const [x, y, w, h] = [-canvas.w * grow, -canvas.h * grow, canvas.w * PUSH_COVER, canvas.h * PUSH_COVER];
  const outline = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]; // clockwise; the hole goes the other way
  return paperScrim({ id: `${shot.id}.focus`, cover: [outline], hole: box, at, dur: look.moves.draw.dur, opacity: data.pushDim, look });
}

/**
 * How far the shot's zoom would go and how far the picture's pixels carry it, for the review: { wanted, cap } (zoom
 * factors for a push, panel scales for a second panel), or null for a shot with no zoom or a close-up cut. The room is
 * taken with captions off (the review does not know them), so a captioned film's figures are a close estimate.
 */
export function zoomReach(shot, ctx, picture, region) {
  const { look, canvas, unit, data } = ctx;
  const room = roomOf(ctx);
  const frame = frameFor(shot, picture);
  if (isTwoPanel(shot, picture, canvas)) {
    const topH = Math.min(room.h * (1 - MIN_PANEL), (outerOf(frame, unit, [0, 0, room.w, (room.w * picture.height) / picture.width])[3]));
    const outer = outerOf(frame, unit, fitFramed(frame, unit, picture, { x: room.x, y: room.y, w: room.w, h: topH }));
    const top = outer[1] + outer[3] + data.gap * unit;
    const { wanted } = panelFit(picture, region, { x: room.x, y: top, w: room.w, h: room.y + room.h - top });
    return { wanted, cap: NATIVE };
  }
  if (cutsToCloseUp(look)) return null;
  const space = isWide(canvas) ? { ...room, x: room.x + (room.w * (1 - data.wideShare)) / HALF, w: room.w * data.wideShare } : room;
  const image = fitFramed(frame, unit, picture, space);
  return { wanted: pushZoom(ctx, regionBox(image, region)), cap: nativeZoom(picture, image) };
}

const regionBoxes = (shot, image) => Object.fromEntries(Object.entries(shot.regions ?? {}).map(([name, r]) => [`${REGION_PREFIX}${name}`, regionBox(image, r)]));

/** The framed screen in the room (a wide frame, or a phone on a tall one), and its zoom: a push with the rest dimmed, or
 *  a cut to a close-up. */
export function singleLayout(shot, ctx, { picture, zoom }) {
  const { look, unit, seed, canvas, data } = ctx;
  const room = roomOf(ctx);
  const frame = frameFor(shot, picture);
  const space = isWide(canvas) ? { ...room, x: room.x + (room.w * (1 - data.wideShare)) / HALF, w: room.w * data.wideShare } : room;
  const image = fitFramed(frame, unit, picture, space);
  const regions = regionBoxes(shot, image);
  const boxes = { screen: outerOf(frame, unit, image), image, ...regions };
  if (!zoom) return { nodes: [screenGroup(shot, ctx, frame, image)], boxes, camera: [] };
  const target = regions[`${REGION_PREFIX}${zoom.region}`];
  // a moving camera pushes in with the rest dimmed; a locked one on a tall frame (a phone that fills it: a cut to a
  // close-up of a strip would empty the frame) dims the rest and sweeps light across the region; on a wide frame it cuts
  if (!cutsToCloseUp(look) || !isWide(canvas)) {
    const build = (name, id) => registries.devices.get(name).build({ id, box: target, at: zoom.at, look, unit, seed, cover: [0, 0, canvas.w, canvas.h] }).nodes;
    if (!cutsToCloseUp(look)) {
      const push = pushLayer(ctx, target, zoom.at, { max: nativeZoom(picture, image) });
      const rest = data.pushDim === undefined ? build('focus', `${shot.id}.focus`) : [pushMask(shot, ctx, target, zoom.at)];
      return { nodes: [screenGroup(shot, ctx, frame, image, undefined, push[0].t), ...rest], boxes, camera: [push] };
    }
    const focus = build('focus', `${shot.id}.focus`);
    const sweep = registries.devices.get('sweep').supports(look) ? registries.devices.get('sweep').build({ id: `${shot.id}.sweep`, box: target, at: zoom.at, look, unit, seed }).nodes : [];
    return { nodes: [screenGroup(shot, ctx, frame, image), ...focus, ...sweep], boxes, camera: [] };
  }
  const events = (shot.on ?? []).map((item, j) => ({ item, j, at: ctx.at(item.at), region: regionOf(item.target) })).filter((e) => e.region === zoom.region && e.at >= zoom.at);
  const plan = { cuts: [{ region: zoom.region, at: zoom.at, until: undefined }], events };
  const close = closeUps(shot, ctx, { picture, area: { w: room.w, h: room.h }, centre: [room.x + room.w / HALF, room.y + room.h / HALF], plan });
  return { nodes: [screenGroup(shot, ctx, frame, image, zoom.at), ...close.nodes], boxes: { ...boxes, ...close.boxes }, camera: close.camera };
}

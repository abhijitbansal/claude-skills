// How the `screen` kind lays out (screen.mjs registers it): the framed screenshot placed in its room, its regions mapped
// onto the drawn picture, and the zoom: a camera push with the rest dimmed (desk, a moving camera), a cut to a close-up
// of the region (pop, a locked camera; kinds/close-ups.mjs), or, for a wide screen on a tall frame, a second panel under
// the screen that enlarges the region and arrives with the zoom, joined to it by a route line. Pure and DOM-free.
import { registries } from '../registry.mjs';
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';
import { landing, roundedRect } from '../devices/shared.mjs';
import { moveOf } from '../moves/index.mjs';
import { REGION_PREFIX, isWide, compositionRect, captionTop, cutsToCloseUp, regionOf, paperScrim, fitDisplay, fontFor, setCase, sizeAt, CAP_HEIGHT, WORD_DESCENT } from './shared.mjs';
import { colourOf } from '../devices/shared.mjs';
import { MIN_HERO_RATIO } from '../review/frame.mjs';
import { pushLayer, pushZoom, driftAt, PUSH_MIN } from './camera.mjs';
import { elevatedShadow } from '../devices/card.mjs';
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
// `lift` ({ from, to } s): the whole screen fades out over that span, as its region lifts off it as a card (regionCard)
// (its chrome texts gone before the lift starts: the growing card would otherwise cover a text still on)
function screenGroup(shot, ctx, frame, image, hideAt, fadeAt, lift) {
  const content = node('image', `${shot.id}.screen.image`, { src: shot.src, w: image[2], h: image[3], x: image[0], y: image[1] });
  const chromeAt = lift === undefined ? fadeAt : Math.max(0, lift.from - CHROME_FADE);
  const children = fadingChrome(shot, frameNodes(shot, ctx, { frame, image, data: ctx.data, content }), chromeAt);
  const tracks = hideAt !== undefined ? { opacity: track([{ t: 0, v: 1 }, { t: hideAt, v: 1 }, { t: hideAt, v: 0 }]) }
    : lift !== undefined ? { opacity: track([{ t: 0, v: 1 }, { t: lift.from, v: 1 }, { t: lift.to, v: 0, ease: ctx.look.moves.exit.ease }]) } : {};
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
// `whole` (look.kinds.screen.wholeWidth): a crop at least this share of the picture's width takes all of it, so no word
// is cut at its sides (poster); absent, the crop as it is
// The crop window of `panelCrop` that is never narrower (nor shorter) than the region: it grows along the other side to
// the panel's aspect as far as the picture goes, and the panel then takes the crop's own shape (look.kinds.screen
// .cropRegion, keynote: a wide region on a tall panel was scaled narrower, slicing its words at both sides).
function regionCrop(picture, [fx, fy, fw, fh], aspect) {
  const rw = fw * picture.width, rh = fh * picture.height;
  const [w, h] = rw / rh > aspect ? [rw, Math.min(picture.height, rw / aspect)] : [Math.min(picture.width, rh * aspect), rh];
  const cx = (fx + fw / HALF) * picture.width, cy = (fy + fh / HALF) * picture.height;
  return [Math.min(Math.max(cx - w / HALF, 0), picture.width - w), Math.min(Math.max(cy - h / HALF, 0), picture.height - h), w, h];
}

function panelFit(picture, region, area, whole, wholeRegion = false) {
  const cropOf = wholeRegion ? regionCrop : panelCrop;
  const near = cropOf(picture, region, area.w / area.h);
  const crop = Number.isFinite(whole) && near[2] >= whole * picture.width ? cropOf(picture, [0, region[1], 1, region[3]], area.w / area.h) : near;
  const wanted = Math.min(area.w / crop[2], area.h / crop[3]);
  return { crop, wanted, fit: Math.min(NATIVE, wanted) };
}

function panelNodes(shot, ctx, { picture, region, area, zoomAt, regionAt }) {
  const { look, unit, seed, data } = ctx;
  const { crop, fit } = panelFit(picture, region, area, data.wholeWidth, data.cropRegion === true);
  const [w, h] = [crop[2] * fit, crop[3] * fit];
  const box = [area.x + (area.w - w) / HALF, area.y, w, h];
  const image = node('image', `${shot.id}.panel.image`, { src: shot.src, w, h, clip: crop });
  const cutout = registries.devices.get('cutout').build({ id: `${shot.id}.panel.cutout`, box: [-w / HALF, -h / HALF, w, h], at: 0, look, unit, seed, image }).nodes;
  const move = moveOf(look, 'pop');
  const tracks = { opacity: arrivalTrack(zoomAt), ...(move.scale === undefined ? {} : { scale: landing(zoomAt + move.dur, move, move.scale, 1) }) };
  const panel = node('group', `${shot.id}.panel`, { x: box[0] + w / HALF, y: box[1] + h / HALF }, { tracks, children: cutout });
  const from = [regionAt[0] + regionAt[2] / HALF, regionAt[1] + regionAt[3]];
  const to = [box[0] + w / HALF, box[1]];
  // the route lands on the zoom, or (look.kinds.screen.linkAfter: poster) starts drawing on it, once the panel is there:
  // landing on it, it drew under the frame before the panel came (a stray tick)
  const linkAt = data.linkAfter === true ? zoomAt + look.moves.draw.dur : zoomAt;
  const route = registries.devices.get('route').build({ id: `${shot.id}.link`, at: linkAt, look, unit, seed, points: [from, [(from[0] + to[0]) / HALF, (from[1] + to[1]) / HALF], to], pins: false }).nodes;
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

// ---- a titled screen on a tall frame: the title as the headline over one card (look.kinds.screen.tallHero) ----

const CHROME_STEP_TALL = 2; // the chrome texts' scale step on a tall frame (screen-frame.mjs chromeText)

/** Is this a titled wide screen on a tall frame that the look sets as a headline over one card (keynote)? A region that
 *  fills most of a wide screen cannot be enlarged on a tall panel without slicing it at the sides, so the card stays
 *  whole, the frame filled by the headline, and the region gets the ring and the focus. */
export const isTallHero = (shot, picture, canvas, data) => data?.tallHero === true && shot.title !== undefined && isTwoPanel(shot, picture, canvas);

// The headline: the title in the display face as large as fits the room's width, at most data.heroMax and three lines,
// never under three times the chrome text (the review's hero rule).
function headlineSet(shot, ctx, room, share = ctx.data.heroShare) {
  const { look, unit, measure } = ctx;
  const max = ctx.data.heroMax * unit;
  const opts = { text: setCase(look, 'display', shot.title), font: fontFor(look, 'display', max, unit), maxWidth: room.w, align: 'left', measure };
  return fitDisplay(opts, { min: MIN_HERO_RATIO * sizeAt(look, CHROME_STEP_TALL, unit), max, maxHeight: room.h * share, maxLines: ctx.data.heroLines }, look, unit);
}

export function tallHeroLayout(shot, ctx, { picture, zoom }) {
  const { look, unit, seed, canvas, data } = ctx;
  const room = roomOf(ctx);
  const frame = frameFor(shot, picture);
  const set = headlineSet(shot, ctx, room);
  const headH = set.layout.lines.at(-1).y - set.layout.lines[0].y + (CAP_HEIGHT + WORD_DESCENT) * set.font.size;
  const gap = data.gap * unit;
  const below = { x: room.x, y: room.y + headH + gap, w: room.w, h: room.h - headH - gap };
  const fitted = fitFramed(frame, unit, picture, below);
  const outer = outerOf(frame, unit, fitted);
  // the headline and the card stand as one block centred down the room
  // a second tall screen in a row (look.kinds.screen.lift.alt) swaps them: the card first, the headline under it
  const flip = data.lift?.alt !== undefined && isRepeat(ctx);
  const drop = (room.h - (headH + gap + outer[3])) / HALF;
  const block = room.y + drop;
  const image = [fitted[0], block + (flip ? 0 : headH + gap) + (fitted[1] - outer[1]), fitted[2], fitted[3]];
  const top = flip ? block + outer[3] + gap : block;
  const headline = node('text', `${shot.id}.headline`, { x: room.x, y: top + CAP_HEIGHT * set.font.size - set.layout.lines[0].y, layout: set.layout, font: set.font, fill: colourOf(look, 'ink'), role: 'hero' });
  const { title: _shown, ...untitled } = shot; // the headline carries the title: the chrome row keeps its dots alone
  const regions = regionBoxes(shot, image);
  const boxes = { screen: outerOf(frame, unit, image), image, headline: [room.x, top, set.layout.width, headH], ...regions };
  const screen = screenGroup(untitled, ctx, frame, image);
  if (!zoom) return { nodes: [screen, headline], boxes, camera: [] };
  const target = regions[`${REGION_PREFIX}${zoom.region}`];
  const focus = registries.devices.get('focus').build({ id: `${shot.id}.focus`, box: target, at: zoom.at, look, unit, seed, cover: [0, 0, canvas.w, canvas.h] }).nodes;
  // data.pushPad (gate-keynote-1 ruling 1): the region lifts off the card as its own card, the full title-safe width,
  // so the dashboard's detail reads at phone size; without it the ring is drawn round the region on the card
  if (data.pushPad !== undefined) {
    const card = regionCard(shot, ctx, { picture, region: shot.regions[zoom.region], from: target, image, at: zoom.at });
    // data.lift (gate-keynote-2 ruling 4): the screen fades out under the lifting card instead of dimming under a veil
    // (the veil washed the screenshot's colours out, and the screen's sliced text showed beside the card)
    if (data.lift !== undefined) {
      const lifted = screenGroup(untitled, ctx, frame, image, undefined, undefined, liftSpan(ctx, zoom.at));
      return { nodes: [lifted, ...card.nodes, headline], boxes: { ...boxes, regionCard: card.box }, camera: [] };
    }
    return { nodes: [screen, ...focus, ...card.nodes, headline], boxes: { ...boxes, regionCard: card.box }, camera: [] };
  }
  const ring = registries.devices.get('circle').build({ id: `${shot.id}.ring`, box: target, at: zoom.at, look, unit, seed }).nodes;
  // the focus dims the rest of the screen; the headline is drawn over it, in ink
  return { nodes: [screen, ...focus, ...ring, headline], boxes, camera: [] };
}

// ---- the region card (look.kinds.screen.pushPad on a tall frame) ----

const SWEEP_AFTER = 0.5; // s after the landing the band of light is centred on
const SWEEP_GROW = 0.12; // of the region card's height: the band's box past the card on every side

/**
 * The region as its own elevated card: the picture cropped to the region whole, as wide as the frame inside pushPad (the
 * title-safe inset), centred where the screen's picture is. It grows out of the region's place on the screen card by the
 * look's settle move, landing on `at`, and then holds still while the camera drifts (its x carries the drift), the ring
 * exactly round it and the band of light crossing it once.
 */
function regionCard(shot, ctx, { picture, region, from, image, at }) {
  const { look, unit, seed, canvas, data, timing } = ctx;
  const [fx, fy, fw, fh] = region;
  // data.trim (n5): the crop starts inside the panel, `trim` of the picture's width in from the region's rect on every
  // side, so the strip of page above and beside the panel and its border do not show (the film's rect reaches past it)
  const trim = (data.trim ?? 0) * picture.width;
  const crop = [fx * picture.width + trim, fy * picture.height + trim, fw * picture.width - HALF * trim, fh * picture.height - HALF * trim];
  const alt = altLift(ctx);
  const wide = data.lift !== undefined && isWide(canvas) ? liftedSize(ctx, crop, alt) : null;
  const w = wide ? wide.w : canvas.w - HALF * data.pushPad * unit, h = wide ? wide.h : (w * crop[3]) / crop[2];
  const [cx, cy] = wide ? [liftCentreX(ctx, shot, w, alt), canvas.h / HALF] : [canvas.w / HALF, image[1] + image[3] / HALF];
  const local = [-w / HALF, -h / HALF, w, h];
  const settle = moveOf(look, 'settle');
  const start = Math.max(0, at - settle.dur);
  // with data.lift the card is on over the region's place while the screen fades round it (liftSpan)
  const on = data.lift !== undefined ? liftSpan(ctx, at).from : start;
  const drift = (t) => driftAt(look, timing, unit, t);
  const [x0, y0] = [from[0] + from[2] / HALF, from[1] + from[3] / HALF];
  const tracks = {
    opacity: track([{ t: 0, v: 0 }, { t: on, v: 0 }, { t: on, v: 1 }]),
    scale: landing(at, settle, from[2] / w, 1),
    x: track([{ t: 0, v: x0 }, { t: start, v: x0 }, { t: at, v: cx + drift(at), ease: settle.ease }, { t: Math.max(at, timing.duration), v: cx + drift(Math.max(at, timing.duration)) }]),
    y: landing(at, settle, y0, cy),
  };
  // a wide lift: the picture whole on a white elevated card padded to the card's width (liftedSize); tall: the picture is
  // the card
  const picturePart = wide
    ? [node('path', `${shot.id}.region.paper`, { d: roundedRect(...local, (look.devices.card?.radius ?? 0) * unit), fill: colourOf(look, data.fill ?? 'card') }),
      node('image', `${shot.id}.region.image`, { src: shot.src, w: wide.iw, h: wide.ih, x: -wide.iw / HALF, y: -wide.ih / HALF, clip: crop })]
    : [node('image', `${shot.id}.region.image`, { src: shot.src, w, h, x: local[0], y: local[1], clip: crop })];
  // the band of light under the card (gate-keynote-2 ruling 5: over the picture it greyed the dashboard's type and striped
  // its bars), crossing the ground round it: a box grown by SWEEP_GROW of the card's height on every side
  // data.tallSweep false (n5): none on a tall frame, where the band grown past the card showed as two pale rectangles
  // outside the ring (gate-keynote-3, the 9:16 dash at 5.67 s)
  const grow = SWEEP_GROW * h;
  const sweep = registries.devices.get('sweep').supports(look) && (isWide(canvas) || data.tallSweep !== false) ? registries.devices.get('sweep').build({ id: `${shot.id}.sweep`, box: [local[0] - grow, local[1] - grow, w + HALF * grow, h + HALF * grow], at: at + SWEEP_AFTER, look, unit, seed }).nodes : [];
  const children = [
    ...sweep,
    ...elevatedShadow(`${shot.id}.region`, local, wide ? (look.devices.card?.radius ?? 0) * unit : 0, look, unit, look.devices.card?.layers ?? []),
    ...picturePart,
    ...registries.devices.get('circle').build({ id: `${shot.id}.ring`, box: local, at, look, unit, seed }).nodes,
  ];
  return { nodes: [node('group', `${shot.id}.region`, { x: cx, y: cy }, { tracks, children })], box: [cx - w / HALF, cy - h / HALF, w, h] };
}

// The lifted card's size on a wide frame (look.kinds.screen.lift { share, pad }: gate-keynote-2 ruling 4): the region's
// picture whole and as large as fits inside the title-safe inset (pushPad) less the card's own pad, on a card at least
// `share` of the frame wide (the whole browser card is too tall to land that wide), padded on its sides to that width.
// `alt` (look.kinds.screen.lift.alt, a screen after a screen: altLift): the card exactly `alt.share` of the frame wide,
// the picture as large as fits inside it.
function liftedSize(ctx, crop, alt) {
  const { canvas, unit, data } = ctx;
  const safe = data.pushPad * unit, pad = data.lift.pad * unit;
  const aspect = crop[2] / crop[3];
  if (alt !== null) {
    const ih = Math.min(canvas.h - HALF * (safe + pad), (alt.share * canvas.w - HALF * pad) / aspect), iw = ih * aspect;
    return { iw, ih, w: iw + HALF * pad, h: ih + HALF * pad };
  }
  const ih = Math.min(canvas.h - HALF * (safe + pad), (canvas.w - HALF * (safe + pad)) / aspect), iw = ih * aspect;
  return { iw, ih, w: Math.min(canvas.w - HALF * safe, Math.max(data.lift.share * canvas.w, iw + HALF * pad)), h: ih + HALF * pad };
}

// A screen right after a screen (every second one of a longer run) is framed differently (look.kinds.screen.lift.alt,
// gate-keynote-3 medium item: dash and month shared one framing back to back): the lift data's `alt` at 16:9, else null.
// On a tall frame the same shots swap the headline and the card (tallHeroLayout).
const isRepeat = (ctx) => ctx.run % HALF === 1;
const altLift = (ctx) => (isWide(ctx.canvas) && ctx.data.lift?.alt !== undefined && isRepeat(ctx) ? ctx.data.lift.alt : null);

// The lifted card's centre x: the frame's centre, or (an alt lift of a titled screen, whose headline takes the left) the
// card's right edge on the title-safe inset.
function liftCentreX(ctx, shot, w, alt) {
  const { canvas, unit, data } = ctx;
  return alt !== null && shot.title !== undefined ? canvas.w - data.pushPad * unit - w / HALF : canvas.w / HALF;
}

// An alt lift's headline: the screen's title (its chrome keeps it too) in the display face, in the left column up to the
// card less the gutter, centred down the frame; it comes in once the card has landed, on the bare ground.
const HEADLINE_FADE = 0.35; // s
function liftHeadline(shot, ctx, card, at) {
  const { look, unit, canvas } = ctx;
  const x = look.grid.margin * unit;
  const room = { x, y: x, w: card[0] - look.grid.gutter * unit - x, h: canvas.h - HALF * x };
  // the column holds the headline alone, so it may take `alt.headShare` of the frame's height (the tall hero's 0.4 share
  // is for a headline over a card: at that height a three-line title could not reach the 144 floor and overflowed)
  const set = headlineSet(shot, ctx, room, ctx.data.lift.alt.headShare);
  const headH = set.layout.lines.at(-1).y - set.layout.lines[0].y + (CAP_HEIGHT + WORD_DESCENT) * set.font.size;
  const top = (canvas.h - headH) / HALF;
  const opacity = track([{ t: 0, v: 0 }, { t: at, v: 0 }, { t: at + HEADLINE_FADE, v: 1 }]);
  const text = node('text', `${shot.id}.headline`, { x, y: top + CAP_HEIGHT * set.font.size - set.layout.lines[0].y, layout: set.layout, font: set.font, fill: colourOf(look, 'ink'), role: 'hero' }, { tracks: { opacity } });
  return { node: text, box: [x, top, set.layout.width, headH] };
}

// The span the screen fades out over before its region lifts off it: LIFT_FADE seconds ending where the card starts to
// grow, the card already on over the region's own place, so the rest of the screen drops away round the region and
// nothing of it shows beside the growing card (gate-keynote-2 ruling 4: the 9:16 sheet showed sliced text beside it)
const LIFT_FADE = 0.4;
function liftSpan(ctx, at) {
  const settle = moveOf(ctx.look, 'settle');
  const to = Math.max(0, at - settle.dur);
  return { from: Math.max(0, to - LIFT_FADE), to };
}

// A wide screen whose region lifts off as its own card (look.kinds.screen.lift): the screen whole and centred, its
// chrome on, then fading out as the region card grows out of the region's place to the frame's centre; no push, no veil.
function liftLayout(shot, ctx, { picture, zoom, frame, image, boxes, target }) {
  const card = regionCard(shot, ctx, { picture, region: shot.regions[zoom.region], from: target, image, at: zoom.at });
  const screen = screenGroup(shot, ctx, frame, image, undefined, undefined, liftSpan(ctx, zoom.at));
  if (altLift(ctx) === null || shot.title === undefined) return { nodes: [screen, ...card.nodes], boxes: { ...boxes, regionCard: card.box }, camera: [] };
  const headline = liftHeadline(shot, ctx, card.box, zoom.at);
  return { nodes: [screen, ...card.nodes, headline.node], boxes: { ...boxes, regionCard: card.box, headline: headline.box }, camera: [] };
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
  if (isTallHero(shot, picture, canvas, data)) return null; // the card stays whole: no zoom (tallHeroLayout)
  if (isTwoPanel(shot, picture, canvas)) {
    const topH = Math.min(room.h * (1 - MIN_PANEL), (outerOf(frame, unit, [0, 0, room.w, (room.w * picture.height) / picture.width])[3]));
    const outer = outerOf(frame, unit, fitFramed(frame, unit, picture, { x: room.x, y: room.y, w: room.w, h: topH }));
    const top = outer[1] + outer[3] + data.gap * unit;
    const { wanted } = panelFit(picture, region, { x: room.x, y: top, w: room.w, h: room.y + room.h - top }, ctx.data?.wholeWidth, ctx.data?.cropRegion === true);
    return { wanted, cap: NATIVE };
  }
  if (cutsToCloseUp(look)) return null;
  if (data.lift !== undefined && data.pushPad !== undefined && isWide(canvas)) return null; // a lifted card: no push (liftLayout)
  const shared = isWide(canvas) ? { ...room, x: room.x + (room.w * (1 - data.wideShare)) / HALF, w: room.w * data.wideShare } : room;
  const image = fitFramed(frame, unit, picture, data.pushPad === undefined ? shared : pushSpace(shared, canvas, data.pushPad * unit));
  return { wanted: pushZoom(ctx, regionBox(image, region)), cap: nativeZoom(picture, image) };
}

// The space a padded push's card is fitted to (look.kinds.screen.pushPad): no larger than the frame inside the pad over
// PUSH_MIN, so the push that lands it whole inside the pad still pushes at least PUSH_MIN; centred in `space`.
function pushSpace(space, canvas, pad) {
  const w = Math.min(space.w, (canvas.w - HALF * pad) / PUSH_MIN), h = Math.min(space.h, (canvas.h - HALF * pad) / PUSH_MIN);
  return { x: space.x + (space.w - w) / HALF, y: space.y + (space.h - h) / HALF, w, h };
}

const regionBoxes = (shot, image) => Object.fromEntries(Object.entries(shot.regions ?? {}).map(([name, r]) => [`${REGION_PREFIX}${name}`, regionBox(image, r)]));

/** The framed screen in the room (a wide frame, or a phone on a tall one), and its zoom: a push with the rest dimmed, or
 *  a cut to a close-up. */
export function singleLayout(shot, ctx, { picture, zoom }) {
  const { look, unit, seed, canvas, data } = ctx;
  const room = roomOf(ctx);
  const frame = frameFor(shot, picture);
  const shared = isWide(canvas) ? { ...room, x: room.x + (room.w * (1 - data.wideShare)) / HALF, w: room.w * data.wideShare } : room;
  // a lifted region (data.lift) needs no push room: the screen keeps the whole shared space
  const space = zoom && data.pushPad !== undefined && !(data.lift !== undefined && isWide(canvas)) ? pushSpace(shared, canvas, data.pushPad * unit) : shared;
  const image = fitFramed(frame, unit, picture, space);
  const regions = regionBoxes(shot, image);
  const boxes = { screen: outerOf(frame, unit, image), image, ...regions };
  if (!zoom) return { nodes: [screenGroup(shot, ctx, frame, image)], boxes, camera: [] };
  const target = regions[`${REGION_PREFIX}${zoom.region}`];
  if (data.lift !== undefined && data.pushPad !== undefined && isWide(canvas)) return liftLayout(shot, ctx, { picture, zoom, frame, image, boxes, target });
  // a moving camera pushes in with the rest dimmed; a locked one on a tall frame (a phone that fills it: a cut to a
  // close-up of a strip would empty the frame) dims the rest and sweeps light across the region; on a wide frame it cuts
  if (!cutsToCloseUp(look) || !isWide(canvas)) {
    const build = (name, id) => registries.devices.get(name).build({ id, box: target, at: zoom.at, look, unit, seed, cover: [0, 0, canvas.w, canvas.h] }).nodes;
    if (!cutsToCloseUp(look)) {
      // data.pushFrame 'card' (keynote): the push frames the whole card, so no row of the screen is sliced at the frame's
      // top or bottom (n1's 16:9 sheet: the dimmed rows over the ring cut at the top); absent, it frames the region
      const keep = data.pushFrame === 'card' ? boxes.screen : null;
      // data.pushPad (keynote, gate-keynote-1 ruling 2): the card lands centred, inside the title-safe inset, so its
      // title and url stay on and readable
      const padded = keep !== null && data.pushPad !== undefined;
      const push = pushLayer(ctx, target, zoom.at, { max: nativeZoom(picture, image), keep, ...(padded ? { pad: data.pushPad * unit, centre: true } : {}) });
      const rest = data.pushDim === undefined ? build('focus', `${shot.id}.focus`) : [pushMask(shot, ctx, target, zoom.at)];
      // data.ring (keynote): the look's circle (the zoom ring) drawn round the region as the camera pushes in
      const ring = data.ring === true ? registries.devices.get('circle').build({ id: `${shot.id}.ring`, box: target, at: zoom.at, look, unit, seed }).nodes : [];
      // data.sweep (keynote, ruling 4): the band of light crosses the screen once after the push lands
      const sweep = data.sweep === true && registries.devices.get('sweep').supports(look) ? registries.devices.get('sweep').build({ id: `${shot.id}.sweep`, box: image, at: zoom.at + SWEEP_AFTER, look, unit, seed }).nodes : [];
      // the chrome texts fade as the push begins: carried out of the frame, or (a push that frames the card) past the
      // title-safe edge, they would be cut or reported; a padded push keeps them inside it
      return { nodes: [screenGroup(shot, ctx, frame, image, undefined, padded ? undefined : push[0].t), ...rest, ...ring, ...sweep], boxes, camera: [push] };
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

// The `clipping` kind: a document or screenshot shown as a physical object. An editorial composition (desk) lays the
// picture (a `cutout`) on a taped `card` 48 units larger on every side when the look styles one, turns the pair -2
// degrees and raises it in from below; a centred one (pop) shows the cutout alone, upright, popping in (inside the
// platform safe zone on 9:16). A device aimed at `region:<name>` lands on that part of the drawn picture (through every
// rotation on the way; circle, underline and arrow use the axis-aligned box of the turned region). Where the camera
// moves (desk) a region event pushes in until the region fills 50% of the width, and a `highlight` there is a marker
// frame with the rest of the picture dimmed (region-mark.mjs); where it is locked (pop) the shot cuts to a close-up of
// the region instead (close-ups.mjs). Pure and DOM-free.
import { registries } from '../registry.mjs';
import { node } from '../graph/node.mjs';
import { track, sample } from '../time/track.mjs';
import { layoutText } from '../text/layout.mjs';
import { landing } from '../devices/shared.mjs';
import { gridSpan } from '../looks/index.mjs';
import { regionMark } from './region-mark.mjs';
import { closeUpPlan, closeUps } from './close-ups.mjs';
import { clippingProblems, establishingFindings } from './clipping-rules.mjs';
import {
  CAP_HEIGHT, HERO_SCHEMA, REGION_PREFIX, sizeAt, fontFor, heroId, isWide, arrivesMatched, setCase, inkBox, regionOf,
  isEditorial, cutsToCloseUp, requireDevice, compositionRect, fieldNode, enterTracks, defaultCamera, pushLayer, onDevices,
  placeDevices, deviceCamera, withEstablishingView,
} from './shared.mjs';

const CAPTION_MAX = 80;
const REGIONS_MAX = 8;
const SHARE = 0.62; // on 16:9: the picture's longer side, of the canvas short side
const TALL_WIDTH = 0.92; // on other formats: the picture's width, of the available width
const TALL_HEIGHT = 0.6; // ...and its height at most this share of the available height
const CROP_ASPECT = 4 / 5; // a locked look's establishing crop on a vertical format, width over height...
const CROP_WIDTH = 0.92; // ...drawn at this share of the available width (never taller than the available height)
const CARD_PAD = 48; // units the card reaches past the picture on every side
const RISE = 80; // units the editorial picture rises in from
const EDITORIAL_TURN = -2; // degrees
const CENTRE = Object.freeze({ wide: [0.54, 0.52], tall: [0.5, 0.46] }); // editorial; centred uses the composition centre
const CAPTION = Object.freeze({ step: 1, gap: 24, lag: 0.2, outEase: 'outCubic' });
const DEGREES_TO_RADIANS = Math.PI / 180;
const HALF = 2;

// The look lays the picture on a taped card (desk's paper collage).
const hasCard = (look) => look.devices?.card?.edge === 'taped';

// A point in the picture group's local space carried to canvas pixels: turned by `turn` degrees about the centre.
function toCanvas(centre, turn, [x, y]) {
  const a = turn * DEGREES_TO_RADIANS, cos = Math.cos(a), sin = Math.sin(a);
  return [centre[0] + x * cos - y * sin, centre[1] + x * sin + y * cos];
}

// The canvas box of a local rectangle [x, y, w, h] after the turn.
function turnedBox(centre, turn, [x, y, w, h]) {
  const corners = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map((p) => toCanvas(centre, turn, p));
  const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
}

// The card (when the look has one) and the cutout, built settled (at 0) about the picture's centre.
function pictureParts(shot, ctx, { w, h, hero, crop }) {
  const { look, unit, seed } = ctx;
  requireDevice(look, 'cutout', 'clipping');
  const image = node('image', `${hero}.photo`, { src: shot.src, w, h, ...(crop ? { clip: crop } : {}) });
  const devices = registries.devices;
  const base = { at: 0, look, unit, seed };
  const pad = CARD_PAD * unit;
  const card = hasCard(look) ? devices.get('card').build({ ...base, id: `${hero}.card`, box: [-w / HALF - pad, -h / HALF - pad, w + HALF * pad, h + HALF * pad] }).nodes : [];
  const cutout = devices.get('cutout').build({ ...base, id: `${hero}.cutout`, box: [-w / HALF, -h / HALF, w, h], image }).nodes;
  return [...card, ...cutout];
}

// When the whole picture's entrance ends: the enter move, shortened to end one frame before a close-up switch that
// falls inside it; 0 (no entrance, shown from the start) when the switch leaves no frame for one.
function entranceEnd(move, hideAt, fps) {
  if (hideAt === undefined || hideAt - 1 / fps >= move.dur) return move.dur;
  return Math.max(0, hideAt - 1 / fps);
}

// `tr` (its keys eased with `easeName`) until `hideAt`, then hidden on that exact frame; unchanged without `hideAt`.
function hiddenFrom(tr, hideAt, easeName) {
  if (hideAt === undefined) return tr;
  const before = tr.points.filter((p) => p.t < hideAt).map((p, i) => ({ t: p.t, v: p.v, ...(i > 0 ? { ease: easeName } : {}) }));
  const keys = before.length > 0 ? before : [{ t: 0, v: 0 }];
  return track([...keys, { t: hideAt, v: sample(tr, hideAt) }, { t: hideAt, v: 0 }]);
}

// The picture group at `centre`: the parts and any region marks, turned -2 degrees in an editorial composition and
// entering from below, or popping in when centred, over the enter move from the shot start (a matched hero has no
// entrance); gone on the frame of `hideAt` when the shot cuts to a close-up.
function pictureGroup(shot, ctx, { hero, centre, children, hideAt }) {
  const { look, unit, fps } = ctx;
  const editorial = isEditorial(look);
  const end = entranceEnd(look.moves.enter, hideAt, fps);
  const move = { ...look.moves.enter, dur: end };
  const enters = !arrivesMatched(shot, ctx) && end > 0;
  const tracks = { opacity: hiddenFrom(enters ? landing(end, move, 0, 1) : track([{ t: 0, v: 1 }]), hideAt, move.ease) };
  if (enters && editorial) tracks.y = landing(end, move, centre[1] + RISE * unit, centre[1]);
  if (enters && move.scale !== undefined) tracks.scale = landing(end, move, move.scale, 1);
  const props = { x: centre[0], y: centre[1], ...(editorial ? { rotate: EDITORIAL_TURN } : {}) };
  return node('group', hero, props, { tracks, children });
}

const turnOf = (group, childId) => (group.props.rotate ?? 0) + (group.children.find((n) => n.id === childId)?.props.rotate ?? 0);

// The caption fades in after the picture. When the camera pushes in (`push`, its two keys) it fades out on the way,
// since the push would carry it off the bottom of the frame; when the shot cuts to a close-up (`hideAt`) it goes on
// that frame, and never fades in after it.
function captionOpacity(look, { push, hideAt }) {
  const enter = landing(look.moves.enter.dur + CAPTION.lag, look.moves.enter, 0, 1);
  if (hideAt !== undefined) return hiddenFrom(enter, hideAt, look.moves.enter.ease);
  if (push === null) return enter;
  const [from, to] = push;
  const shown = enter.points.at(-1).t;
  return track([
    ...enter.points.map((p, i) => ({ t: p.t, v: p.v, ...(i > 0 ? { ease: look.moves.enter.ease } : {}) })),
    { t: Math.max(shown, from.t), v: 1 },
    { t: Math.max(shown, to.t), v: 0, ease: CAPTION.outEase },
  ]);
}

function captionNode(shot, ctx, { group, hero, w, h, centre, leaves }) {
  if (shot.caption === undefined) return null;
  const { look, unit, measure } = ctx;
  const card = hasCard(look);
  const reach = card ? CARD_PAD * unit : look.keyline * unit;
  const corner = toCanvas(centre, turnOf(group, card ? `${hero}.card` : `${hero}.cutout`), [-w / HALF - reach, h / HALF + reach]);
  const font = fontFor(look, 'label', sizeAt(look, CAPTION.step, unit), unit);
  const layout = layoutText({ text: setCase(look, 'label', shot.caption), font, maxWidth: w + HALF * reach, measure });
  const x = corner[0];
  const y = corner[1] + CAPTION.gap * unit - (layout.lines[0].y - CAP_HEIGHT * font.size);
  const tracks = { ...enterTracks(look, unit, look.moves.enter.dur + CAPTION.lag, { y }), opacity: captionOpacity(look, leaves) };
  const text = node('text', `${shot.id}.caption`, { x, y, layout, font, fill: look.palette.ink2, role: 'caption' }, { tracks });
  return { text, box: inkBox(x, y, layout) };
}

function centreOf(ctx) {
  const { look, canvas } = ctx;
  if (!isEditorial(look)) {
    const rect = compositionRect(ctx);
    return [rect.cx, rect.cy];
  }
  const [fx, fy] = isWide(canvas) ? CENTRE.wide : CENTRE.tall;
  return [fx * canvas.w, fy * canvas.h];
}

// The space a picture fits in: the platform safe zone for pop on 9:16, else the canvas inside the margins.
function availableArea(ctx) {
  const { look, canvas, unit } = ctx;
  const rect = compositionRect(ctx);
  if (rect.safe) return { w: rect.w, h: rect.h };
  return { w: gridSpan(look, canvas, 1, look.grid.columns).w, h: canvas.h - 2 * look.grid.margin * unit };
}

// A locked camera (pop) on a vertical format cannot push in, so its establishing picture is a crop of the source: a
// window of CROP_ASPECT, as tall as the image allows, centred horizontally on the first region an event targets
// (clamped inside the image), or on the image's centre. Null elsewhere: the whole picture is shown.
export function establishingCrop(shot, ctx, picture) {
  if (!cutsToCloseUp(ctx.look) || isWide(ctx.canvas)) return null;
  let h = picture.height, w = h * CROP_ASPECT;
  if (w > picture.width) [w, h] = [picture.width, picture.width / CROP_ASPECT];
  const target = (shot.on ?? []).map((item) => shot.regions?.[regionOf(item.target)]).find(Boolean);
  const cx = target ? (target[0] + target[2] / HALF) * picture.width : picture.width / HALF;
  const x = Math.min(picture.width - w, Math.max(0, cx - w / HALF));
  return [x, (picture.height - h) / HALF, w, h];
}

// The establishing crop's drawn size: CROP_WIDTH of the available width, and no taller than the available height less
// room for a caption under it on each side (the picture stays centred, so the room is kept above as well).
function cropSize(ctx, crop, caption) {
  const { look, unit } = ctx;
  const available = availableArea(ctx);
  const room = caption === undefined ? 0 : look.keyline * unit + CAPTION.gap * unit + sizeAt(look, CAPTION.step, unit) * look.lineHeight.text;
  const fit = Math.min((CROP_WIDTH * available.w) / crop[2], (available.h - HALF * room) / crop[3]);
  return { w: crop[2] * fit, h: crop[3] * fit };
}

// The picture's drawn size: on 16:9 its longer side is SHARE of the canvas short side; elsewhere its width is
// TALL_WIDTH of the available width, its height at most TALL_HEIGHT of the available height.
function pictureSize(ctx, picture, crop, caption) {
  const { canvas } = ctx;
  if (crop) return cropSize(ctx, crop, caption);
  if (isWide(canvas)) {
    const fit = (SHARE * Math.min(canvas.w, canvas.h)) / Math.max(picture.width, picture.height);
    return { w: picture.width * fit, h: picture.height * fit };
  }
  const available = availableArea(ctx);
  const fit = Math.min((TALL_WIDTH * available.w) / picture.width, (TALL_HEIGHT * available.h) / picture.height);
  return { w: picture.width * fit, h: picture.height * fit };
}

const isRegionEvent = (item) => regionOf(item.target) !== null;
const isRegionHighlight = (item) => item.do === 'highlight' && isRegionEvent(item);

// One group per region highlight, turned like the cutout, holding its frame and overlay in the picture's own space.
function regionMarks(shot, ctx, { w, h, tilt, local }) {
  return (shot.on ?? []).flatMap((item, j) => {
    if (!isRegionHighlight(item)) return [];
    const region = shot.regions?.[regionOf(item.target)];
    if (!region) throw new Error(`clipping: shot "${shot.id}": on[${j}] target "${item.target}" names no region`);
    const id = `${shot.id}.on${j}`;
    const children = regionMark({ id, region: local(region), picture: [-w / HALF, -h / HALF, w, h], at: ctx.at(item.at), look: ctx.look, unit: ctx.unit, seed: ctx.seed });
    return [node('group', id, tilt === 0 ? {} : { rotate: tilt }, { children })];
  });
}

function expandClipping(given, ctx) {
  const { look, unit, timing } = ctx;
  const shot = withEstablishingView(given, ctx); // a region event waits until the whole picture has been seen
  const problems = clippingProblems(shot);
  if (problems.length > 0) throw new Error(`clipping: shot "${shot.id}": ${problems.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
  const closeUp = cutsToCloseUp(look);
  const picture = ctx.asset(shot.src);
  const crop = establishingCrop(shot, ctx, picture);
  const { w, h } = pictureSize(ctx, picture, crop, shot.caption);
  const hero = heroId(shot, 'image');
  const centre = centreOf(ctx);
  const parts = pictureParts(shot, ctx, { w, h, hero, crop });
  const tilt = parts.find((n) => n.id === `${hero}.cutout`)?.props.rotate ?? 0;
  const turn = (isEditorial(look) ? EDITORIAL_TURN : 0) + tilt;
  // a region (fractions of the whole image) in the drawn picture's own space, through the crop when there is one
  const [cx0, cy0, cw, ch] = crop ?? [0, 0, picture.width, picture.height];
  const local = ([fx, fy, fw, fh]) => {
    const sx = w / cw, sy = h / ch;
    return [(fx * picture.width - cx0) * sx - w / HALF, (fy * picture.height - cy0) * sy - h / HALF, fw * picture.width * sx, fh * picture.height * sy];
  };
  // A moving camera pushes in on a region; a locked one cuts to a close-up of it instead (close-ups.mjs).
  const plan = closeUp ? closeUpPlan(shot, ctx) : null;
  if (plan && plan.cuts.length > 0) requireDevice(look, 'punch', 'clipping');
  const hideAt = plan?.cuts[0]?.at;
  const marks = closeUp ? [] : regionMarks(shot, ctx, { w, h, tilt, local });
  const group = pictureGroup(shot, ctx, { hero, centre, children: [...parts, ...marks], hideAt });
  // a region's box is the part of it the drawn picture shows (an establishing crop may cut it)
  const shown = (r) => {
    const left = Math.max(r[0], -w / HALF), top = Math.max(r[1], -h / HALF);
    return [left, top, Math.max(0, Math.min(r[0] + r[2], w / HALF) - left), Math.max(0, Math.min(r[1] + r[3], h / HALF) - top)];
  };
  const inPicture = Object.fromEntries(Object.entries(shot.regions ?? {}).map(([name, region]) => [`${REGION_PREFIX}${name}`, turnedBox(centre, turn, shown(local(region)))]));
  const close = plan ? closeUps(shot, ctx, { picture, area: availableArea(ctx), centre, plan }) : { nodes: [], camera: [], boxes: {} };
  const pictureBoxes = { image: turnedBox(centre, turn, [-w / HALF, -h / HALF, w, h]), ...inPicture, ...close.boxes };
  // The camera pushes in on the first event aimed at a region, landing as the event does (moving cameras only).
  const pushed = closeUp ? undefined : (shot.on ?? []).find(isRegionEvent);
  const push = pushed && pictureBoxes[pushed.target] ? pushLayer(ctx, pictureBoxes[pushed.target], ctx.at(pushed.at)) : null;
  const caption = captionNode(shot, ctx, { group, hero, w, h, centre, leaves: { push, hideAt } });
  const boxes = caption ? { ...pictureBoxes, caption: caption.box } : pictureBoxes;
  const devices = onDevices(shot, ctx, { boxes, defaultTarget: 'image', skip: closeUp ? isRegionEvent : isRegionHighlight });
  return {
    nodes: placeDevices([fieldNode(shot, ctx), group, ...close.nodes, ...(caption ? [caption.text] : [])], devices),
    camera: [...defaultCamera(look, timing, unit), ...(push ? [push] : []), ...close.camera, ...deviceCamera(devices)],
    boxes,
    hero,
    background: look.palette.paper,
  };
}

const FRACTION = { type: 'number', minimum: 0, maximum: 1 };

registries.kinds.add('clipping', {
  summary: 'A screenshot or picture shown as a clipping, with an optional caption; named regions of it can be pushed in on and marked with `on` events.',
  example: {
    id: 'query',
    show: 'clipping',
    src: 'assets/screenshot.png',
    say: 'Every chart on this page shows its query.',
    caption: 'The query',
    regions: { query: [0.55, 0.2, 0.35, 0.2] },
    on: [{ at: 'word:query', do: 'circle', target: 'region:query' }],
  },
  schema: {
    required: ['src'],
    properties: {
      src: { type: 'string', minLength: 1 },
      regions: {
        type: 'object',
        maxProperties: REGIONS_MAX,
        propertyNames: { pattern: '^[a-z][a-z0-9-]*$' },
        additionalProperties: { type: 'array', items: FRACTION, minItems: 4, maxItems: 4 },
      },
      caption: { type: 'string', minLength: 1, maxLength: CAPTION_MAX },
      hero: HERO_SCHEMA,
    },
  },
  srcFields: ['src'],
  heroTarget: 'image',
  targets: (shot) => [
    'image',
    ...(shot.caption === undefined ? [] : ['caption']),
    ...Object.keys(shot.regions ?? {}).map((name) => `${REGION_PREFIX}${name}`),
  ],
  ids: (shot) => [heroId(shot, 'image')],
  // A highlight on a region is drawn by this kind (region-mark.mjs, close-ups.mjs), in any look.
  regionDevices: ['highlight'],
  validate: clippingProblems,
  expand: expandClipping,
  review: (shot, ctx) => establishingFindings(shot, ctx),
  numbered: true, // counts toward the slug numbers of a film
});

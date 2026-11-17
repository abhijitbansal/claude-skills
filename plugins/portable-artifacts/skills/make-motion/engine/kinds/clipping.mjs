// The `clipping` kind: a document or screenshot shown as a physical object. An editorial composition (desk) lays the
// picture (a `cutout`) on a taped `card` 48 units larger on every side when the look styles one, turns the pair -2
// degrees and raises it in from below; a centred one (pop) shows the cutout alone, upright, popping in (inside the
// platform safe zone on 9:16). A device aimed at `region:<name>` lands on that part of the drawn picture (through every
// rotation on the way; circle, underline and arrow use the axis-aligned box of the turned region). Where the camera
// moves (desk) a region event pushes in until the region fills 58% of the width, and a `highlight` there is a marker
// frame with the rest of the picture card under a paper scrim (region-mark.mjs); where it is locked (pop) the shot cuts to a close-up of
// the region instead (close-ups.mjs), its establishing picture a window of the source (`crop`, or an automatic 4:5 one on
// a vertical format). The kicker and the caption are pinned to the frame over the picture (clipping-captions.mjs).
// Pure and DOM-free.
import { registries } from '../registry.mjs';
import { node } from '../graph/node.mjs';
import { track, sample } from '../time/track.mjs';
import { landing, pathPoints, roundedRect, colourOf } from '../devices/shared.mjs';
import { gridSpan } from '../looks/index.mjs';
import { regionMark } from './region-mark.mjs';
import { closeUpPlan, closeUps, closeUpRegionWidth } from './close-ups.mjs';
import { clippingProblems, establishingFindings } from './clipping-rules.mjs';
import { pinnedRoom, captionNodes, kickerNodes } from './clipping-captions.mjs';
import { stackArea, centredTop } from './stack.mjs';
import { slugBox } from './slug.mjs';
import { layeredCamera } from '../graph/camera.mjs';
import {
  HERO_SCHEMA, REGION_PREFIX, heroId, isWide, arrivesMatched, regionOf, isEditorial, cutsToCloseUp, requireDevice, compositionRect, fieldNode, onDevices, placeDevices, deviceCamera, captionTop, openingLanding, easePeak, NOT_BLANK, assertNoBlanks, unionBox,
} from './shared.mjs';
import { defaultCamera, pushLayer, withEstablishingView } from './camera.mjs';
import { unmarked } from './shared.mjs';

const CAPTION_MAX = 80;
const KICKER_MAX = 40;
const REGIONS_MAX = 8;
const SHARE = 0.62; // on 16:9: the picture's longer side, of the canvas short side
// on 16:9 in an editorial look: the picture's width, of the canvas width (look review 1: at SHARE the opening was an
// unreadable thumbnail), at most the height between the margins
const EDITORIAL_WIDE = 0.7;
const TALL_WIDTH = 0.92; // on other formats: the picture's width, of the available width
const TALL_HEIGHT = 0.6; // ...and its height at most this share of the available height
const CROP_ASPECT = 4 / 5; // a locked look's establishing crop on a vertical format, width over height...
const CROP_WIDTH = 0.92; // ...drawn at this share of the available width (never taller than the available height)
const CARD_PAD = 48; // units the card reaches past the picture on every side
const RISE = 80; // units the editorial picture rises in from
const EDITORIAL_TURN = -2; // degrees
const DEGREES_HALF_TURN = 180;
const TURN_ALLOWANCE = (4 * Math.PI) / DEGREES_HALF_TURN; // the group's -2 degrees and a cutout's seeded tilt, at most
const SLUG_CLEAR = 1; // gutters between a slug card and a pushed region's frame (more leaves a caption card no room under it)
const FRAME_REACH = 24; // units a region's marker frame reaches past the region (gap, stroke and hand overshoot)
const OPENING_OPACITY = 0.5; // the least of the picture shown on the first frame of a shot that opens on a hard cut
const FADE_EASE = 'outCubic'; // the picture's fade where the look's enter ease overshoots (a spring)
const POP_FROM = 0.9; // a centred picture's scale on its first frame, growing to 1 with no overshoot
const REACH_SLACK = 1; // px a picture keeps inside its area, for path coordinates rounded to 0.01
const CENTRE = Object.freeze({ wide: [0.54, 0.52], tall: [0.5, 0.46] }); // editorial; centred uses the composition centre
const DEGREES_TO_RADIANS = Math.PI / 180;
const HALF = 2;
const NO_ROOM = Object.freeze({ above: 0, below: 0 });

// The look lays the picture on a card: desk's taped paper, or a look whose clipping data says so (cosmos: its rounded
// card, look.kinds.clipping.card).
const hasCard = (look) => look.devices?.card?.edge === 'taped' || look.kinds?.clipping?.card === true;
// The picture group's turn in an editorial composition: the look's (look.kinds.clipping.turn), else EDITORIAL_TURN.
const editorialTurn = (look) => look.kinds?.clipping?.turn ?? EDITORIAL_TURN;
const GLOW_ALPHA = 0.5; // the card's glow at its edge, before the blur spreads it (screened)

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
  const cardBox = [-w / HALF - pad, -h / HALF - pad, w + HALF * pad, h + HALF * pad];
  const card = hasCard(look) ? devices.get('card').build({ ...base, id: `${hero}.card`, box: cardBox }).nodes : [];
  // a picture with transparency: the keyline and shadow follow its edge (ctx.asset(src).alpha, from the file's header)
  const cutout = devices.get('cutout').build({ ...base, id: `${hero}.cutout`, box: [-w / HALF, -h / HALF, w, h], image, alpha: ctx.asset(shot.src).alpha === true }).nodes;
  // the card's soft glow edge (look.kinds.clipping.glow, units of blur): the card's shape with an accent canvas shadow
  // (draw.mjs path glow, a smooth falloff), screened so it only brightens; the card covers its fill
  const reach = (look.kinds?.clipping?.glow ?? 0) * unit;
  const shape = roundedRect(...cardBox, (look.devices.card.radius ?? 0) * unit);
  const glow = card.length > 0 && reach > 0
    ? [node('path', `${hero}.glow`, { d: shape, fill: colourOf(look, look.devices.card.fill ?? 'paper'), blend: 'screen', glow: { color: look.palette.accent, alpha: GLOW_ALPHA, radius: reach } })]
    : [];
  return [...glow, ...card, ...cutout];
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
// entrance); gone on the frame of `hideAt` when the shot cuts to a close-up. It is drawn as one layer (props.layer), so
// its fade is a clean fade of one picture: card, shadows, keyline and image never show through one another. Seen whole
// from its first frame (a hard cut), it is at least OPENING_OPACITY there on it.
function pictureGroup(shot, ctx, { hero, centre, children, hideAt }) {
  const { look, unit, fps } = ctx;
  const editorial = isEditorial(look);
  const end = entranceEnd(look.moves.enter, hideAt, fps);
  const move = { ...look.moves.enter, dur: end };
  const enters = !arrivesMatched(shot, ctx) && end > 0;
  // the fade keeps the move's time but never its overshoot: a spring would carry the opacity past 1 and back below it
  const fadeMove = easePeak(move.ease) > 1 ? { ...move, ease: FADE_EASE } : move;
  // a centred (pop) picture is whole from its first frame and grows in without overshoot (look review 2: a grey,
  // half-faded first frame read as near black); the editorial one fades as it rises
  const fade = enters && editorial ? openingLanding(shot, ctx, end, fadeMove, 0, 1, OPENING_OPACITY) : track([{ t: 0, v: 1 }]);
  const tracks = { opacity: hiddenFrom(fade, hideAt, fadeMove.ease) };
  if (enters && editorial) tracks.y = landing(end, move, centre[1] + RISE * unit, centre[1]);
  if (enters && !editorial) tracks.scale = landing(end, { ...move, ease: FADE_EASE }, POP_FROM, 1);
  else if (enters && move.scale !== undefined) tracks.scale = landing(end, move, move.scale, 1);
  const turn = editorialTurn(look);
  const props = { x: centre[0], y: centre[1], layer: true, ...(editorial && turn !== 0 ? { rotate: turn } : {}) };
  return node('group', hero, props, { tracks, children });
}

// The band an editorial picture keeps inside, in px: from the top margin to the bottom margin, or, where the caption
// band is in use, to a gutter over it less the picture's rise (it rises in from RISE units lower).
function editorialRoom(ctx) {
  const { look, canvas, unit } = ctx;
  const margin = look.grid.margin * unit;
  const band = captionTop(ctx);
  if (band === Infinity) return { top: margin, bottom: canvas.h - margin, band: false };
  return { top: margin, bottom: Math.min(canvas.h - margin, band - look.grid.gutter * unit - RISE * unit), band: true };
}

// Where a picture `h` tall is centred: in what `room` leaves of the composition (pinnedRoom), on its optical centre on a
// tall frame and its middle on a wide one (stack.mjs centredTop), or the editorial point.
function centreOf(ctx, room = NO_ROOM, h = 0, w = 0) {
  const { look, canvas } = ctx;
  if (!isEditorial(look)) {
    const rect = compositionRect(ctx);
    // the area the picture was sized for (availableArea): the margins too when the rect is the whole canvas
    const inset = rect.safe ? 0 : look.grid.margin * ctx.unit;
    const area = { top: rect.top + inset + room.above, h: rect.h - HALF * inset - room.above - room.below };
    const top = centredTop(area, h, ctx);
    // a picture tall enough to meet the area's top on the optical centre keeps the middle: its spring then overshoots
    // evenly into the slack withinReach left above and below
    return [rect.cx, top <= area.top ? area.top + area.h / HALF : top + h / HALF];
  }
  // in the platform safe zone on a tall frame: the composition rect's centre (its band)
  const safe = compositionRect(ctx);
  if (safe.safe) return [safe.cx, safe.cy];
  const [fx, fy] = isWide(canvas) ? CENTRE.wide : CENTRE.tall;
  const { bottom, band } = editorialRoom(ctx);
  const turnedHalf = (h + Math.sin(TURN_ALLOWANCE) * w) / HALF;
  const cy = band ? Math.min(fy * canvas.h, bottom - turnedHalf) : fy * canvas.h; // over the caption band, its rise included
  const slug = isWide(canvas) ? slugBox(ctx.shot ?? {}, ctx) : null;
  if (slug === null || w === 0) return [fx * canvas.w, cy];
  // on a wide frame with a slug card: the picture's right edge a gutter left of the card, never past the left margin
  const margin = look.grid.margin * ctx.unit, gutter = look.grid.gutter * ctx.unit;
  const right = Math.min(fx * canvas.w + w / HALF, slug.inked[0] - gutter);
  return [Math.max(margin + w / HALF, right - w / HALF), cy];
}

// The space a picture fits in: the platform safe zone for pop on 9:16, else the canvas inside the margins, less the
// `room` kept above and below it for a stack look's kicker and caption (pinnedRoom).
function availableArea(ctx, room = NO_ROOM) {
  const { look, canvas, unit } = ctx;
  const rect = compositionRect(ctx);
  const kept = room.above + room.below;
  if (rect.safe) return { w: rect.w, h: rect.h - kept };
  return { w: gridSpan(look, canvas, 1, look.grid.columns).w, h: canvas.h - 2 * look.grid.margin * unit - kept };
}

// A locked camera (pop) cannot push in, so its establishing picture is a window of the source: the shot's `crop` exactly
// (fractions of the image) on any format; without one, on a vertical format, a window of CROP_ASPECT, as tall as the
// image allows, centred horizontally on the first region an event targets (clamped inside the image), or on the image's
// centre. Null elsewhere: the whole picture is shown (a moving camera shows it whole and pushes in, so `crop` is not
// used there).
export function establishingCrop(shot, ctx, picture) {
  if (!cutsToCloseUp(ctx.look)) return null;
  if (shot.crop !== undefined) {
    const [x, y, w, h] = shot.crop;
    return [x * picture.width, y * picture.height, w * picture.width, h * picture.height];
  }
  if (isWide(ctx.canvas)) return null;
  let h = picture.height, w = h * CROP_ASPECT;
  if (w > picture.width) [w, h] = [picture.width, picture.width / CROP_ASPECT];
  const target = (shot.on ?? []).map((item) => shot.regions?.[regionOf(item.target)]).find(Boolean);
  const cx = target ? (target[0] + target[2] / HALF) * picture.width : picture.width / HALF;
  const x = Math.min(picture.width - w, Math.max(0, cx - w / HALF));
  return [x, (picture.height - h) / HALF, w, h];
}

// The establishing window's drawn size: CROP_WIDTH of the available width, and no taller than the available height.
function cropSize(ctx, crop, room) {
  const available = availableArea(ctx, room);
  const fit = Math.min((CROP_WIDTH * available.w) / crop[2], available.h / crop[3]);
  return { w: crop[2] * fit, h: crop[3] * fit };
}

// The picture's drawn size before withinReach: on 16:9 its longer side is SHARE of the canvas short side; elsewhere its
// width is TALL_WIDTH of the available width, its height at most TALL_HEIGHT of the available height.
function plainSize(ctx, picture, crop, room) {
  const { canvas } = ctx;
  if (crop) return cropSize(ctx, crop, room);
  if (isWide(canvas) && isEditorial(ctx.look)) {
    const margin = ctx.look.grid.margin * ctx.unit;
    // a slug card top right keeps the picture's right edge a gutter left of it: the picture is then as wide as that
    // leaves, when it is less than EDITORIAL_WIDE (the slug and the picture never pile up in one corner); its turned
    // height keeps over the caption band through its rise (editorialRoom)
    const slug = slugBox(ctx.shot ?? {}, ctx);
    const room = slug === null ? Infinity : slug.inked[0] - ctx.look.grid.gutter * ctx.unit - margin;
    const { top, bottom, band } = editorialRoom(ctx);
    // over a caption band its turned height counts (turned height per unit height); between the margins its own does
    const turned = band ? 1 + (Math.sin(TURN_ALLOWANCE) * picture.width) / picture.height : 1;
    const fit = Math.min(Math.min(EDITORIAL_WIDE * canvas.w, room) / picture.width, (bottom - top) / (turned * picture.height));
    return { w: picture.width * fit, h: picture.height * fit };
  }
  if (isWide(canvas)) {
    const fit = (SHARE * Math.min(canvas.w, canvas.h)) / Math.max(picture.width, picture.height);
    return { w: picture.width * fit, h: picture.height * fit };
  }
  const available = availableArea(ctx, room);
  const fit = Math.min((TALL_WIDTH * available.w) / picture.width, (TALL_HEIGHT * available.h) / picture.height);
  return { w: picture.width * fit, h: picture.height * fit };
}

// `size` made smaller, where needed, so that a picture popping in about its centre (a look whose composition is not
// editorial) keeps its keyline and shadow inside the available area at the peak of its enter spring: the area less the
// spring's peak overshoot. The shadow's offset is allowed on every side, since the picture is centred in the area.
function withinReach(ctx, size, room) {
  if (isEditorial(ctx.look)) return size;
  const { peak, edge } = enterReach(ctx);
  const available = availableArea(ctx, room);
  const fit = Math.min(1, ((available.w - REACH_SLACK) / peak - edge) / size.w, ((available.h - REACH_SLACK) / peak - edge) / size.h);
  return { w: size.w * fit, h: size.h * fit };
}

// The enter spring's peak scale and the keyline and shadow's reach past the picture's edge (px).
function enterReach(ctx) {
  const { look, unit } = ctx;
  // a centred picture grows in without overshoot (pictureGroup), so it reaches no further than at rest
  return { peak: 1, edge: HALF * (look.keyline + Math.max(look.shadow.dx, look.shadow.dy)) * unit, keyline: look.keyline * unit };
}

// How tall a picture w x h turned `turn` degrees stands at the spring's peak: its keyline outside both edges and its
// shadow past one.
function reachHeight(w, h, turn, { peak, edge, keyline }) {
  const a = Math.abs((turn * Math.PI) / DEGREES_HALF_TURN);
  return (w * Math.sin(a) + h * Math.cos(a) + 2 * edge + keyline) * peak + HALF * REACH_SLACK;
}

// The picture's drawn size: plainSize, kept inside the available area through its entrance (withinReach).
const pictureSize = (ctx, picture, crop, room) => withinReach(ctx, plainSize(ctx, picture, crop, room), room);

const isRegionEvent = (item) => regionOf(item.target) !== null;

// Does a locked look's close-up enlarge the shot's first marked region? Always, unless the look sets a least gain
// (look.camera.closeUp.minGain, ledger): the region's width on its close-up over its width on the establishing picture
// (`shownWidth`: the whole picture's drawn width, so a region of share fw stands fw * shownWidth wide). A wide region on
// a tall frame is drawn no larger on its close-up than in the establishing window, and a cut to it reads as a zoom out.
function closeUpGains(shot, ctx, { picture, area, shownWidth }) {
  const least = ctx.look.camera?.closeUp?.minGain;
  const region = shot.regions?.[regionOf((shot.on ?? []).find(isRegionEvent)?.target)];
  if (least === undefined || !region) return true;
  return closeUpRegionWidth(region, picture, area, ctx.look) >= least * region[2] * shownWidth;
}
const isRegionHighlight = (item) => item.do === 'highlight' && isRegionEvent(item);

// The parts of the picture card a region scrim covers: the card's paper and tape strips or, in a look without a card,
// the cut-out's keyline. Never both: the keyline lies inside the paper, and a second outline over the region would fill
// the hole the scrim leaves there (nonzero rule).
const CARD_RE = /\.(paper|tape\d+)$/;
const KEYLINE_RE = /\.keyline$/;

// A point turned by `deg` degrees about the origin.
function turnBy([x, y], deg) {
  const a = deg * DEGREES_TO_RADIANS, cos = Math.cos(a), sin = Math.sin(a);
  return [x * cos - y * sin, x * sin + y * cos];
}

// `place` composed after node n's own transform (its rest props: x, y, rotate, scale).
const through = (n, place) => (p) => {
  const [x, y] = turnBy(p, n.props.rotate ?? 0);
  const scale = n.props.scale ?? 1;
  return place([x * scale + (n.props.x ?? 0), y * scale + (n.props.y ?? 0)]);
};

// The outline of every path under n whose id matches `re`, carried by `place` into the scrim's space.
function outlinesUnder(n, re, place) {
  const own = through(n, place);
  const mine = n.type === 'path' && re.test(n.id) ? [pathPoints(n.props.d).map(own)] : [];
  return [...mine, ...n.children.flatMap((child) => outlinesUnder(child, re, own))];
}

// What a region scrim covers, as outlines in the space of the marks group (the picture's space turned by the cut-out's
// `tilt`): the picture card's paper and tape (or the keyline), each through its own place and turn, so the scrim lies
// exactly on the card and nothing of it is left bright at its edge; the card's shadow stays on the desk.
function scrimOutlines(parts, tilt) {
  const of = (re) => parts.flatMap((part) => outlinesUnder(part, re, (p) => turnBy(p, -tilt)));
  const card = of(CARD_RE);
  return card.length > 0 ? card : of(KEYLINE_RE);
}

// The box of a marker frame's strokes in its group's space: the hull of their points, half a stroke wider.
function strokesBox(nodes) {
  const strokes = nodes.filter((n) => n.props.stroke);
  const points = strokes.flatMap((n) => pathPoints(n.props.d));
  const grow = Math.max(...strokes.map((n) => n.props.strokeWidth)) / HALF;
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  return [Math.min(...xs) - grow, Math.min(...ys) - grow, Math.max(...xs) - Math.min(...xs) + HALF * grow, Math.max(...ys) - Math.min(...ys) + HALF * grow];
}

// One group per region highlight, turned like the cutout, holding its frame and paper scrim in the picture's own space,
// as { group, region: its name, frame: the box of its strokes in that space }.
function regionMarks(shot, ctx, { cover, tilt, local }) {
  return (shot.on ?? []).flatMap((item, j) => {
    if (!isRegionHighlight(item)) return [];
    const name = regionOf(item.target);
    const region = shot.regions?.[name];
    if (!region) throw new Error(`clipping: shot "${shot.id}": on[${j}] target "${item.target}" names no region`);
    const id = `${shot.id}.on${j}`;
    const children = regionMark({ id, region: local(region), cover, at: ctx.at(item.at), look: ctx.look, unit: ctx.unit, seed: ctx.seed });
    return [{ group: node('group', id, tilt === 0 ? {} : { rotate: tilt }, { children }), region: name, frame: strokesBox(children) }];
  });
}

// The picture: its window, size, centre, parts and region marks, the group, and every box it gives (image, regions,
// close-ups), plus the close-up plan and nodes in a locked look.
function pictureLayout(shot, ctx, room) {
  const { look } = ctx;
  const closeUp = cutsToCloseUp(look);
  const picture = ctx.asset(shot.src);
  const crop = establishingCrop(shot, ctx, picture);
  const { w, h } = pictureSize({ ...ctx, shot }, picture, crop, room);
  const hero = heroId(shot, 'image');
  const parts = pictureParts(shot, ctx, { w, h, hero, crop });
  const tilt = parts.find((n) => n.id === `${hero}.cutout`)?.props.rotate ?? 0;
  const turn = (isEditorial(look) ? editorialTurn(look) : 0) + tilt;
  const reach = isEditorial(look) ? null : enterReach(ctx);
  const centre = centreOf({ ...ctx, shot }, room, reach === null ? h : reachHeight(w, h, turn, reach), w);
  // a region (fractions of the whole image) in the drawn picture's own space, through the crop when there is one
  const [cx0, cy0, cw, ch] = crop ?? [0, 0, picture.width, picture.height];
  const local = ([fx, fy, fw, fh]) => {
    const sx = w / cw, sy = h / ch;
    return [(fx * picture.width - cx0) * sx - w / HALF, (fy * picture.height - cy0) * sy - h / HALF, fw * picture.width * sx, fh * picture.height * sy];
  };
  // A moving camera pushes in on a region; a locked one cuts to a close-up of it instead (close-ups.mjs), unless the
  // close-up would not enlarge it (closeUpGains): then the region is marked on the establishing picture.
  const area = availableArea(ctx, room);
  const plan = closeUp && closeUpGains(shot, ctx, { picture, area, shownWidth: w * (picture.width / (crop ?? [0, 0, picture.width])[2]) }) ? closeUpPlan(shot, ctx) : null;
  if (plan && plan.cuts.length > 0) requireDevice(look, 'punch', 'clipping');
  // a region's box is the part of it the drawn picture shows (an establishing crop may cut it)
  const shown = (r) => {
    const left = Math.max(r[0], -w / HALF), top = Math.max(r[1], -h / HALF);
    return [left, top, Math.max(0, Math.min(r[0] + r[2], w / HALF) - left), Math.max(0, Math.min(r[1] + r[3], h / HALF) - top)];
  };
  const marks = plan ? [] : regionMarks(shot, ctx, { cover: scrimOutlines(parts, tilt), tilt, local: (r) => shown(local(r)) });
  const group = pictureGroup(shot, ctx, { hero, centre, children: [...parts, ...marks.map((m) => m.group)], hideAt: plan?.cuts[0]?.at });
  // each marker frame's box on the canvas at rest, by region name (an editorial caption card moves under it)
  const frames = Object.fromEntries(marks.map((m) => [m.region, turnedBox(centre, turn, m.frame)]));
  const inPicture = Object.fromEntries(Object.entries(shot.regions ?? {}).map(([name, region]) => [`${REGION_PREFIX}${name}`, turnedBox(centre, turn, shown(local(region)))]));
  const close = plan ? closeUps(shot, ctx, { picture, area, centre, plan }) : { nodes: [], camera: [], boxes: {} };
  const boxes = { image: turnedBox(centre, turn, [-w / HALF, -h / HALF, w, h]), ...inPicture, ...close.boxes };
  return { hero, group, plan, close, boxes, frames };
}

// The kicker and the caption, pinned over the picture. A stack caption captions the close-up of the first highlight and
// arrives with it, or the picture from the start when there is none; an editorial caption card follows a push (`follow`).
function pinnedParts(shot, ctx, { plan, boxes, close }, follow) {
  const marks = close?.marks;
  const area = isEditorial(ctx.look) ? null : stackArea(ctx);
  const kicker = kickerNodes(shot, ctx, { left: area?.left, pictureTop: boxes.image[1] });
  const lift = plan?.events.find((e) => e.item.do === 'highlight');
  // shown from frame 0, the caption shares the frame with every close-up the shot cuts to: it goes under all of them
  // and the marks drawn round them (close-ups.mjs marks)
  const closes = (plan?.cuts ?? []).map((c) => boxes[`${REGION_PREFIX}${c.region}`]).filter(Boolean);
  // the close-ups as drawn (close-ups.mjs shown): a context window shows picture round its region, which the caption
  // clears too (it sat on the zoomed picture under the region alone); without one each is its region's box
  const anchor = lift ? boxes[`${REGION_PREFIX}${lift.region}`] : unionBox([boxes.image, ...closes, ...(close?.shown ?? []), ...(marks ?? [])]);
  const caption = captionNodes(shot, ctx, { left: area?.left, maxWidth: area?.w, anchor, at: lift?.at ?? 0, follow });
  return { nodes: [...kicker, ...(caption ? caption.nodes : [])], boxes: caption ? { caption: caption.box } : {} };
}

// What an editorial caption card follows when the camera pushes in on a region: the region's box and its marker frame's
// at rest (the region itself where no frame is drawn), the push keys and the camera they make with the drift. Null
// without a push.
function followOf(laid, pushed, push, base) {
  if (!push) return null;
  const region = laid.boxes[pushed.target];
  return { region, frame: laid.frames[regionOf(pushed.target)] ?? region, push, camera: layeredCamera([...base, push]) };
}

function expandClipping(given, ctx) {
  assertNoBlanks(given, 'clipping'); // a blank text is the validator's to refuse; expand names it rather than failing in layout
  const { look, unit, timing } = ctx;
  const shot = withEstablishingView(given, ctx); // a region event waits until the whole picture has been seen
  const problems = clippingProblems(shot);
  if (problems.length > 0) throw new Error(`clipping: shot "${shot.id}": ${problems.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
  const closeUp = cutsToCloseUp(look);
  const laid = pictureLayout(shot, ctx, pinnedRoom(shot, ctx));
  // The camera pushes in on the first event aimed at a region, landing as the event does (moving cameras only).
  const pushed = closeUp ? undefined : (shot.on ?? []).find(isRegionEvent);
  // a slug card stays clear of the pushed region: its frame's top a gutter (and the frame's own reach) under the card
  const slug = slugBox(shot, ctx);
  const below = slug === null ? -Infinity : slug.inked[1] + slug.inked[3] + (SLUG_CLEAR * look.grid.gutter + FRAME_REACH) * unit;
  const push = pushed && laid.boxes[pushed.target] ? pushLayer(ctx, laid.boxes[pushed.target], ctx.at(pushed.at), { below, caption: shot.caption !== undefined }) : null;
  const drift = defaultCamera(look, timing, unit);
  const pins = pinnedParts(shot, ctx, laid, followOf(laid, pushed, push, drift));
  const boxes = { ...laid.boxes, ...pins.boxes };
  // a close-up draws its region's devices itself; without one they land on the region of the picture
  const devices = onDevices(shot, ctx, { boxes, defaultTarget: 'image', skip: laid.plan ? isRegionEvent : isRegionHighlight });
  return {
    nodes: placeDevices([fieldNode(shot, ctx), laid.group, ...laid.close.nodes, ...pins.nodes], devices),
    camera: [...drift, ...(push ? [push] : []), ...laid.close.camera, ...deviceCamera(devices)],
    boxes,
    hero: laid.hero,
    background: look.palette.paper,
  };
}

const FRACTION = { type: 'number', minimum: 0, maximum: 1 };

registries.kinds.add('clipping', {
  summary: 'A screenshot or picture shown as a clipping, with an optional caption and kicker (pinned to the frame); named regions of it can be pushed in on and marked with `on` events; `crop` sets the establishing window where the camera is locked (pop).',
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
      caption: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: CAPTION_MAX },
      kicker: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: KICKER_MAX },
      crop: { type: 'array', items: FRACTION, minItems: 4, maxItems: 4 },
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
  expand: (shot, ctx) => expandClipping(unmarked(shot), ctx),
  review: (shot, ctx) => establishingFindings(shot, ctx),
  numbered: true, // counts toward the slug numbers of a film
});

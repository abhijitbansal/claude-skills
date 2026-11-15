// The `clipping` kind: a document or screenshot shown as a physical object. `desk` lays the picture (a `cutout`) on a
// `card` 48 units larger on every side, turns the pair -2 degrees and raises it in from below; `pop` shows the cutout
// alone, upright, popping in (inside the platform safe zone on 9:16). A device aimed at `region:<name>` lands on that
// part of the drawn picture (through every rotation on the way); a `highlight` there is a marker frame with the rest
// of the picture dimmed (region-mark.mjs). The camera pushes in on the first such region, landing as the event does,
// close enough that the region fills 62% of the width. Pure and DOM-free.
import { registries } from '../registry.mjs';
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';
import { layoutText } from '../text/layout.mjs';
import { landing } from '../devices/shared.mjs';
import { gridSpan } from '../looks/index.mjs';
import { regionMark } from './region-mark.mjs';
import {
  CAP_HEIGHT, WORD_DESCENT, HERO_SCHEMA, sizeAt, fontFor, heroId, isWide, arrivesMatched, typeset, compositionRect, fieldNode, enterTracks,
  defaultCamera, pushLayer, onDevices, placeDevices, deviceCamera, unionBox,
} from './shared.mjs';

const CAPTION_MAX = 80;
const REGIONS_MAX = 8;
const SHARE = 0.62; // on 16:9: the picture's longer side, of the canvas short side
const TALL_WIDTH = 0.92; // on other formats: the picture's width, of the available width
const TALL_HEIGHT = 0.6; // ...and its height at most this share of the available height
const CARD_PAD = 48; // units the card reaches past the picture on every side
const RISE = 80; // units the desk picture rises in from
const DESK_TURN = -2; // degrees
const CENTRE = Object.freeze({ deskWide: [0.54, 0.52], deskTall: [0.5, 0.46] }); // pop: the composition centre
const CAPTION = Object.freeze({ step: 1, gap: 24, lag: 0.2, outEase: 'outCubic' });
const REGION_PREFIX = 'region:';
const DEGREES_TO_RADIANS = Math.PI / 180;
const HALF = 2;

const isDesk = (look) => look.emphasis === 'highlight';

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

function checkRegions(shot) {
  for (const [name, [x, y, w, h]] of Object.entries(shot.regions ?? {})) {
    if (x + w > 1 + 1e-9 || y + h > 1 + 1e-9) throw new Error(`clipping: shot "${shot.id}": region "${name}" runs past the image (x + w and y + h must be at most 1)`);
  }
}

// The card (desk) and the cutout, built settled (at 0) about the picture's centre.
function pictureParts(shot, ctx, { w, h, hero }) {
  const { look, unit, seed } = ctx;
  const image = node('image', `${hero}.photo`, { src: shot.src, w, h });
  const devices = registries.devices;
  const base = { at: 0, look, unit, seed };
  const pad = CARD_PAD * unit;
  const card = isDesk(look) ? devices.get('card').build({ ...base, id: `${hero}.card`, box: [-w / HALF - pad, -h / HALF - pad, w + HALF * pad, h + HALF * pad] }).nodes : [];
  const cutout = devices.get('cutout').build({ ...base, id: `${hero}.cutout`, box: [-w / HALF, -h / HALF, w, h], image }).nodes;
  return [...card, ...cutout];
}

// The picture group at `centre`: the parts and any region marks, turned -2 degrees in desk, entering from below
// (desk) or popping in (pop) over the enter move from the shot start; a matched hero has no entrance.
function pictureGroup(shot, ctx, { hero, centre, children }) {
  const { look, unit } = ctx;
  const desk = isDesk(look);
  const move = look.moves.enter;
  const rest = move.dur;
  let tracks = {};
  if (!arrivesMatched(shot, ctx)) {
    tracks = { opacity: landing(rest, move, 0, 1) };
    if (desk) tracks.y = landing(rest, move, centre[1] + RISE * unit, centre[1]);
    if (move.scale !== undefined) tracks.scale = landing(rest, move, move.scale, 1);
  }
  const props = { x: centre[0], y: centre[1], ...(desk ? { rotate: DESK_TURN } : {}) };
  return node('group', hero, props, { tracks, children });
}

const turnOf = (group, childId) => (group.props.rotate ?? 0) + (group.children.find((n) => n.id === childId)?.props.rotate ?? 0);

// The caption fades in after the picture; when the camera pushes in (`push`, its two keys) it fades out on the way,
// since the push would carry it off the bottom of the frame.
function captionOpacity(look, push) {
  const enter = landing(look.moves.enter.dur + CAPTION.lag, look.moves.enter, 0, 1);
  if (push === null) return enter;
  const [from, to] = push;
  const shown = enter.points.at(-1).t;
  return track([
    ...enter.points.map((p, i) => ({ t: p.t, v: p.v, ...(i > 0 ? { ease: look.moves.enter.ease } : {}) })),
    { t: Math.max(shown, from.t), v: 1 },
    { t: Math.max(shown, to.t), v: 0, ease: CAPTION.outEase },
  ]);
}

function captionNode(shot, ctx, { group, hero, w, h, centre, push }) {
  if (shot.caption === undefined) return null;
  const { look, unit, measure } = ctx;
  const desk = isDesk(look);
  const reach = desk ? CARD_PAD * unit : look.keyline * unit;
  const corner = toCanvas(centre, turnOf(group, desk ? `${hero}.card` : `${hero}.cutout`), [-w / HALF - reach, h / HALF + reach]);
  const font = fontFor(look, 'label', sizeAt(look, CAPTION.step, unit), unit);
  const layout = layoutText({ text: look.caps.label ? typeset(shot.caption).toUpperCase() : typeset(shot.caption), font, maxWidth: w + HALF * reach, measure });
  const x = corner[0];
  const y = corner[1] + CAPTION.gap * unit - (layout.lines[0].y - CAP_HEIGHT * font.size);
  const tracks = { ...enterTracks(look, unit, look.moves.enter.dur + CAPTION.lag, { y }), opacity: captionOpacity(look, push) };
  const text = node('text', `${shot.id}.caption`, { x, y, layout, font, fill: look.palette.ink2 }, { tracks });
  const box = unionBox(layout.lines.map((l) => [x + l.x, y + l.y - CAP_HEIGHT * font.size, l.width, (CAP_HEIGHT + WORD_DESCENT) * font.size]));
  return { text, box };
}

function centreOf(ctx) {
  const { look, canvas } = ctx;
  if (!isDesk(look)) {
    const rect = compositionRect(ctx);
    return [rect.cx, rect.cy];
  }
  const [fx, fy] = isWide(canvas) ? CENTRE.deskWide : CENTRE.deskTall;
  return [fx * canvas.w, fy * canvas.h];
}

// The picture's drawn size: on 16:9 its longer side is SHARE of the canvas short side; elsewhere its width is
// TALL_WIDTH of the available width (the platform safe zone for pop on 9:16, else inside the margins), its height at most
// TALL_HEIGHT of the available height.
function pictureSize(ctx, picture) {
  const { look, canvas, unit } = ctx;
  if (isWide(canvas)) {
    const fit = (SHARE * Math.min(canvas.w, canvas.h)) / Math.max(picture.width, picture.height);
    return { w: picture.width * fit, h: picture.height * fit };
  }
  const rect = compositionRect(ctx);
  const margin = look.grid.margin * unit;
  const available = rect.safe ? { w: rect.w, h: rect.h } : { w: gridSpan(look, canvas, 1, look.grid.columns).w, h: canvas.h - 2 * margin };
  const fit = Math.min((TALL_WIDTH * available.w) / picture.width, (TALL_HEIGHT * available.h) / picture.height);
  return { w: picture.width * fit, h: picture.height * fit };
}

const isRegionHighlight = (item) => item.do === 'highlight' && typeof item.target === 'string' && item.target.startsWith(REGION_PREFIX);

// One group per region highlight, turned like the cutout, holding its frame and overlay in the picture's own space.
function regionMarks(shot, ctx, { w, h, tilt, local }) {
  return (shot.on ?? []).flatMap((item, j) => {
    if (!isRegionHighlight(item)) return [];
    const region = shot.regions?.[item.target.slice(REGION_PREFIX.length)];
    if (!region) throw new Error(`clipping: shot "${shot.id}": on[${j}] target "${item.target}" names no region`);
    const id = `${shot.id}.on${j}`;
    const children = regionMark({ id, region: local(region), picture: [-w / HALF, -h / HALF, w, h], at: ctx.at(item.at), look: ctx.look, unit: ctx.unit, seed: ctx.seed });
    return [node('group', id, tilt === 0 ? {} : { rotate: tilt }, { children })];
  });
}

function expandClipping(shot, ctx) {
  const { look, unit, timing } = ctx;
  checkRegions(shot);
  const { w, h } = pictureSize(ctx, ctx.asset(shot.src));
  const hero = heroId(shot, 'image');
  const centre = centreOf(ctx);
  const parts = pictureParts(shot, ctx, { w, h, hero });
  const tilt = parts.find((n) => n.id === `${hero}.cutout`)?.props.rotate ?? 0;
  const turn = (isDesk(look) ? DESK_TURN : 0) + tilt;
  const local = ([fx, fy, fw, fh]) => [fx * w - w / HALF, fy * h - h / HALF, fw * w, fh * h];
  const group = pictureGroup(shot, ctx, { hero, centre, children: [...parts, ...regionMarks(shot, ctx, { w, h, tilt, local })] });
  const boxes = { image: turnedBox(centre, turn, local([0, 0, 1, 1])) };
  for (const [name, region] of Object.entries(shot.regions ?? {})) boxes[`${REGION_PREFIX}${name}`] = turnedBox(centre, turn, local(region));
  // The camera pushes in on the first event aimed at a region, landing as the event does.
  const pushed = (shot.on ?? []).find((item) => item.target?.startsWith(REGION_PREFIX));
  const push = pushed && boxes[pushed.target] ? pushLayer(ctx, boxes[pushed.target], ctx.at(pushed.at)) : null;
  const caption = captionNode(shot, ctx, { group, hero, w, h, centre, push });
  if (caption) boxes.caption = caption.box;
  const devices = onDevices(shot, ctx, { boxes, defaultTarget: 'image', skip: isRegionHighlight });
  return {
    nodes: placeDevices([fieldNode(shot, ctx), group, ...(caption ? [caption.text] : [])], devices),
    camera: [...defaultCamera(look, timing, unit), ...(push ? [push] : []), ...deviceCamera(devices)],
    boxes,
    hero,
    background: look.palette.paper,
  };
}

const FRACTION = { type: 'number', minimum: 0, maximum: 1 };

registries.kinds.add('clipping', {
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
  expand: expandClipping,
});

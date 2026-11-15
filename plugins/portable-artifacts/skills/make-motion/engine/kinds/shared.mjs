// Helpers shared by the designed shot kinds (statement, number, clipping): type sizes and fonts from the look, the
// field every shot draws first, composition and look checks, entrances, the default camera, the camera push,
// and the devices a shot's `on` events place. Pure and DOM-free; layout runs on ctx.measure.
import { registries } from '../registry.mjs';
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';
import { fitText } from '../text/layout.mjs';
import { landing } from '../devices/shared.mjs';
import { ease } from '../time/ease.mjs';
import { aloneFromFrame } from '../cuts/index.mjs';

// Cap height as a share of the font size. Canvas reports only the font's ascent box, not the cap height, so the
// layouts below place cap lines with this ratio (Fraunces and Archivo both sit close to it).
export const CAP_HEIGHT = 0.7;
// What a word box reaches below the baseline, as a share of the font size.
export const WORD_DESCENT = 0.12;
export const HERO_SCHEMA = Object.freeze({ type: 'string', pattern: '^[a-z][a-z0-9-]*$' });

export const FIELD_ID = 'field';
/** Ids the kinds use for nodes of their own, which a shot's `hero` may not take. */
export const RESERVED_IDS = Object.freeze([FIELD_ID]);
/** The prefix of a target that names one of a clipping's regions. */
export const REGION_PREFIX = 'region:';
const FIELD_BLEED = 0.06; // the field covers the canvas plus this share of it on every side
const PUSH = Object.freeze({ share: 0.58, min: 1.2, max: 3.2, dur: 0.9 }); // the region fills `share` of the width
const PUSH_OVERSHOOT = 1.2; // a spring ease can carry the push this far past its target; the pan limit allows for it
const ARROW_REACH = 160; // units: an `on` arrow starts this far below and left of its target
const FORCE_MARK = '|';
const APOSTROPHE_RE = /(\p{L})'(?=\p{L})/gu;
const HALF = 2;

// ---- look data ----

/** The pixel size of 1-based type scale step `step` (1 = the smallest of the look's five sizes). */
export const sizeAt = (look, step, unit) => look.scale[step - 1] * unit;

/** A layout font for `role` at `size` px: the look's face, its tracking for that size and its line height. */
export function fontFor(look, role, size, unit) {
  const { family, weight, width, wordSpace } = look.fonts[role];
  const lineHeight = role === 'display' ? look.lineHeight.display : look.lineHeight.text;
  return { family, weight, width, size, tracking: look.tracking(size / unit, role), lineHeight, ...(wordSpace === undefined ? {} : { wordSpace }) };
}

/** The id of a kind's main node: the shot's `hero` when given, else `<shot id>.<role>`. */
export const heroId = (shot, role) => shot.hero ?? `${shot.id}.${role}`;

/** A 16:9 canvas is wide; 9:16, 1:1 and 4:5 are not. */
export const isWide = (canvas) => canvas.w > canvas.h;

// A 9:16 canvas, where a viral look composes inside the platform safe zone.
const PORTRAIT_916 = 16 / 9;
const RATIO_EPSILON = 0.01;
const isPortrait916 = (canvas) => Math.abs(canvas.h / canvas.w - PORTRAIT_916) < RATIO_EPSILON;

/**
 * The rectangle a shot composes in: on 9:16 a viral look (pop) keeps inside the platform safe zone ctx.viralInsets
 * (template/formats.mjs safeInsets with VIRAL_SAFE_ZONE, passed in by the caller); every other case uses the canvas.
 * { left, top, w, h, cx, cy, safe } where `safe` says the rectangle is the safe zone.
 */
export function compositionRect(ctx) {
  const { canvas, look, viralInsets } = ctx;
  if (!viralInsets || !look.modes.includes('viral') || !isPortrait916(canvas)) {
    return { left: 0, top: 0, w: canvas.w, h: canvas.h, cx: canvas.w / HALF, cy: canvas.h / HALF, safe: false };
  }
  const w = canvas.w - viralInsets.left - viralInsets.right, h = canvas.h - viralInsets.top - viralInsets.bottom;
  return { left: viralInsets.left, top: viralInsets.top, w, h, cx: viralInsets.left + w / HALF, cy: viralInsets.top + h / HALF, safe: true };
}

/** A shot that arrives on a match cut keeps its hero on screen from the first frame: no entrance. */
export const arrivesMatched = (shot, ctx) => ctx.timing.index > 0 && shot.cut === 'match';

const EASE_SAMPLES = 100;
/** The highest value an ease reaches between 0 and 1 (1 for one that does not overshoot). */
export const easePeak = (name) => Math.max(1, ...Array.from({ length: EASE_SAMPLES + 1 }, (_, i) => ease(name)(i / EASE_SAMPLES)));

/** A shot the viewer sees whole from its first frames: the film's first shot, or one whose cut shows it alone from the
 *  start (a hard cut, or a punch once it is under way: cuts/index.mjs aloneFromFrame). */
export const opensWhole = (shot, ctx) => ctx.timing.index === 0 || aloneFromFrame(shot.cut) !== null;

/**
 * landing() for a hero's entrance, except that in a shot seen whole (opensWhole) an entrance that would start on the
 * shot's first frame starts from where it would be one frame in, so that frame already shows the hero (no shot opens
 * on the field alone), and no lower than `floor` (for a rising value: a clipping's picture is at least half there).
 * Elsewhere it is landing() exactly.
 */
export function openingLanding(shot, ctx, at, move, from, to, floor = -Infinity) {
  const start = Math.max(0, at - move.dur);
  if (start > 0 || at <= 0 || !opensWhole(shot, ctx)) return landing(at, move, from, to);
  const first = ease(move.ease)(Math.min(1, 1 / (ctx.fps * at)));
  return track([{ t: 0, v: Math.max(floor, from + (to - from) * first) }, { t: at, v: to, ease: move.ease }]);
}

/** On-screen text as a typesetter sets it: an apostrophe inside a word becomes the typographic one (can't -> can, U+2019, t). */
export const typeset = (text) => text.replace(APOSTROPHE_RE, '$1\u2019');

/** Typeset text in the case the look sets `role` in (look.caps.display or look.caps.label). */
export const setCase = (look, role, text) => (look.caps[role] ? typeset(text).toUpperCase() : typeset(text));

/** The region name a target names (`region:<name>`), or null. */
export const regionOf = (target) => (typeof target === 'string' && target.startsWith(REGION_PREFIX) ? target.slice(REGION_PREFIX.length) : null);

/** The look lays shots out flush left on grid columns (editorial) rather than on the composition centre (centred). */
export const isEditorial = (look) => look.composition === 'editorial';

/** A locked camera (pop) cuts to a region close-up where a moving one (desk) pushes in. */
export const cutsToCloseUp = (look) => look.camera.style === 'locked';

/** Throws, naming the kind, the device and the look, when `look` does not style a device the kind needs. */
export function requireDevice(look, name, kind) {
  if (!registries.devices.get(name).supports(look)) {
    throw new Error(`${kind}: look "${look.name}" does not style device "${name}", which this kind needs; add a devices.${name} entry to the look`);
  }
}

/** Problems with a shot's `hero` (as validator errors relative to the shot): ids the kinds reserve are refused. */
export function heroProblems(shot) {
  if (!RESERVED_IDS.includes(shot.hero)) return [];
  return [{ path: 'hero', message: `${JSON.stringify(shot.hero)} is reserved for the film's own nodes; choose another hero id` }];
}

/** The words of a text as layoutText splits them (a `|` forces a break and is not a word). */
export function wordsOf(text) {
  return text.split(/\s+/).filter((raw) => raw !== '' && raw !== FORCE_MARK).map((raw) => (raw.endsWith(FORCE_MARK) ? raw.slice(0, -FORCE_MARK.length) : raw));
}

/**
 * fitText with the look's display tracking, which depends on the size: fit with the tracking of the largest size,
 * then, when the size found tracks differently, fit again with that tracking at or below it.
 */
export function fitDisplay(opts, { min, max, maxHeight, maxLines, tradeFloor }, look, unit) {
  const fit = (tracking, top) => fitText({ ...opts, font: { ...opts.font, tracking } }, { min, max: top, maxHeight, maxLines, tradeFloor });
  const first = look.tracking(max / unit, 'display');
  const layout = fit(first, max);
  const settled = look.tracking(layout.size / unit, 'display');
  if (settled === first) return { layout, font: { ...opts.font, size: layout.size, tracking: first } };
  const again = fit(settled, layout.size);
  return { layout: again, font: { ...opts.font, size: again.size, tracking: settled } };
}

/** A box from the cap line to just under the baseline, for type of `size` starting at x on `baseline`. */
export const capBox = (x, baseline, width, size) => [x, baseline - CAP_HEIGHT * size, width, (CAP_HEIGHT + WORD_DESCENT) * size];

/** The canvas box of a laid-out text at (x, y): each line from its cap line to just under its baseline. */
export function inkBox(x, y, layout) {
  return unionBox(layout.lines.map((l) => capBox(x + l.x, y + l.y, l.width, layout.size)));
}

// Where glyphs reach when the measure reports no ink (the fake measure of the Node tests), as shares of the size.
const ASCENDER = 0.76;
const DESCENDER = 0.22;
const ASCENDER_RE = /[bdfhklt]/;
const DESCENDER_GLYPH_RE = /[gjpqyQ,;()[\]{}|@Ç]/;

/**
 * Where the glyphs of `text` really reach in `font`, in px from the origin on the baseline: `up` and `down` from the
 * baseline, `left` where the ink starts (positive when it starts right of the origin) and `right` where it ends, the
 * font's tracking included. Measured when the measure reports ink (the page's canvas does), else estimated: from the cap
 * line (an ascender's height over b d f h k l t) to the baseline (a descender's depth under a descending glyph), and
 * the advance width edge to edge.
 */
export function inkExtent(text, font, measure) {
  const m = measure(text, font);
  const trackingPx = (font.tracking ?? 0) * font.size;
  const glyphs = [...text].length;
  if ([m.inkAscent, m.inkDescent, m.inkLeft, m.inkRight].every(Number.isFinite)) {
    return { up: m.inkAscent, down: m.inkDescent, left: m.inkLeft, right: m.inkRight + trackingPx * Math.max(0, glyphs - 1) };
  }
  return {
    up: (ASCENDER_RE.test(text) ? ASCENDER : CAP_HEIGHT) * font.size,
    down: DESCENDER_GLYPH_RE.test(text) ? DESCENDER * font.size : 0,
    left: 0,
    right: m.width + trackingPx * glyphs,
  };
}

/** The ink of words `first`..`last` (word indexes) of a laid-out line, in the line's own space: { up, down, left, right }. */
export function runInk(line, font, measure, first = line.words[0].index, last = line.words.at(-1).index) {
  const words = line.words.filter((w) => w.index >= first && w.index <= last);
  const inks = words.map((w) => ({ w, ink: inkExtent(w.text, font, measure) }));
  return {
    up: Math.max(...inks.map(({ ink }) => ink.up)),
    down: Math.max(...inks.map(({ ink }) => ink.down)),
    left: line.x + inks[0].w.x + inks[0].ink.left,
    right: line.x + inks.at(-1).w.x + inks.at(-1).ink.right,
  };
}

/** The ink block of a layout in its own space: first cap line to last baseline. */
export function inkSpan(layout) {
  return { top: layout.lines[0].y - CAP_HEIGHT * layout.size, bottom: layout.lines.at(-1).y };
}

// ---- the field ----

/**
 * The look's field as the shot's first node: depth 1, 6% past every edge, seeded by the film seed alone. Every shot
 * of a film has the same field (id FIELD_ID, the same props, so the same plan): one surface per film, and the cuts
 * happen over a continuous desk or halftone (a slide leaves it in place; a match keeps it).
 */
export function fieldNode(shot, ctx) {
  const { canvas, look, unit } = ctx;
  const w = Math.round(canvas.w * (1 + HALF * FIELD_BLEED));
  const h = Math.round(canvas.h * (1 + HALF * FIELD_BLEED));
  return node('field', FIELD_ID, {
    x: (canvas.w - w) / HALF, y: (canvas.h - h) / HALF, w, h, unit,
    field: look.field.field, params: look.field.params, palette: look.palette,
    seed: ctx.seed,
    // a locked look (pop) keeps its surface still under camera punches; a drifting one (desk) moves with the camera
    ...(look.camera.style === 'locked' ? { fixed: true } : {}),
  }, { depth: 1 });
}

// ---- timing ----

/** Stepped visibility: hidden, shown on the exact frame of `at`, hidden again from `until` (never, when undefined). */
export function shownFrom(at, until) {
  const keys = at === 0 ? [{ t: 0, v: 1 }] : [{ t: 0, v: 0 }, { t: at, v: 0 }, { t: at, v: 1 }];
  if (until !== undefined) keys.push({ t: until, v: 1 }, { t: until, v: 0 });
  return track(keys);
}

// ---- entrances ----

/** The look's enter move as word tracks landing on `at`: a fade, plus the rise (desk) or the pop scale (pop). */
export function enterTracks(look, unit, at, rest = { y: 0 }) {
  const move = look.moves.enter;
  const tracks = { opacity: landing(at, move, 0, 1) };
  if (move.dist) tracks.y = landing(at, move, rest.y + move.dist * unit, rest.y);
  if (move.scale !== undefined) tracks.scale = landing(at, move, move.scale, 1);
  return tracks;
}

/** A scale track: the enter pop landing on `start + enter.dur` (when `enter`), then the emphasize pulse from `pulse` up to `peak` (default: the look's value). `enterFrom` replaces the pop's start scale. */
export function pulseScale(look, { enterAt, enterFrom, pulse, peak }) {
  const { enter, emphasize } = look.moves;
  const keys = enterAt === undefined ? [{ t: 0, v: 1 }] : [{ t: Math.max(0, enterAt - enter.dur), v: enterFrom ?? enter.scale ?? 1 }, { t: enterAt, v: 1, ease: enter.ease }];
  const from = Math.max(pulse, keys.at(-1).t);
  keys.push({ t: from, v: 1 }, { t: from + emphasize.dur, v: peak ?? emphasize.scale, ease: emphasize.ease }, { t: from + HALF * emphasize.dur, v: 1, ease: 'inOutQuad' });
  return track(keys);
}

// A ghost word (one not yet spoken, in a mode that reads from frame 0) is an opaque colour: the look's ink mixed
// GHOST_SHARE into its paper. Quiet, but readable at phone size (where ink2 sits too close to ink to show the
// progression), and solid: the field never shows through its letters, as it would through ink at an alpha.
const GHOST_SHARE = 0.4;
const LIGHT_EASE = 'outCubic';
const HEX_RADIX = 16;
const CHANNEL_DIGITS = 2;

// `a` mixed `share` into `b` (both #rrggbb), channel by channel.
function mixColour(a, b, share) {
  const channel = (hex, i) => parseInt(hex.slice(1 + CHANNEL_DIGITS * i, 1 + CHANNEL_DIGITS * (i + 1)), HEX_RADIX);
  const mixed = [0, 1, 2].map((i) => Math.round(channel(b, i) + (channel(a, i) - channel(b, i)) * share));
  return `#${mixed.map((c) => c.toString(HEX_RADIX).padStart(CHANNEL_DIGITS, '0')).join('')}`;
}

const ghostInks = new WeakMap(); // palette -> its ghost colour
/** A palette's ghost colour (#rrggbb): its ink mixed GHOST_SHARE into its paper, computed once per palette. */
export function ghostInk(palette) {
  if (!ghostInks.has(palette)) ghostInks.set(palette, mixColour(palette.ink, palette.paper, GHOST_SHARE));
  return ghostInks.get(palette);
}

/** A ghost word's tracks: opaque, in the ghost colour from frame 0, turning to `lit` (ink or the accent) over the look's
 *  emphasize move from `at`, when it is spoken. */
export function ghostTracks(look, at, lit) {
  const { dur } = look.moves.emphasize;
  const ghost = ghostInk(look.palette);
  return { fill: track([{ t: 0, v: ghost }, { t: at, v: ghost }, { t: at + dur, v: lit, ease: LIGHT_EASE }]) };
}

/** A 0..1 wipe for a hairline: the look's draw move landing on `at`. */
export const wipeIn = (look, at) => ({ reveal: landing(at, look.moves.draw, 0, 1) });

/** A filled rectangle path at the origin: a hairline or a rule. */
export const rectPath = (w, h) => `M0 0H${w}V${h}H0Z`;

// ---- camera ----

const drifts = (look) => look.camera.style === 'desk' && look.camera.drift > 0;

/** How far the look's resting camera drift moves a depth-0 node either way across, in px (0 where nothing drifts). */
export const driftReach = (look, unit) => (drifts(look) ? (look.camera.drift * unit) / HALF : 0);

/** The look's resting camera as layers of keys: desk drifts half a drift either way, alternating by shot. */
export function defaultCamera(look, timing, unit) {
  if (!drifts(look)) return [];
  const half = (look.camera.drift * unit) / HALF;
  const dir = timing.index % HALF === 0 ? 1 : -1;
  return [[{ t: 0, x: -half * dir }, { t: timing.duration, x: half * dir }]];
}

// The drift's camera x at shot time t (linear, as defaultCamera keys it).
function driftAt(look, timing, unit, t) {
  if (!drifts(look)) return 0;
  const half = (look.camera.drift * unit) / HALF;
  const dir = timing.index % HALF === 0 ? 1 : -1;
  return -half * dir + (HALF * half * dir * t) / timing.duration;
}

// The largest pan at full push that keeps the depth-1 field over the canvas. At push progress f (0 to the ease's
// overshoot F) the field pans f * pan / 2 and zooms 1 + (zoom - 1) f / 2 about the centre, and it reaches
// FIELD_BLEED past each edge: |pan| <= (2 bleed - drift) / F + (zoom - 1)(centre + bleed) - drift keeps it covered.
function panLimit(size, zoom, drift) {
  const centre = size / HALF;
  const bleed = FIELD_BLEED * size;
  return (HALF * bleed - drift) / PUSH_OVERSHOOT + (zoom - 1) * (centre + bleed) - drift;
}

const clampAbs = (v, limit) => Math.min(limit, Math.max(-limit, v));
const clampTo = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * A camera layer for a deliberate close-up on `box` (canvas pixels): the zoom that makes the box PUSH.share of the
 * composition width (clamped to PUSH.min..PUSH.max), panned so the box centre sits on the composition centre (as far
 * as the field allows), easing with the look's enter ease over PUSH.dur and landing on `at`. A node at depth 0 moves
 * to c + (x - c) zoom - pan, so pan = c + (boxCentre - c) zoom - target; the drift's own pan at the landing time is
 * taken off, since the camera adds the layers.
 */
export function pushLayer(ctx, box, at) {
  const { look, canvas, unit, timing } = ctx;
  const rect = compositionRect(ctx);
  const zoom = clampTo((PUSH.share * rect.w) / box[2], PUSH.min, PUSH.max);
  const drift = (look.camera.drift * unit) / HALF;
  const pan = (centre, boxCentre, target) => centre + (boxCentre - centre) * zoom - target;
  const x = pan(canvas.w / HALF, box[0] + box[2] / HALF, rect.cx) - driftAt(look, timing, unit, at);
  const y = pan(canvas.h / HALF, box[1] + box[3] / HALF, rect.cy);
  return [
    { t: Math.max(0, at - PUSH.dur), x: 0, y: 0, zoom: 1 },
    { t: at, x: clampAbs(x, panLimit(canvas.w, zoom, drift)), y: clampAbs(y, panLimit(canvas.h, zoom, drift)), zoom, ease: look.moves.enter.ease },
  ];
}

// ---- an establishing view ----

const ESTABLISH = 0.6; // seconds of the whole picture, after the incoming cut has ended, before a region is singled out

/** When the incoming cut of a shot ends, in shot seconds: 0 for the first shot and for a hard cut. */
export function cutEnd(shot, timing) {
  if (timing.index === 0) return 0;
  return Math.min(registries.cuts.get(shot.cut ?? 'cut').dur, timing.duration);
}

/**
 * The earliest shot second a region event may land on, so the whole picture is seen first: the push (or, in a locked
 * look, the close-up switch) may not start before the incoming cut has ended plus ESTABLISH. A push starts PUSH.dur
 * before it lands; a close-up switch starts where it lands.
 */
export function regionFloor(shot, { look, timing }) {
  const quiet = cutEnd(shot, timing) + ESTABLISH;
  return cutsToCloseUp(look) ? quiet : quiet + PUSH.dur;
}

/** `shot` with every event aimed at a region moved to no earlier than regionFloor (its anchor replaced by seconds). */
export function withEstablishingView(shot, ctx) {
  if (!Array.isArray(shot.on)) return shot;
  const floor = regionFloor(shot, ctx);
  const on = shot.on.map((item) => (regionOf(item.target) !== null && ctx.at(item.at) < floor ? { ...item, at: Math.min(floor, ctx.timing.duration) } : item));
  return { ...shot, on };
}

// ---- devices from `on` ----

// Params a device needs beyond the base ones, worked out from the target box; null when `on` cannot place it.
function extrasFor(name, box, ctx) {
  if (name === 'arrow') {
    const reach = ARROW_REACH * ctx.unit;
    const x = box[0] - reach < 0 ? box[0] + box[2] + reach : box[0] - reach;
    const y = box[1] + box[3] + reach > ctx.canvas.h ? box[1] - reach : box[1] + box[3] + reach;
    return { from: [x, y] };
  }
  if (name === 'tag' || name === 'cutout') return null;
  return {};
}

/**
 * Build each `on` event's device: { nodes, before, camera } per event, where `before` is the id of the node the
 * device must be drawn under (a highlight on a text target) or null to draw it on top. `behind` maps a target to the
 * text node it sits on; `defaultTarget` is used when an event names none; `skip(item)` leaves an event to the kind
 * (its id stays `<shot>.on<j>` by its place in `on`).
 */
export function onDevices(shot, ctx, { boxes, defaultTarget, behind = {}, skip = () => false }) {
  return (shot.on ?? []).flatMap((item, j) => {
    if (skip(item)) return [];
    const target = item.target ?? defaultTarget;
    const box = boxes[target];
    if (!box) throw new Error(`shot "${shot.id}": on[${j}] target "${target}" has no box (have: ${Object.keys(boxes).join(', ')})`);
    const built = buildDevice(shot, ctx, { item, j, box, at: ctx.at(item.at) });
    const under = item.do === 'highlight' ? behind[target] ?? null : null;
    return [{ nodes: built.nodes, before: under, camera: built.camera, target, at: ctx.at(item.at) }];
  });
}

/** One `on` event's device (event j of the shot, id `<shot>.on<j>`) built on `box`, landing on `at`. */
export function buildDevice(shot, ctx, { item, j, box, at }) {
  const extra = extrasFor(item.do, box, ctx);
  if (extra === null) throw new Error(`shot "${shot.id}": on[${j}]: device "${item.do}" needs more than a target and cannot be placed with "on"`);
  return registries.devices.get(item.do).build({
    id: `${shot.id}.on${j}`, box, at, look: ctx.look, unit: ctx.unit, seed: ctx.seed, measure: ctx.measure, ...extra,
  });
}

/** A copy of a top-level node with props.fixed: the camera leaves it where it stands (a slug or a caption pinned to the
 *  frame stays put while a picture is pushed in). */
export const pinned = (n) => node(n.type, n.id, { ...n.props, fixed: true }, { tracks: n.tracks, children: n.children, depth: n.depth, step: n.step, wordTracks: n.wordTracks });

/** A card's children with its paper (id `<card id>.paper`) marked props.textCard: a card that holds text (a slug, a
 *  caption card), which the frame review keeps other texts off. */
export const asTextCard = (cardId, children) => children.map((n) => (n.id === `${cardId}.paper`
  ? node(n.type, n.id, { ...n.props, textCard: true }, { tracks: n.tracks, children: n.children, depth: n.depth, step: n.step, wordTracks: n.wordTracks })
  : n));

/** `nodes` with each device's nodes inserted before its `before` node, or appended. */
export function placeDevices(nodes, devices) {
  const out = [...nodes];
  for (const device of devices) {
    const index = device.before === null ? -1 : out.findIndex((n) => n.id === device.before);
    if (index < 0) out.push(...device.nodes);
    else out.splice(index, 0, ...device.nodes);
  }
  return out;
}

/** The camera layers a shot's devices add (punch keys). */
export const deviceCamera = (devices) => devices.filter((d) => Array.isArray(d.camera) && d.camera.length > 0).map((d) => d.camera);

/** [x, y, w, h] of the union of boxes. */
export function unionBox(boxes) {
  const left = Math.min(...boxes.map((b) => b[0])), top = Math.min(...boxes.map((b) => b[1]));
  const right = Math.max(...boxes.map((b) => b[0] + b[2])), bottom = Math.max(...boxes.map((b) => b[1] + b[3]));
  return [left, top, right - left, bottom - top];
}

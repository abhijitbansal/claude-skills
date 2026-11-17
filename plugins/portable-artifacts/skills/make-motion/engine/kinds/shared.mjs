// Helpers shared by the designed shot kinds (statement, number, clipping): type sizes and fonts from the look, the
// field every shot draws first, composition and look checks, entrances and the devices a shot's `on` events place
// (the camera: camera.mjs; the desk highlighter: highlighter.mjs; the plain tag: plain-tag.mjs). Pure and DOM-free;
// layout runs on ctx.measure.
import { registries } from '../registry.mjs';
import '../modes/index.mjs';
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';
import { fitText } from '../text/layout.mjs';
import { landing, colourOf, polyline, scrimColour } from '../devices/shared.mjs';
import { ease } from '../time/ease.mjs';
import { aloneFromFrame } from '../cuts/index.mjs';
import { resolveCut } from '../cuts/resolve.mjs';
import { parseSay, SayError } from '../script/say.mjs';
import { wordTimes } from './words.mjs';

// Cap height as a share of the font size. Canvas reports only the font's ascent box, not the cap height, so the
// layouts below place cap lines with this ratio (Fraunces and Archivo both sit close to it).
export const CAP_HEIGHT = 0.7;
// What a word box reaches below the baseline, as a share of the font size.
export const WORD_DESCENT = 0.12;
export const HERO_SCHEMA = Object.freeze({ type: 'string', pattern: '^[a-z][a-z0-9-]*$' });
/** The schema pattern every author text carries: at least one character that is not white space ("  " is refused). */
export const NOT_BLANK = '\\S';

export const FIELD_ID = 'field';
/** Ids the kinds use for nodes of their own, which a shot's `hero` may not take. */
export const RESERVED_IDS = Object.freeze([FIELD_ID]);
/** The prefix of a target that names one of a clipping's regions. */
export const REGION_PREFIX = 'region:';
export const FIELD_BLEED = 0.06; // the field covers the canvas plus this share of it on every side
const ARROW_REACH = 160; // units: an `on` arrow starts this far below and left of its target
const ROUTE_GAP = 12; // units: an `on` route's arc starts this far under its target...
const ROUTE_BOW = 24; // ...and dips this far more at its middle
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
// Does the look serve a mode whose data says to compose inside the platform safe zone (mode.platformSafeZone)?
const servesPlatformMode = (look) => look.modes.some((name) => registries.modes.has(name) && registries.modes.get(name).platformSafeZone === true);

/**
 * The rectangle a shot composes in: on 9:16 a look serving a mode with `platformSafeZone` (pop, for viral) keeps inside
 * the platform safe zone ctx.viralInsets
 * (template/formats.mjs safeInsets with VIRAL_SAFE_ZONE, passed in by the caller); every other case uses the canvas.
 * { left, top, w, h, cx, cy, safe } where `safe` says the rectangle is the safe zone.
 */
export function compositionRect(ctx) {
  const { canvas, look, viralInsets } = ctx;
  if (!viralInsets || !servesPlatformMode(look) || !isPortrait916(canvas)) {
    return { left: 0, top: 0, w: canvas.w, h: canvas.h, cx: canvas.w / HALF, cy: canvas.h / HALF, safe: false };
  }
  // a look's band (look.band: shares of the height) sets the top and bottom inside the platform sides (look review 2:
  // the safe zone's own bottom left the lower half of a vertical frame empty)
  const top = look.band ? Math.max(viralInsets.top, look.band.top * canvas.h) : viralInsets.top;
  // ctx.captionRoom: what a captioned shot gives up for its captions (captions/index.mjs kindContext)
  const bottom = (look.band ? look.band.bottom * canvas.h : canvas.h - viralInsets.bottom) - (ctx.captionRoom ?? 0);
  const w = canvas.w - viralInsets.left - viralInsets.right, h = bottom - top;
  return { left: viralInsets.left, top, w, h, cx: viralInsets.left + w / HALF, cy: top + h / HALF, safe: true };
}

/** A shot that arrives on a match cut keeps its hero on screen from the first frame: no entrance. */
export const arrivesMatched = (shot, ctx) => ctx.timing.index > 0 && resolveCut(shot.cut).name === 'match';

const EASE_SAMPLES = 100;
/** The highest value an ease reaches between 0 and 1 (1 for one that does not overshoot). */
export const easePeak = (name) => Math.max(1, ...Array.from({ length: EASE_SAMPLES + 1 }, (_, i) => ease(name)(i / EASE_SAMPLES)));

/** A shot the viewer sees whole from its first frames: the film's first shot, or one whose cut shows it alone from the
 *  start (a hard cut, or a punch once it is under way: cuts/index.mjs aloneFromFrame). */
export const opensWhole = (shot, ctx) => ctx.timing.index === 0 || aloneFromFrame(resolveCut(shot.cut)) !== null;

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

const CHANNEL_MAX = 255;
// `a` multiplied into `b` (both #rrggbb), channel by channel: what a 'multiply' blend of `a` shows on `b`.
function multiplyColour(a, b) {
  const channel = (hex, i) => parseInt(hex.slice(1 + CHANNEL_DIGITS * i, 1 + CHANNEL_DIGITS * (i + 1)), HEX_RADIX);
  const out = [0, 1, 2].map((i) => Math.round((channel(a, i) * channel(b, i)) / CHANNEL_MAX));
  return `#${out.map((c) => c.toString(HEX_RADIX).padStart(CHANNEL_DIGITS, '0')).join('')}`;
}

/**
 * The accent as the look's highlighter shows it on the paper (#rrggbb): multiplied into the paper when the highlighter
 * blends 'multiply' (desk), the accent itself otherwise. A chart's highlighted mark and a region's frame use it, so the
 * film shows one yellow.
 */
export function markerAccent(look) {
  const accent = colourOf(look, 'accent');
  return look.devices?.highlight?.blend === 'multiply' ? multiplyColour(accent, colourOf(look, 'paper')) : accent;
}

/**
 * The top of the caption band, in px, for a composition the captions would otherwise cover; Infinity with captions off
 * or where the captions already keep out of the composition (a platform-safe composition gives the band up in kindContext).
 */
export function captionTop(ctx) {
  if (ctx.captions === false || compositionRect(ctx).safe) return Infinity; // captions off: the band is the composition's
  return registries.captions.get(ctx.look.captions).zone(ctx)[1];
}

const ghostInks = new WeakMap(); // palette -> its ghost colour
/** A palette's ghost colour (#rrggbb): its ink mixed GHOST_SHARE into its paper, computed once per palette. */
export function ghostInk(palette) {
  if (!ghostInks.has(palette)) ghostInks.set(palette, mixColour(palette.ink, palette.paper, GHOST_SHARE));
  return ghostInks.get(palette);
}

/** A ghost word's tracks: opaque, in the ghost colour from frame 0, turning to `lit` (ink or the accent) over the look's
 *  emphasize move from `at`, when it is spoken. `ghost` (never drawn) is 1 until the word is lit and 0 from then on: it
 *  marks the word unspoken for the contrast rule (engine/review/contrast.mjs), which never reads the colour for that. */
export function ghostTracks(look, at, lit) {
  const { dur } = look.moves.emphasize;
  const ghost = ghostInk(look.palette);
  return {
    fill: track([{ t: 0, v: ghost }, { t: at, v: ghost }, { t: at + dur, v: lit, ease: LIGHT_EASE }]),
    ghost: track([{ t: 0, v: 1 }, { t: at + dur, v: 1 }, { t: at + dur, v: 0 }]),
  };
}

/** A 0..1 wipe for a hairline: the look's draw move landing on `at`. */
export const wipeIn = (look, at) => ({ reveal: landing(at, look.moves.draw, 0, 1) });

/** A filled rectangle path at the origin: a hairline or a rule. */
export const rectPath = (w, h) => `M0 0H${w}V${h}H0Z`;

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
  // focus: the scrim covers the whole frame with the target left clear
  if (name === 'focus') return { cover: [0, 0, ctx.canvas.w, ctx.canvas.h] };
  // route: an arc drawn under the target, from its left edge to its right, as a pointing stroke
  if (name === 'route') {
    const base = box[1] + box[3] + ROUTE_GAP * ctx.unit;
    return { points: [[box[0], base], [box[0] + box[2] / HALF, base + ROUTE_BOW * ctx.unit], [box[0] + box[2], base]] };
  }
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

// ---- used by several kinds: the spoken words, boxes, picture sizing, numerals, step ratios, the paper scrim ----

const ASK_LAG = 0.4; // seconds after the title's last word, for an ask that is not spoken
const ASK_HOLD = 0.6; // seconds an unspoken ask is on screen, at least, before the shot ends
const THOUSANDS = /\B(?=(\d{3})+(?!\d))/g;
const STEP_EPSILON = 1e-6;
export const SCRIM = 0.8; // the clipping's paper scrim over a picture's surroundings
const SCRIM_EASE = 'outCubic';

// Emphasis markers: a run of `*` at the start or the end of a word ("*print*.", "*two words*"). A star with space on
// both sides ("5 * 3") is not a marker. The emphasis itself comes from the say (the timeline's words), never from here.
const MARK_OPEN_RE = /(^|\s)\*+(?=\S)/g;
const MARK_CLOSE_RE = /(?<=\S)\*+(?=\s|$|[.,;:!?)"'’”])/g;
const UNMARKED_KEEP = new Set(['say', 'code', 'id', 'show', 'src', 'lang']);
const stripMarks = (s) => s.replace(MARK_OPEN_RE, '$1').replace(MARK_CLOSE_RE, '');

/**
 * The shot as its kind draws it: every on-screen string (at any depth) without emphasis markers, so a `*word*` in a
 * text, title, caption, item or label is never drawn with its stars. The say keeps them (the timeline reads emphasis
 * from it), and code, ids, sources and the language keep every character.
 */
export function unmarked(value, key = '') {
  if (UNMARKED_KEEP.has(key)) return value;
  if (typeof value === 'string') return stripMarks(value);
  if (Array.isArray(value)) return value.map((v) => unmarked(v, key));
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, unmarked(v, k)]));
  return value;
}

/** A say's plain words; a say that does not parse (it has its own validation error) gives none. */
export function plainSay(say) {
  if (typeof say !== 'string') return '';
  try {
    return parseSay(say).plain;
  } catch (err) {
    if (err instanceof SayError) return '';
    throw err;
  }
}

/**
 * When a title's words and its ask land, in shot seconds: { title: [{ at, spoken }], ask } (end, quote). An ask whose
 * words are spoken lands on the first of them; otherwise ASK_LAG after the title's last word, ASK_HOLD before the shot
 * ends at the latest (never before that last word). With no narration the title's first word lands at 0.
 */
export function endTimes(shot, timing) {
  const title = wordsOf(shot.title ?? plainSay(shot.say));
  const ask = shot.ask === undefined ? [] : wordsOf(shot.ask);
  const times = wordTimes([...title, ...ask], timing);
  const titleTimes = times.slice(0, title.length);
  if (ask.length === 0) return { title: titleTimes, ask: null };
  const spoken = times.slice(title.length).find((t) => t.spoken !== null);
  if (spoken) return { title: titleTimes, ask: spoken.at };
  const last = titleTimes.at(-1)?.at ?? 0;
  return { title: titleTimes, ask: Math.max(last, Math.min(last + ASK_LAG, timing.duration - ASK_HOLD)) };
}

/** Do two [x, y, w, h] boxes overlap? */
export const overlaps = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];

/** A laid-out text's word boxes at (x, y), cap line to descent, in word order. */
export const wordBoxes = (layout, x, y) => layout.lines.flatMap((line) => line.words.map((w) => ({ index: w.index, box: capBox(x + line.x + w.x, y + line.y, w.width, layout.size) })))
  .sort((a, b) => a.index - b.index).map((w) => w.box);

/** A picture scaled so its longest side is `longest` px, its aspect kept: { w, h }. */
export function fitLongestSide(picture, longest) {
  const scale = longest / Math.max(picture.width, picture.height);
  return { w: picture.width * scale, h: picture.height * scale };
}

/** A picture scaled to fit inside `w` x `h` px, its aspect kept: { w, h }. */
export function fitInBox(picture, w, h) {
  const scale = Math.min(w / picture.width, h / picture.height);
  return { w: picture.width * scale, h: picture.height * scale };
}

/** A value as shown: fixed decimals, thousands grouped with commas, a leading minus for a negative value. */
export function formatValue(value, decimals) {
  const [whole, fraction] = Math.abs(value).toFixed(decimals).split('.');
  const sign = value < 0 && Number(Math.abs(value).toFixed(decimals)) !== 0 ? '-' : '';
  return `${sign}${whole.replace(THOUSANDS, ',')}${fraction === undefined ? '' : `.${fraction}`}`;
}

/** Does the shot set its words as ghosts lit as spoken (a mode that reads from frame 0, a look without the highlighter)? */
export const ghostWords = (ctx) => ctx.mode.hookFromFrameZero === true && ctx.look.emphasis !== 'highlight';

/**
 * The scale steps of `steps` at which every limit holds: a text at that step stays `ratio` times under `size` for each
 * { size, ratio } (the review's hero rule, and any second ratio a kind keeps).
 */
export const stepsUnder = (look, steps, unit, limits) => steps.filter((step) => limits.every(({ size, ratio }) => ratio * sizeAt(look, step, unit) <= size + STEP_EPSILON));

/** The largest step of `steps` at which every limit holds (stepsUnder), else the smallest. */
export function stepUnder(look, steps, unit, limits) {
  const fits = stepsUnder(look, steps, unit, limits);
  return fits.length > 0 ? Math.max(...fits) : Math.min(...steps);
}

// A scrim's path: every covered outline (clockwise, as the devices draw them) and the hole, when there is one,
// counter-clockwise after them. Under the nonzero fill rule the draw layer uses, a pixel inside any outline is filled
// once, however many overlap there (tape over the paper is not scrimmed twice), and the hole inside the paper stays clear.
function scrimPath(outlines, hole) {
  const outer = outlines.map((points) => polyline(points, true)).join('');
  if (hole === undefined) return outer;
  const [x, y, w, h] = hole;
  return `${outer}${polyline([[x, y], [x, y + h], [x + w, y + h], [x + w, y]], true)}`;
}

/**
 * A scrim of the look's paper over `cover` (clockwise outlines), with `hole` ([x, y, w, h]) left clear when given, rising
 * from clear to `opacity` (default SCRIM, the clipping's own) over the `dur` seconds before `at` (clipping, compare).
 * @param {{ id: string, cover: number[][][], hole?: number[], at: number, dur: number, opacity?: number, ease?: string, look: object }} p
 */
export function paperScrim({ id, cover, hole, at, dur, opacity = SCRIM, from = 0, ease = SCRIM_EASE, look }) {
  return node('path', id, { d: scrimPath(cover, hole), fill: scrimColour(look) }, {
    tracks: { opacity: landing(at, { ease, dur }, from, opacity) },
  });
}

/** The tag device's plate box at (left, top), [x, y, w, h] in canvas pixels (end, list). */
export const tagBox = (ctx, id, text, left, top) => registries.devices.get('tag').build({
  id, text, box: [left, top, 1, 1], at: 0, look: ctx.look, unit: ctx.unit, seed: ctx.seed, measure: ctx.measure,
}).boxes.tag;

const NOT_TEXT = new Set(['say', 'id', 'show', 'cut', 'hero', 'on']); // fields that are not author text set on screen

/**
 * Throws a RangeError naming the first blank text field of `shot` (its path inside the shot, as the validator writes
 * it): the validator refuses blank text, and a kind's expand never reaches its layout with one (an empty layout has no
 * lines to read).
 */
export function assertNoBlanks(shot, kind) {
  const walk = (value, at) => {
    if (typeof value === 'string') {
      if (!/\S/.test(value)) throw new RangeError(`${kind} shot "${shot.id}": ${at} is blank; write the text, or leave the field out`);
      return;
    }
    if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${at}[${i}]`));
    else if (value !== null && typeof value === 'object') Object.entries(value).forEach(([k, v]) => walk(v, at ? `${at}.${k}` : k));
  };
  Object.entries(shot).filter(([k]) => !NOT_TEXT.has(k)).forEach(([k, v]) => walk(v, k));
}

/**
 * One line of text with every digit centred in a cell as wide as the widest digit and every other character at its own
 * width (number.mjs sets its count the same way): the layout shape layoutText gives, one word per character.
 */
export function numeralLayout(text, font, measure) {
  // never tighter than the face: a display face tracked in (pop) would push one digit's ink into the next
  const tracking = Math.max(0, font.tracking ?? 0) * font.size;
  const advance = Math.max(...'0123456789'.split('').map((d) => measure(d, font).width)) + tracking;
  let x = 0;
  const words = [...text].map((ch, index) => {
    const glyph = measure(ch, font).width;
    const cell = /\d/.test(ch) ? advance : glyph + tracking;
    const word = { text: ch, index, x: x + (cell - glyph) / 2, width: glyph };
    x += cell;
    return word;
  });
  const { ascent, descent } = measure('0', font);
  return { size: font.size, width: x, height: ascent + descent, lines: [{ x: 0, y: ascent, width: x, words }], overflow: false };
}

const WINDOW_EPSILON = 1e-6;

/**
 * Creative findings for each `on` entry aimed at a part that is off screen when it fires: `windowOf(target)` gives the
 * part's [from, to) in shot seconds (to may be Infinity, the shot's end) or null for a target that is always shown. The
 * finding is at on[j].at and names that span; entries whose anchor does not resolve have their own validation error.
 */
export function hiddenOnFindings(shot, { timing, at }, windowOf) {
  if (!Array.isArray(shot.on) || typeof at !== 'function') return [];
  return shot.on.flatMap((entry, j) => {
    const window = windowOf(entry.target);
    if (window === null) return [];
    let t;
    try { t = at(entry.at); } catch { return []; }
    if (!isHidden(t, window)) return [];
    const to = window[1] === Infinity ? timing.duration : window[1];
    return [{ path: `on[${j}].at`, at: t, message: `the ${entry.do} on ${entry.target} fires at ${t.toFixed(2)} s, but ${entry.target} is on screen only from ${window[0].toFixed(2)} s to ${to.toFixed(2)} s; move it into that window` }];
  });
}

/** Is a moment outside a part's [from, to) on-screen window? */
export const isHidden = (t, [from, to]) => t < from - WINDOW_EPSILON || t >= to - WINDOW_EPSILON;

/** The card device's card at `box`, entering at `at` (end, quote, compare): its one node, a group of paper and tape. */
export const cardOf = (ctx, id, box, at) => registries.devices.get('card').build({ id, box, at, look: ctx.look, unit: ctx.unit, seed: ctx.seed }).nodes[0];

/**
 * A card as a group carrying `id`: the card's paper and tape marked as a text card for the review (asTextCard), then
 * `children` in the card's centred space; `props` adds to the card's own (a turn, a pin to the frame).
 */
export const cardGroup = (card, id, children, props = {}) => node('group', id, { ...card.props, ...props }, { tracks: card.tracks, children: [...asTextCard(id, card.children), ...children] });

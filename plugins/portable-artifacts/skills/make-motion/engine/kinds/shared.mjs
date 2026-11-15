// Helpers shared by the designed shot kinds (statement, number, clipping): type sizes and fonts from the look, the
// field every shot draws first, word timing against the narration, entrances, the default camera, the camera push,
// and the devices a shot's `on` events place. Pure and DOM-free; layout runs on ctx.measure.
import { registries } from '../registry.mjs';
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';
import { fitText } from '../text/layout.mjs';
import { landing } from '../devices/shared.mjs';

// Cap height as a share of the font size. Canvas reports only the font's ascent box, not the cap height, so the
// layouts below place cap lines with this ratio (Fraunces and Archivo both sit close to it).
export const CAP_HEIGHT = 0.7;
// What a word box reaches below the baseline, as a share of the font size.
export const WORD_DESCENT = 0.12;
export const HERO_SCHEMA = Object.freeze({ type: 'string', pattern: '^[a-z][a-z0-9-]*$' });

export const FIELD_ID = 'field';
const FIELD_BLEED = 0.06; // the field covers the canvas plus this share of it on every side
const FIELD_SEED_STRIDE = 1000; // field seed = film seed * stride + shot index
const NO_SAY_START = 0.2; // seconds: with no narration the first word lands here...
const NO_SAY_STAGGER = 0.09; // ...and each next word this much later
const PUSH_ZOOM = 1.25;
const PUSH_DUR = 0.8; // seconds
const PUSH_OVERSHOOT = 1.2; // a spring ease can carry the push this far past its target; the pan limit allows for it
const ARROW_REACH = 160; // units: an `on` arrow starts this far below and left of its target
const NON_WORD_RE = /[^\p{L}\p{N}]/gu;
const FORCE_MARK = '|';
const APOSTROPHE_RE = /(\p{L})'(?=\p{L})/gu;
const HALF = 2;

// ---- look data ----

/** The pixel size of 1-based type scale step `step` (1 = the smallest of the look's five sizes). */
export const sizeAt = (look, step, unit) => look.scale[step - 1] * unit;

/** A layout font for `role` at `size` px: the look's face, its tracking for that size and its line height. */
export function fontFor(look, role, size, unit) {
  const { family, weight, width } = look.fonts[role];
  const lineHeight = role === 'display' ? look.lineHeight.display : look.lineHeight.text;
  return { family, weight, width, size, tracking: look.tracking(size / unit, role), lineHeight };
}

/** The id of a kind's main node: the shot's `hero` when given, else `<shot id>.<role>`. */
export const heroId = (shot, role) => shot.hero ?? `${shot.id}.${role}`;

/** A 16:9 canvas is wide; 9:16, 1:1 and 4:5 are not. */
export const isWide = (canvas) => canvas.w > canvas.h;

/** A shot that arrives on a match cut keeps its hero on screen from the first frame: no entrance. */
export const arrivesMatched = (shot, ctx) => ctx.timing.index > 0 && shot.cut === 'match';

/** On-screen text as a typesetter sets it: an apostrophe inside a word becomes the typographic one (can't -> can, U+2019, t). */
export const typeset = (text) => text.replace(APOSTROPHE_RE, '$1\u2019');

/** The words of a text as layoutText splits them (a `|` forces a break and is not a word). */
export function wordsOf(text) {
  return text.split(/\s+/).filter((raw) => raw !== '' && raw !== FORCE_MARK).map((raw) => (raw.endsWith(FORCE_MARK) ? raw.slice(0, -FORCE_MARK.length) : raw));
}

/**
 * fitText with the look's display tracking, which depends on the size: fit with the tracking of the largest size,
 * then, when the size found tracks differently, fit again with that tracking at or below it.
 */
export function fitDisplay(opts, { min, max, maxHeight, maxLines }, look, unit) {
  const fit = (tracking, top) => fitText({ ...opts, font: { ...opts.font, tracking } }, { min, max: top, maxHeight, maxLines });
  const first = look.tracking(max / unit, 'display');
  const layout = fit(first, max);
  const settled = look.tracking(layout.size / unit, 'display');
  if (settled === first) return { layout, font: { ...opts.font, size: layout.size, tracking: first } };
  const again = fit(settled, layout.size);
  return { layout: again, font: { ...opts.font, size: again.size, tracking: settled } };
}

/** The ink block of a layout in its own space: first cap line to last baseline. */
export function inkSpan(layout) {
  return { top: layout.lines[0].y - CAP_HEIGHT * layout.size, bottom: layout.lines.at(-1).y };
}

// ---- the field ----

/**
 * The look's field as the shot's first node: depth 1, 6% past every edge, seeded by the film seed and shot index.
 * Every shot's field has the id FIELD_ID, so a match cut carries the paper across (cross-fading one sheet into the
 * next) instead of dipping to the flat background.
 */
export function fieldNode(shot, ctx) {
  const { canvas, look, unit } = ctx;
  const w = Math.round(canvas.w * (1 + HALF * FIELD_BLEED));
  const h = Math.round(canvas.h * (1 + HALF * FIELD_BLEED));
  return node('field', FIELD_ID, {
    x: (canvas.w - w) / HALF, y: (canvas.h - h) / HALF, w, h, unit,
    field: look.field.field, params: look.field.params, palette: look.palette,
    seed: ctx.seed * FIELD_SEED_STRIDE + ctx.timing.index,
  }, { depth: 1 });
}

// ---- timing ----

const letters = (text) => text.replace(NON_WORD_RE, '').toLowerCase();

/**
 * When each on-screen word lands: on the start of the spoken word it matches (in order, by letters and digits); an
 * unmatched word lands with the nearest earlier matched word (the first spoken word when none is earlier). With no
 * narration words stagger NO_SAY_STAGGER apart from NO_SAY_START. Each entry is { at, spoken } with `spoken` the
 * index of the matched spoken word or null.
 */
export function wordTimes(texts, timing) {
  const spoken = timing.words;
  if (spoken.length === 0) return texts.map((_, i) => ({ at: Math.min(timing.duration, NO_SAY_START + NO_SAY_STAGGER * i), spoken: null }));
  let next = 0;
  let last = null;
  return texts.map((text) => {
    const want = letters(text);
    const j = want === '' ? -1 : spoken.findIndex((word, k) => k >= next && letters(word.text) === want);
    if (j < 0) return { at: spoken[last ?? 0].start, spoken: null };
    next = j + 1;
    last = j;
    return { at: spoken[j].start, spoken: j };
  });
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

/** A scale track: the enter pop landing on `start + enter.dur` (when `enter`), then the emphasize pulse from `pulse`. */
export function pulseScale(look, { enterAt, pulse }) {
  const { enter, emphasize } = look.moves;
  const keys = enterAt === undefined ? [{ t: 0, v: 1 }] : [{ t: Math.max(0, enterAt - enter.dur), v: enter.scale ?? 1 }, { t: enterAt, v: 1, ease: enter.ease }];
  const from = Math.max(pulse, keys.at(-1).t);
  keys.push({ t: from, v: 1 }, { t: from + emphasize.dur, v: emphasize.scale, ease: emphasize.ease }, { t: from + HALF * emphasize.dur, v: 1, ease: 'inOutQuad' });
  return track(keys);
}

/** A 0..1 wipe for a hairline: the look's draw move landing on `at`. */
export const wipeIn = (look, at) => ({ reveal: landing(at, look.moves.draw, 0, 1) });

/** A filled rectangle path at the origin: a hairline or a rule. */
export const rectPath = (w, h) => `M0 0H${w}V${h}H0Z`;

// ---- camera ----

/** The look's resting camera as layers of keys: desk drifts half a drift either way, alternating by shot. */
export function defaultCamera(look, timing, unit) {
  if (look.camera.style !== 'desk' || !(look.camera.drift > 0)) return [];
  const half = (look.camera.drift * unit) / HALF;
  const dir = timing.index % HALF === 0 ? 1 : -1;
  return [[{ t: 0, x: -half * dir }, { t: timing.duration, x: half * dir }]];
}

// The largest pan at full push that keeps the depth-1 field over the canvas: it pans half the camera and zooms
// 1 + (zoom - 1) / 2 about the centre, and reaches FIELD_BLEED past each edge. The drift's own pan is allowed for.
function panLimit(size, drift) {
  const fieldZoom = 1 + (PUSH_ZOOM - 1) / HALF;
  const centre = size / HALF;
  const bleed = FIELD_BLEED * size;
  return HALF * bleed / PUSH_OVERSHOOT + HALF * ((centre + bleed) * fieldZoom - centre - bleed) - drift;
}

const clampAbs = (v, limit) => Math.min(limit, Math.max(-limit, v));

/** A camera layer that pushes to PUSH_ZOOM centred on `box` (as far as the field allows), landing on `at`. */
export function pushLayer(look, canvas, unit, box, at) {
  const drift = (look.camera.drift * unit) / HALF;
  const dx = (box[0] + box[2] / HALF - canvas.w / HALF) * PUSH_ZOOM;
  const dy = (box[1] + box[3] / HALF - canvas.h / HALF) * PUSH_ZOOM;
  return [
    { t: Math.max(0, at - PUSH_DUR), x: 0, y: 0, zoom: 1 },
    { t: at, x: clampAbs(dx, panLimit(canvas.w, drift)), y: clampAbs(dy, panLimit(canvas.h, drift)), zoom: PUSH_ZOOM, ease: look.moves.enter.ease },
  ];
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
 * text node it sits on; `defaultTarget` is used when an event names none.
 */
export function onDevices(shot, ctx, { boxes, defaultTarget, behind = {} }) {
  return (shot.on ?? []).map((item, j) => {
    const target = item.target ?? defaultTarget;
    const box = boxes[target];
    if (!box) throw new Error(`shot "${shot.id}": on[${j}] target "${target}" has no box (have: ${Object.keys(boxes).join(', ')})`);
    const extra = extrasFor(item.do, box, ctx);
    if (extra === null) throw new Error(`shot "${shot.id}": on[${j}]: device "${item.do}" needs more than a target and cannot be placed with "on"`);
    const built = registries.devices.get(item.do).build({
      id: `${shot.id}.on${j}`, box, at: ctx.at(item.at), look: ctx.look, unit: ctx.unit, seed: ctx.seed, measure: ctx.measure, ...extra,
    });
    const under = item.do === 'highlight' ? behind[target] ?? null : null;
    return { nodes: built.nodes, before: under, camera: built.camera, target, at: ctx.at(item.at) };
  });
}

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

// Helpers shared by the v2 graphic devices: parameter checks, the seeded noise stream, colour and style lookup,
// the landing rule, the object entrance and the path string builders. Pure and DOM-free; imports nothing from
// engine/page. Every path a device writes uses only M, L, Q, C and Z, so its numbers are all x y pairs.
import { mulberry32 } from '../seeded.mjs';
import { track } from '../time/track.mjs';
import { node, isNode } from '../graph/node.mjs';

export const BASE_PARAMS = Object.freeze(['id', 'box', 'at', 'look', 'unit', 'seed', 'measure']);

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const SEED_STRIDE = 0x9e3779b9; // golden-ratio odd constant: spreads neighbouring seeds far apart
const FRAME_EPSILON = 1e-9; // keeps an exact frame boundary from flooring to the frame before (as sample() does)
const COORD_DECIMALS = 100; // paths are written to 0.01 px, so equal inputs give equal strings
const HEX_COLOUR = /^#[0-9a-f]{6}$/i;
const HALF = 2;
const ENTRY_OPACITY_FROM = 0;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

// ---- parameters ----

function checkBox(box) {
  const ok = Array.isArray(box) && box.length === 4 && box.every(isFiniteNumber) && box[2] > 0 && box[3] > 0;
  if (!ok) throw new Error(`box must be [x, y, w, h] with finite numbers and w, h > 0, got ${JSON.stringify(box)}`);
}

function checkLook(look) {
  const ok = isPlainObject(look) && isPlainObject(look.palette) && isPlainObject(look.moves) && isPlainObject(look.moves.draw);
  if (!ok) throw new Error(`look must be a Look from registries.looks, got ${isPlainObject(look) ? `"${look.name}"` : typeof look}`);
}

/** Validates the parameters every device takes plus the device's own `extra` names; returns the common fields. */
export function checkParams(device, params, extra = []) {
  if (!isPlainObject(params)) throw new Error(`device "${device}": params must be an object`);
  const accepted = [...BASE_PARAMS, ...extra];
  for (const name of Object.keys(params)) {
    if (!accepted.includes(name)) throw new Error(`unknown param "${name}" for device "${device}"; accepted: ${accepted.join(', ')}`);
  }
  const { id, box, at, look, unit, seed, measure } = params;
  if (typeof id !== 'string' || id === '') throw new Error(`device "${device}": id must be a non-empty string, got ${JSON.stringify(id)}`);
  checkBox(box);
  if (!isFiniteNumber(at) || at < 0) throw new Error(`device "${device}": at must be a shot-local second >= 0, got ${at}`);
  checkLook(look);
  if (!isFiniteNumber(unit) || unit <= 0) throw new Error(`device "${device}": unit must be a number > 0, got ${unit}`);
  if (!Number.isInteger(seed)) throw new Error(`device "${device}": seed must be an integer, got ${seed}`);
  if (measure !== undefined && typeof measure !== 'function') throw new Error(`device "${device}": measure must be a function`);
  return { id, box, at, look, unit, seed, measure };
}

// ---- look data ----

/** A hand look steps its marks (look.moves.draw.step); a look without a step is crisp. */
export const isHand = (look) => look.moves.draw.step !== undefined;

/**
 * The one supports rule: a device is supported when the look has a `devices` entry for it. Every device except
 * `punch` is `{ supports: styledBy(name) }`; `punch` adds its own condition on top.
 */
export const styledBy = (name) => (look) => Object.hasOwn(look.devices ?? {}, name);

/** The look's styling entry for a device, or an empty one for a look that does not style it. */
export const styleOf = (look, name) => look.devices?.[name] ?? {};

/** A palette key or #rrggbb as a #rrggbb colour. */
export function colourOf(look, key) {
  if (Object.hasOwn(look.palette, key)) return look.palette[key];
  if (typeof key === 'string' && HEX_COLOUR.test(key)) return key;
  throw new Error(`colour must be a palette key (${Object.keys(look.palette).join(', ')}) or #rrggbb, got ${JSON.stringify(key)}`);
}

/**
 * The colour a scrim (the dim laid over what recedes: a clipping's surroundings, compare's unspoken side) is made of:
 * the palette key or #rrggbb the look names in `devices.focus.scrim` (cosmos: its deep navy, a field-coloured scrim on
 * a dark field), else the look's paper (desk, pop: the paper scrim).
 */
export const scrimColour = (look) => colourOf(look, look.devices?.focus?.scrim ?? 'paper');

// ---- seeded noise ----

function hashString(text) {
  let h = FNV_OFFSET;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

/** One random stream per device and id: the same inputs always draw the same wobble. */
export const deviceRng = (seed, id, device) => mulberry32((hashString(`${device}:${id}`) ^ Math.imul(seed + 1, SEED_STRIDE)) >>> 0);

/** A number in [-amount, amount]. */
export const spread = (rng, amount) => (rng() * HALF - 1) * amount;

// ---- time ----

/**
 * A 0..1 style ramp that lands on `at`: it starts at max(0, at - move.dur) and ends at `at` with `to`. On a stepped
 * node the last frame at or before `at` already shows `to`, so a key at `at` follows it and the value holds.
 */
export function landing(at, move, from, to, step) {
  const start = Math.max(0, at - move.dur);
  const settle = step === undefined ? at : Math.max(start, Math.floor(at * step + FRAME_EPSILON) / step);
  const keys = [{ t: start, v: from }, { t: settle, v: to, ease: move.ease }];
  if (settle < at) keys.push({ t: at, v: to });
  return track(keys);
}

/**
 * The entrance of an object device (cutout, card, tag), as a group node at (cx, cy) holding `children` positioned
 * about the group's centre. It fades in with the look's enter move and, where the move has a travel or a start
 * scale (desk slides up, pop springs), moves or scales to rest; all of it ends at `at`.
 */
export function entrance({ id, at, look, unit, cx, cy, rotate = 0, children }) {
  const move = look.moves.enter;
  const tracks = { opacity: landing(at, move, ENTRY_OPACITY_FROM, 1) };
  if (move.dist) tracks.y = landing(at, move, cy + move.dist * unit, cy);
  if (move.scale !== undefined) tracks.scale = landing(at, move, move.scale, 1);
  const props = { x: cx, y: cy, ...(rotate === 0 ? {} : { rotate }) };
  return node('group', id, props, { tracks, children });
}

// ---- nodes ----

/** An image node's props checked for what a cutout needs: a src and a finite size. */
export function checkImage(image) {
  const ok = isNode(image) && image.type === 'image' && typeof image.props.src === 'string'
    && isFiniteNumber(image.props.w) && isFiniteNumber(image.props.h);
  if (!ok) throw new Error('image must be an image node built by node(), with props.src, props.w and props.h');
  return image;
}

// ---- path strings ----

/** A coordinate rounded to 0.01, never "-0". */
export const fmt = (v) => String(Math.round(v * COORD_DECIMALS) / COORD_DECIMALS + 0);
/** A point as "x y" for a path string. */
export const at2 = ([x, y]) => `${fmt(x)} ${fmt(y)}`;

/** M p0 L p1 L ... (closed with Z when `closed`). */
export function polyline(points, closed = false) {
  return `M${at2(points[0])}${points.slice(1).map((p) => `L${at2(p)}`).join('')}${closed ? 'Z' : ''}`;
}

/** The coordinate pairs of a path string the devices build (M, L, Q and C take only pairs), as [x, y] points: for a
 *  polyline or a rounded rectangle, a polygon through its corners. */
export function pathPoints(d) {
  const nums = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  return Array.from({ length: nums.length / HALF }, (_, i) => [nums[HALF * i], nums[HALF * i + 1]]);
}

/** An open Catmull-Rom spline through `points` as cubic Beziers: one smooth stroke. */
export function smoothPath(points) {
  const last = points.length - 1;
  const segments = points.slice(0, last).map((p1, i) => {
    const p0 = points[Math.max(i - 1, 0)], p2 = points[i + 1], p3 = points[Math.min(i + 2, last)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    return `C${at2(c1)} ${at2(c2)} ${at2(p2)}`;
  });
  return `M${at2(points[0])}${segments.join('')}`;
}

export const SOFT_RINGS = 8; // rings in a soft edge: steps of a seventh of the reach, too fine to see at glow sizes

/** The alpha of each of `rings` stacked layers so that where all of them overlap the result is `alpha` (source-over). */
export const ringAlpha = (alpha, rings = SOFT_RINGS) => 1 - (1 - alpha) ** (1 / rings);

/**
 * A soft-edged rounded rectangle drawn without a blur filter (a canvas blur is a full filter pass per node, about 7 ms
 * a frame each at glow sizes): one group `id` holding SOFT_RINGS rounded rectangles `<id>.ring<i>`, the first (drawn
 * first, behind) `reach` px past [x, y, w, h] on every side and each next one a step smaller, the last the rectangle
 * itself, each at ringAlpha(alpha). So the rectangle shows `alpha` and the edge falls off to nothing over `reach`.
 * `radius` is the corner radius of the rectangle itself (it grows with each ring); `pill` makes every ring a pill.
 * `props` and `opts` (tracks) go on the group.
 */
export function softRoundedRect({ id, rect: [x, y, w, h], radius = 0, pill = false, reach, alpha, fill, props = {}, opts = {} }) {
  const each = ringAlpha(alpha);
  const rings = Array.from({ length: SOFT_RINGS }, (_, i) => {
    const grow = (reach * (SOFT_RINGS - 1 - i)) / Math.max(1, SOFT_RINGS - 1);
    const rw = w + HALF * grow, rh = h + HALF * grow;
    const d = roundedRect(x - grow, y - grow, rw, rh, pill ? rh / HALF : radius + grow);
    return node('path', `${id}.ring${i}`, { d, fill, opacity: each });
  });
  return node('group', id, props, { ...opts, children: rings });
}

/** A closed rectangle with rounded corners of radius r, in M L Q form. */
export function roundedRect(x, y, w, h, radius) {
  const r = Math.min(radius, w / HALF, h / HALF);
  if (r <= 0) return polyline([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true);
  const [r1, b1] = [x + w, y + h];
  return `M${at2([x + r, y])}L${at2([r1 - r, y])}Q${at2([r1, y])} ${at2([r1, y + r])}L${at2([r1, b1 - r])}`
    + `Q${at2([r1, b1])} ${at2([r1 - r, b1])}L${at2([x + r, b1])}Q${at2([x, b1])} ${at2([x, b1 - r])}`
    + `L${at2([x, y + r])}Q${at2([x, y])} ${at2([x + r, y])}Z`;
}

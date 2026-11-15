// Helpers shared by the v2 graphic devices: parameter checks, the seeded noise stream, colour and style lookup,
// the landing rule, the object entrance and the path string builders. Pure and DOM-free; imports nothing from
// engine/page. Every path a device writes uses only M, L, Q, C and Z, so its numbers are all x y pairs.
import { mulberry32 } from '../../template/seeded.mjs';
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

/** A closed rectangle with rounded corners of radius r, in M L Q form. */
export function roundedRect(x, y, w, h, radius) {
  const r = Math.min(radius, w / HALF, h / HALF);
  if (r <= 0) return polyline([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true);
  const [r1, b1] = [x + w, y + h];
  return `M${at2([x + r, y])}L${at2([r1 - r, y])}Q${at2([r1, y])} ${at2([r1, y + r])}L${at2([r1, b1 - r])}`
    + `Q${at2([r1, b1])} ${at2([r1 - r, b1])}L${at2([x + r, b1])}Q${at2([x, b1])} ${at2([x, b1 - r])}`
    + `L${at2([x, y + r])}Q${at2([x, y])} ${at2([x + r, y])}Z`;
}

// The shader cuts. A shader cut names a fragment shader on the gl-transitions contract and a layer cut that stands in for
// it. The page's post pass (engine/page/post-cut.mjs) runs the shader over the two pictures of the window in WebGL2;
// without WebGL2, or when a shader of the film will not build, the stand-in is drawn and the report names the cut.
//
// A shader module is { name, source, params, directions?, derive?, standIn, license, summary, example }:
//   source     a GLSL ES 3.00 body that declares vec4 transition(vec2 uv) and may call getFromColor(uv) and
//              getToColor(uv) and read `progress` (0 to 1) and `ratio` (width / height); uv runs 0..1 from the
//              bottom-left corner, as gl-transitions has it. Its parameters are uniforms, each with its value in params.
//   params     { [uniform]: number | number[] }, the values of the body's uniforms
//   directions { [direction]: params } in order, the first the default; null or absent for a cut that takes none
//   derive     ({ p, direction, canvas }) -> params, uniforms that move with progress, computed here (optional)
//   standIn    the layer cut drawn in its place without WebGL2: 'crossfade' or 'wipe'
//   license    { spdx, author, origin, commit } for a ported file, null for one written in this repository
// Registered by engine/cuts/index.mjs. Pure and DOM-free.
import { LAYER_CUTS } from '../layers.mjs';
import { ripple } from './ripple.mjs';
import { cube } from './cube.mjs';
// ported from gl-transitions (licences: THIRD_PARTY_NOTICES.md)
import { pageCurl } from './page-curl.mjs';
import { directionalWarp } from './directional-warp.mjs';
import { crossWarp } from './cross-warp.mjs';
import { crossZoom } from './cross-zoom.mjs';
import { wind } from './wind.mjs';
import { windowSlices } from './window-slices.mjs';
import { polkaDots } from './polka-dots.mjs';
import { glitchMemories } from './glitch-memories.mjs';
import { pixelize } from './pixelize.mjs';
import { waterDrop } from './water-drop.mjs';

/** The length of a shader cut's window by default, in seconds. */
export const SHADER_DUR = 0.6;
/** The layer cuts a shader cut may stand in with. */
export const STAND_INS = Object.freeze(['crossfade', 'wipe']);
const TRANSITION_DECLARATION = /\bvec4\s+transition\s*\(/;

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * The registry entry of shader module `module`; throws for a module whose source declares no transition(), whose
 * stand-in is not one of STAND_INS, or whose name is missing.
 */
export function defineShaderCut(module) {
  if (typeof module?.name !== 'string' || module.name === '') throw new Error('a shader cut needs a name');
  if (typeof module.source !== 'string' || !TRANSITION_DECLARATION.test(module.source)) {
    throw new Error(`shader cut "${module.name}": its source must declare vec4 transition(vec2 uv) (the gl-transitions contract)`);
  }
  if (!STAND_INS.includes(module.standIn) || LAYER_CUTS[module.standIn] === undefined) {
    throw new Error(`shader cut "${module.name}": standIn must be one of ${STAND_INS.join(', ')}, got ${JSON.stringify(module.standIn)}`);
  }
  const directions = module.directions ? Object.freeze(Object.keys(module.directions)) : null;
  return Object.freeze({
    family: 'shader', dur: SHADER_DUR, summary: module.summary, example: module.example, directions,
    smearable: false, incomingOnly: false, shader: module, standIn: module.standIn,
  });
}

/**
 * The wrapper's clear windows (engine/page/post-cut.mjs) that never clear: the outgoing picture fades to the ground over
 * progress `from` = [start, end] and the incoming one rises from it over `to`; these lie outside 0..1, so the pictures
 * reach the body untouched. A module that mixes two pictures sets uClearFrom / uClearTo in its params so that only one
 * set of words reads at a time (look review gate-cuts-1; lead ruling 3).
 */
export const CLEAR_NONE = Object.freeze({ from: Object.freeze([2, 3]), to: Object.freeze([-2, -1]) });
/** The cell of the wrapper's integer hash in uv (mmHash rounds uv x this): one texel of a 1024 picture. */
export const HASH_CELL = 1024;
const HEX = 16;
const BYTE = 255;
const HEX_RGB = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

// '#rrggbb' as [r, g, b] in 0..1; black for anything else (a shot's background is always #rrggbb).
const rgbOf = (hex) => {
  const m = HEX_RGB.exec(hex ?? '');
  return m ? [1, 2, 3].map((k) => parseInt(m[k], HEX) / BYTE) : [0, 0, 0];
};

/**
 * The uniforms of shader module `module` at progress p (clamped to 0..1) and edge `direction` on a canvas { w, h }, with
 * `ground` the incoming shot's background (#rrggbb): progress and ratio, the wrapper's defaults (uGround, the clear
 * windows CLEAR_NONE, uHashCell), then its params, then its direction's params, then what derive() computes.
 */
export function shaderUniforms(module, { p, direction = null, canvas, ground }) {
  const own = direction === null ? {} : (module.directions?.[direction] ?? {});
  const derived = typeof module.derive === 'function' ? module.derive({ p: clamp01(p), direction, canvas }) : {};
  const wrapper = { uGround: rgbOf(ground), uClearFrom: CLEAR_NONE.from, uClearTo: CLEAR_NONE.to, uHashCell: HASH_CELL };
  return Object.freeze({ progress: clamp01(p), ratio: canvas.w / canvas.h, ...wrapper, ...module.params, ...own, ...derived });
}

/**
 * The layer cut a shader cut `entry` stands in with at `direction`: its stand-in, with the shader cut's direction when
 * the stand-in takes it, else the stand-in's own default (null when it takes none).
 */
export function standInOf(entry, direction) {
  const layer = LAYER_CUTS[entry.standIn];
  const directions = layer.directions;
  if (directions === null) return Object.freeze({ name: entry.standIn, entry: layer, direction: null });
  return Object.freeze({ name: entry.standIn, entry: layer, direction: directions.includes(direction) ? direction : directions[0] });
}

/** The shader modules, by cut name. */
export const SHADER_MODULES = Object.freeze(Object.fromEntries([
  ripple, cube, pageCurl, directionalWarp, crossWarp, crossZoom, wind, windowSlices, polkaDots, glitchMemories, pixelize, waterDrop,
].map((module) => [module.name, module])));

/** The shader cuts, as registry entries. */
export const SHADER_CUTS = Object.freeze(Object.fromEntries(Object.entries(SHADER_MODULES).map(([name, module]) => [name, defineShaderCut(module)])));

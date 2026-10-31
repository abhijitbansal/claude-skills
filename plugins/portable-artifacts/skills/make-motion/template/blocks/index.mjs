// Browser-safe (no Node imports): the block registry and expandBlocks, step 3 of the spec pipeline (see expandSpec in
// defaults.mjs). A block is a parameterised macro: `{ "type": "block", "id", "x", "y", "block": "<name>", "params" }`
// becomes a `group` with the block's id, place and pose, holding plain elements with ids `<blockId>/<part>`, laid out
// for the canvas size the spec resolves to. Each block module exports:
//   params    a JSON schema for `params` (additionalProperties false, strings and arrays capped; `default`s documented)
//   describe  one line per param, for blocks.mjs show
//   summary   one line on what the block is for
//   example   example params
//   place     (size, format[, side]) -> { x, y }: where the block belongs on that canvas
//   assets    (optional) params that name a file next to the spec (checked like an image src, served like one)
//   paramOf   (optional) part -> the param that sets that part's text (`label-2` -> `steps[1]`), for check.mjs hints;
//             without it a part named like a param (`name`, `title`) points at that param (see paramOfPart)
//   expand    (el, ctx: { theme, sceneDuration, fps, size, format, captions }) -> group; never throws on params its
//             schema accepts. `captions` is whether the spec has a captions track (blocks that stack keep above it).
// The validator compiles `params` with Ajv (Node only); nothing here does.
// Import cycle: defaults.mjs imports this module, and this module (and layout.mjs) import constants from defaults.mjs.
// It is safe because each side reads the other's exports only when a function runs, never while its module loads; keep
// it that way (no top-level use of an imported constant here or in layout.mjs).
import { canvasSize } from '../formats.mjs';
import { MOTION_THEME, DEFAULT_FPS } from '../defaults.mjs';
import titleCard from './title-card.mjs';
import lowerThird from './lower-third.mjs';
import kpiCounter from './kpi-counter.mjs';
import stepFlow from './step-flow.mjs';
import quoteCard from './quote-card.mjs';
import checklist from './checklist.mjs';
import logoOutro from './logo-outro.mjs';
import ctaClose from './cta-close.mjs';

export const BLOCKS = Object.freeze({
  'title-card': titleCard,
  'lower-third': lowerThird,
  'kpi-counter': kpiCounter,
  'step-flow': stepFlow,
  'quote-card': quoteCard,
  checklist,
  'logo-outro': logoOutro,
  'cta-close': ctaClose,
});
export const BLOCK_NAMES = Object.freeze(Object.keys(BLOCKS));

export const isBlock = (el) => el?.type === 'block';

/**
 * A pure copy of `spec` with every top-level `block` element of every scene replaced by its group; a spec without
 * blocks comes back deepEqual to its input. A block the registry does not know, or one without a params object, is
 * left as it is (the validator reports it; nothing else should see it).
 */
export function expandBlocks(spec) {
  const out = structuredClone(spec);
  if (!Array.isArray(out?.scenes)) return out;
  const captions = Array.isArray(out.captions) && out.captions.length > 0;
  const base = { theme: out.theme ?? MOTION_THEME, fps: out.fps ?? DEFAULT_FPS, size: canvasSize(out), format: out.format, captions };
  for (const scene of out.scenes) {
    if (!Array.isArray(scene?.elements)) continue;
    const ctx = { ...base, sceneDuration: scene.duration };
    scene.elements = scene.elements.map((el) => (isBlock(el) && BLOCKS[el.block] && el.params && typeof el.params === 'object' ? BLOCKS[el.block].expand(el, ctx) : el));
  }
  return out;
}

/** The param that sets the text of `part` (a part id without its `<blockId>/` prefix) of block `name`, or null. */
export function paramOfPart(name, part) {
  const def = BLOCKS[name];
  if (!def) return null;
  if (def.paramOf) return def.paramOf(part);
  return Object.hasOwn(def.params.properties, part) ? part : null;
}

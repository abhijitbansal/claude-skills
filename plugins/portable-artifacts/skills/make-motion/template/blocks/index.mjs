// Browser-safe (no Node imports): the block registry and expandBlocks, step 3 of the spec pipeline (see expandSpec in
// defaults.mjs). A block is a parameterised macro: `{ "type": "block", "id", "x", "y", "block": "<name>", "params" }`
// becomes a `group` with the block's id, place and pose, holding plain elements with ids `<blockId>/<part>`, laid out
// for the canvas size the spec resolves to. Each block module exports:
//   params    a JSON schema for `params` (additionalProperties false, strings and arrays capped; `default`s documented)
//   describe  one line per param, for blocks.mjs show
//   summary   one line on what the block is for
//   example   example params
//   place     (size, format) -> { x, y }: where the block belongs on that canvas
//   assets    (optional) params that name a file next to the spec (checked like an image src, served like one)
//   expand    (el, ctx: { theme, sceneDuration, fps, size }) -> group; never throws on params its schema accepts
// The validator compiles `params` with Ajv (Node only); nothing here does. defaults.mjs imports this module, and this
// module imports defaults.mjs's constants only inside expandBlocks, so the import cycle is safe.
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
  const base = { theme: out.theme ?? MOTION_THEME, fps: out.fps ?? DEFAULT_FPS, size: canvasSize(out) };
  for (const scene of out.scenes) {
    if (!Array.isArray(scene?.elements)) continue;
    const ctx = { ...base, sceneDuration: scene.duration };
    scene.elements = scene.elements.map((el) => (isBlock(el) && BLOCKS[el.block] && el.params && typeof el.params === 'object' ? BLOCKS[el.block].expand(el, ctx) : el));
  }
  return out;
}

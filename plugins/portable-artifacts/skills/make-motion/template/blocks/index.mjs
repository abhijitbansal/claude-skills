// Browser-safe (no Node imports): the block registry and expandBlocks, step 3 of the spec pipeline (see expandSpec in
// defaults.mjs). A block is a parameterised macro: `{ "type": "block", "id", "x", "y", "block": "<name>", "params" }`
// becomes a `group` with the block's id, place and pose, holding plain elements with ids `<blockId>/<part>`, laid out
// for the canvas size the spec resolves to. Each block module exports:
//   params    a JSON schema for `params` (additionalProperties false, strings and arrays capped; `default`s documented)
//   describe  one line per param, for blocks.mjs show
//   summary   one line on what the block is for
//   example   example params
//   place     (size, format[, side[, insets]]) -> { x, y }: where the block belongs on that canvas; `insets` are a viral
//             spec's (viral.mjs viralInsets), which move it inside the platform safe zone and above the lifted captions
//   assets    (optional) params that name a file next to the spec (checked like an image src, served like one): each a
//             key of `params`, or a dotted path to a nested one (`before.src`); see blockAssetFiles
//   validate  (optional) (params, { sceneDuration }) -> [{ path, message }]: what the schema cannot say, run on params
//             that passed it; `path` is relative to `params` (`beatSeconds`). A block whose schedule needs a scene of
//             some length also exports `minDuration(params)` in seconds, which validate reads
//   hook      (optional) the parts (names without `<blockId>/`) that are on screen from frame 0, with viral.mjs's hook
//             entrance, when the block opens a viral spec (scene 0): the words a viewer should read first
//   paramOf   (optional) part -> the param that sets that part's text (`label-2` -> `steps[1]`), for check.mjs hints;
//             without it a part named like a param (`name`, `title`) points at that param (see paramOfPart)
//   expand    (el, ctx: { theme, sceneDuration, fps, size, format, captions, insets }) -> group; never throws on params
//             its schema accepts. `captions` is whether the spec has a captions track (blocks that stack keep above it);
//             `insets` the viral safe zone, null for a spec that is not viral (layout.mjs freeBand and contentWidth).
// In scene 0 of a viral spec a block's `hook` parts take the hook entrance (viral.mjs hookParts), so frame 0 shows them.
// The validator compiles `params` with Ajv (Node only); nothing here does.
// Import cycle: defaults.mjs imports this module, and this module (and layout.mjs) import constants from defaults.mjs.
// It is safe because each side reads the other's exports only when a function runs, never while its module loads; keep
// it that way (no top-level use of an imported constant here or in layout.mjs).
import { canvasSize } from '../formats.mjs';
import { MOTION_THEME, DEFAULT_FPS } from '../defaults.mjs';
import { isViral, viralInsets, hookParts } from '../viral.mjs';
import titleCard from './title-card.mjs';
import lowerThird from './lower-third.mjs';
import kpiCounter from './kpi-counter.mjs';
import stepFlow from './step-flow.mjs';
import quoteCard from './quote-card.mjs';
import checklist from './checklist.mjs';
import logoOutro from './logo-outro.mjs';
import ctaClose from './cta-close.mjs';
import ctaSoft from './cta-soft.mjs';
import storyBeats from './story-beats.mjs';
import listicle from './listicle.mjs';
import beforeAfterSwipe from './before-after-swipe.mjs';

export const BLOCKS = Object.freeze({
  'title-card': titleCard,
  'lower-third': lowerThird,
  'kpi-counter': kpiCounter,
  'step-flow': stepFlow,
  'quote-card': quoteCard,
  checklist,
  'logo-outro': logoOutro,
  'cta-close': ctaClose,
  'cta-soft': ctaSoft,
  'story-beats': storyBeats,
  listicle,
  'before-after-swipe': beforeAfterSwipe,
});
export const BLOCK_NAMES = Object.freeze(Object.keys(BLOCKS));

export const isBlock = (el) => el?.type === 'block';

/** The definition of block `name`, or undefined. A name is a registry key only: `constructor` and `__proto__` are not blocks. */
export const blockDef = (name) => (typeof name === 'string' && Object.hasOwn(BLOCKS, name) ? BLOCKS[name] : undefined);

/**
 * The files the params of block element `el` name, as [{ at, src }]: `at` the path in `params` (`src`, `before.src`),
 * `src` its value, for every path in the definition's `assets` that holds a string. Own properties only; never throws,
 * so it also reads params that no schema has checked.
 */
export function blockAssetFiles(el) {
  const at = (obj, key) => (obj !== null && typeof obj === 'object' && Object.hasOwn(obj, key) ? obj[key] : undefined);
  return (blockDef(el?.block)?.assets ?? []).flatMap((path) => {
    const src = path.split('.').reduce(at, el.params);
    return typeof src === 'string' ? [{ at: path, src }] : [];
  });
}

/**
 * A pure copy of `spec` with every top-level `block` element of every scene replaced by its group; a spec without
 * blocks comes back deepEqual to its input. A block the registry does not know, or one without a params object, is
 * left as it is (the validator reports it; nothing else should see it).
 */
export function expandBlocks(spec) {
  const out = structuredClone(spec);
  if (!Array.isArray(out?.scenes)) return out;
  const captions = Array.isArray(out.captions) && out.captions.length > 0;
  const size = canvasSize(out);
  const base = { theme: out.theme ?? MOTION_THEME, fps: out.fps ?? DEFAULT_FPS, size, format: out.format, captions, insets: viralInsets(out, size) };
  out.scenes.forEach((scene, si) => {
    if (!Array.isArray(scene?.elements)) return;
    const ctx = { ...base, sceneDuration: scene.duration };
    const hook = isViral(out) && si === 0;
    scene.elements = scene.elements.map((el) => {
      if (!(isBlock(el) && blockDef(el.block) && el.params && typeof el.params === 'object')) return el;
      const def = blockDef(el.block);
      const group = def.expand(el, ctx);
      return hook ? hookParts(group, def.hook, scene.duration, base.fps) : group;
    });
  });
  return out;
}

/** The param that sets the text of `part` (a part id without its `<blockId>/` prefix) of block `name`, or null. */
export function paramOfPart(name, part) {
  const def = blockDef(name);
  if (!def) return null;
  if (def.paramOf) return def.paramOf(part);
  return Object.hasOwn(def.params.properties, part) ? part : null;
}

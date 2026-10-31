// Browser-safe (no Node imports): shared by spec validation, timeline and renderer.
import { childrenOf } from './groups.mjs';
import { canvasSize } from './formats.mjs';
import { expandBlocks } from './blocks/index.mjs';
import { applyViral, autoCues, isViral, hookKeyframes, visibleAtStart } from './viral.mjs';
import { TRANSITION_SECONDS, normalizeTransition, comesInOver } from './transitions.mjs';

// No `background` default: the page fills it from the theme's page colour (see renderer fetchSpec). The canvas size
// default lives in formats.mjs (canvasSize).
const DEFAULTS = Object.freeze({ fps: 30 });
export const DEFAULT_FPS = DEFAULTS.fps;
export const FADE_SECONDS = TRANSITION_SECONDS; // a fade or crossfade lasts this unless its `duration` says otherwise
export const TYPING_SECONDS_PER_CHAR = 0.035;
export const ARROW_HEAD_LENGTH = 3; // an arrow head is this many stroke widths long
// What a shape draws with when its spec gives no size: one source for the page and the validator's line-length minimums.
export const DEFAULT_SHAPE_SIZE = 100; // width and height
export const DEFAULT_LINE_STROKE = 4;
export const DEFAULT_CAPTION_STYLE = 'plain'; // a captions track's `style` when it names none (template/captions.mjs)

// A `typing` text's characters as a reader counts them: grapheme clusters, so an emoji, a ZWJ sequence, a flag or a
// letter with a combining accent is one character and is never typed in halves.
const GRAPHEMES = new Intl.Segmenter('en', { granularity: 'grapheme' });
export const graphemes = (text) => Array.from(GRAPHEMES.segment(text), (part) => part.segment);
export const typingLength = (text) => graphemes(text).length;

// A counter with no `value` keyframes counts from -> to from its scene start over this many seconds (timeline.mjs).
const COUNTER_MAX_SECONDS = 2;
const COUNTER_SCENE_SHARE = 0.8;
export const counterSeconds = (sceneDuration) => Math.min(COUNTER_MAX_SECONDS, COUNTER_SCENE_SHARE * sceneDuration);

// make-motion's default theme (scripts/lib/default-theme.mjs re-exports it). The shared
// DEFAULT_THEME stays `paper` for make-dashboard.
export const MOTION_THEME = 'dusk';

// Theme colour tokens a shape `fill`/`stroke` or a text `color` may name instead of a hex; each resolves to the
// active theme's dark colour of that name (see renderer themedLook).
export const COLOR_TOKENS = Object.freeze(['surface', 'line', 'accent', 'accentSoft', 'good', 'bad', 'warn', 'text', 'text2', 'text3', 'cat1', 'cat2', 'cat3', 'cat4', 'cat5', 'cat6']);

// `value` as a colour: a token becomes the theme's colour, anything else (already validated) passes through.
export const resolveColor = (value, colors) => (COLOR_TOKENS.includes(value) ? colors[value] : value);

// Per-theme kinetic type for `role: "title"` text that sets no keyframes. Themes not listed
// (paper, ink, blueprint, editorial) get no preset.
export const TYPE_PRESETS = Object.freeze({ dusk: 'rise', press: 'ink-in', poster: 'slam' });

// Named eases: cubic-Bézier control points (x1, y1, x2, y2). template/timeline.mjs turns each into an anime.js
// cubicBezier function (an ease *string* such as 'cubicBezier(...)' is silently linear in anime 4.5).
// enter: fast out, gentle settle (entrances). exit: slow start, accelerating away (exits). move: symmetric
// in-out (a move between two places). land: like move, overshooting by about 1 % before it lands (one hero moment).
export const EASE_CURVES = Object.freeze({
  enter: Object.freeze([0.16, 1, 0.3, 1]),
  exit: Object.freeze([0.6, 0, 0.9, 0.35]),
  move: Object.freeze([0.65, 0, 0.35, 1]),
  land: Object.freeze([0.55, 0, 0.2, 1.12]),
});

// Seconds each preset takes when the scene is long enough; a shorter scene compresses it.
const PRESET_SECONDS = Object.freeze({ rise: 0.9, 'ink-in': 1.1, slam: 0.5 });
const EXIT_SHARE = 0.5; // an exit takes about half its entrance
const EXIT_EARLIEST = 0.9; // of the scene: an exit never starts before this, so the 85 % contact frame is fully in
const SLAM_EXIT_SCALE = 0.85;
const RISE_OPACITY_SHARE = 0.6; // the fade settles before the travel: a soft stagger
const RISE_TRAVEL = 0.35; // of the font size
const INK_SCALE = 1.04;
const SLAM_SCALE = 1.35;
const SLAM_SNAP_SHARE = 0.25; // opacity snaps in over the first quarter
const DEFAULT_FONT_SIZE = 48;
const T_DECIMALS = 1e4;

const round = (t) => Math.round(t * T_DECIMALS) / T_DECIMALS;

const GENERATORS = {
  // dusk: a soft rise into place, the fade leading the travel.
  rise: (el, end) => [
    { t: 0, opacity: 0, y: el.y + Math.round((el.fontSize ?? DEFAULT_FONT_SIZE) * RISE_TRAVEL) },
    { t: round(end * RISE_OPACITY_SHARE), opacity: el.opacity ?? 1, ease: 'outCubic' },
    { t: end, y: el.y, ease: 'outQuart' },
  ],
  // press: ink settling on paper; no movement, a barely-there scale.
  'ink-in': (el, end) => [
    { t: 0, opacity: 0, scale: INK_SCALE * (el.scale ?? 1) },
    { t: end, opacity: el.opacity ?? 1, ease: 'inOutSine' },
    { t: end, scale: el.scale ?? 1, ease: 'outQuart' },
  ],
  // poster: thrown at the wall; a quick opacity snap and a big scale that lands with a bounce.
  slam: (el, end) => [
    { t: 0, opacity: 0, scale: SLAM_SCALE * (el.scale ?? 1) },
    { t: round(end * SLAM_SNAP_SHARE), opacity: el.opacity ?? 1, ease: 'outQuad' },
    { t: end, scale: el.scale ?? 1, ease: 'outBack' },
  ],
};

// Exits: from a hold on the element's own pose at `start` to its exit pose at `end`, with the `exit` ease.
const EXITS = {
  // dusk: the rise reversed, fading as it drops away.
  rise: (el, start, end) => [
    { t: start, opacity: el.opacity ?? 1, y: el.y },
    { t: end, opacity: 0, y: el.y + Math.round((el.fontSize ?? DEFAULT_FONT_SIZE) * RISE_TRAVEL), ease: 'exit' },
  ],
  // press: the ink lifting off the page; it fades as it grows by the same hair it settled from.
  'ink-in': (el, start, end) => [
    { t: start, opacity: el.opacity ?? 1, scale: el.scale ?? 1 },
    { t: end, opacity: 0, scale: INK_SCALE * (el.scale ?? 1), ease: 'exit' },
  ],
  // poster: a snap down and out.
  slam: (el, start, end) => [
    { t: start, opacity: el.opacity ?? 1, scale: el.scale ?? 1 },
    { t: end, opacity: 0, scale: SLAM_EXIT_SCALE * (el.scale ?? 1), ease: 'exit' },
  ],
};

/**
 * The exit keyframes of preset `name` for a title whose entrance (`entrance`, from presetKeyframes) is already set,
 * or [] when there is no room. The exit lands one frame (1/fps) before the scene end and takes half the entrance's
 * full length, but never starts before 0.9 x the scene (a shorter scene gets a shorter exit), nor before the
 * entrance has landed. Pure.
 */
export function exitKeyframes(name, el, sceneDuration, fps, entrance) {
  const end = round(Math.floor((sceneDuration - 1 / fps) * T_DECIMALS) / T_DECIMALS);
  const start = round(Math.max(end - PRESET_SECONDS[name] * EXIT_SHARE, sceneDuration * EXIT_EARLIEST));
  if (start >= end || start < entrance.at(-1).t) return [];
  return EXITS[name](el, start, end);
}

/**
 * The keyframes of preset `name` for text element `el` in a scene of `sceneDuration` seconds.
 * Pure: the same arguments always give the same keyframes. The last one lands at least one
 * frame (1/fps) before the scene end, so the final pose is always shown.
 */
export function presetKeyframes(name, el, sceneDuration, fps) {
  const end = round(Math.min(PRESET_SECONDS[name], Math.floor((sceneDuration - 1 / fps) * T_DECIMALS) / T_DECIMALS));
  return GENERATORS[name](el, end);
}

// `exits`: whether an `exit: true` title may leave (every scene but the spec's last). Returns the keyframes and
// whether an exit was appended.
// `hook`: the title is viral mode's hook (scene 0, nothing around it hidden at t 0), so it enters with the hook entrance
// (viral.mjs hookKeyframes) instead of the theme's, whatever the theme; its `exit` still takes the theme's exit.
function presetFor(el, theme, sceneDuration, fps, exits, hook) {
  const name = TYPE_PRESETS[theme];
  if ((!name && !hook) || el.type !== 'text' || el.role !== 'title' || el.keyframes !== undefined) return { keyframes: el.keyframes, exited: false };
  const entrance = hook ? hookKeyframes(el, sceneDuration, fps) : presetKeyframes(name, el, sceneDuration, fps);
  if (!name) return { keyframes: entrance, exited: false };
  const exit = el.exit === true && exits ? exitKeyframes(name, el, sceneDuration, fps, entrance) : [];
  return { keyframes: [...entrance, ...exit], exited: exit.length > 0 };
}

// An element's own defaults, then its children's (a group's), at any depth. `hook`: titles here are viral mode's hook; a
// group hidden at t 0 passes it on to no child, since a hook it hides could not be on screen at frame 0.
function fillElement(el, theme, scene, fps, exits, hook = false) {
  const preset = presetFor(el, theme, scene.duration, fps, exits, hook);
  el.keyframes = preset.keyframes;
  if (preset.exited) el.exitPreset = true; // check.mjs: this title leaves on purpose (it opted in with `exit`)
  el.opacity ??= 1;
  el.scale ??= 1;
  el.rotate ??= 0;
  el.draw = 1;
  el.reveal = 1;
  el.value = el.type === 'counter' ? (el.from ?? 0) : 0;
  el.keyframes ??= [];
  for (const child of childrenOf(el)) fillElement(child, theme, scene, fps, exits, hook && visibleAtStart(el));
}

// The root `format` sets the canvas size when the spec gives none (the validator refuses a `size` that disagrees);
// with neither, the canvas is the default 1920x1080. `format` stays on the spec: the caption zone reads it.
function applyFormat(out) {
  out.size ??= [...canvasSize(out)];
}

// The steps that rewrite a spec, in their one fixed order, so every consumer (validator, renderer, timeline, check,
// render) sees the same plain elements. This list is the only place the order is written; Tasks 16 and 11a slot their
// steps into the numbered places and never reorder them.
//   1 substituteVars  (Task 16)  {{name}} becomes its value anywhere, block params and `mode` included
//   2 applyViral      (Task 11a) `mode: "viral"` defaults, so the `format` it sets reaches step 3
//   3 expandBlocks               each `block` becomes a `group` of plain elements, laid out for canvasSize(spec): the
//                                size step 4 will write, read before it is written
//   4 applyFormat                `size` from `format`; then the theme presets fill in (fillElement), viral mode's hook
//                                entrance in place of the theme's for the first scene's titles
//   5 autoCues        (Task 11a) cues derived from the finished elements: it runs last, once every element's base
//                                values and theme preset are filled in, because a preset's opacity-0 start is an entrance
// Steps 1-3 change what the spec says, so the validator runs them too (expandSpec), after checking their inputs (block
// params) and before its full check; steps 4-5 only fill in, and run in withDefaults alone.
export function expandSpec(spec) {
  // 1 substituteVars goes here, before applyViral.
  return expandBlocks(applyViral(spec)); // 2, then 3: each a pure copy (applyViral returns a spec that is not viral as it is)
}

// Pure copy with every optional root and element base value filled in.
export function withDefaults(spec) {
  const out = expandSpec(spec); // steps 1-3 (a copy: spec is never mutated)
  applyFormat(out); // 4: size and presets
  out.fps ??= DEFAULTS.fps;
  out.theme ??= MOTION_THEME;
  out.audio = (out.audio ?? []).map((track) => ({ at: 0, volume: 1, fadeIn: 0, fadeOut: 0, ...track }));
  out.captions = (out.captions ?? []).map((track) => ({ at: 0, style: DEFAULT_CAPTION_STYLE, ...track }));
  const transition = out.transition ?? 'none';
  out.scenes.forEach((scene, si) => {
    // the first scene has nothing to come in over; a root object is copied, not shared between scenes
    scene.transition ??= si === 0 && comesInOver(normalizeTransition(transition).type) ? 'none' : (typeof transition === 'object' ? { ...transition } : transition);
    const hook = si === 0 && isViral(out); // the first scene's titles are the hook
    for (const el of scene.elements) fillElement(el, out.theme, scene, out.fps, si < out.scenes.length - 1, hook);
  });
  if (isViral(out) && out.cues === undefined) out.cues = autoCues(out); // 5: a written `cues` (even []) wins
  return out;
}

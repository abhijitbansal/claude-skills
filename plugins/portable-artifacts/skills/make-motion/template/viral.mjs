// Browser-safe (no Node imports): viral mode (`"mode": "viral"`), for short-form Reels, TikTok and Shorts. Every rule
// here is a default or feeds a check.mjs warning, never a failure:
//   applyViral  step 2 of the spec pipeline (defaults.mjs): 9:16 when neither `size` nor `format` is written, a -14 LUFS /
//               -1 dBTP loudness target and the platform safe zone
//   the hook    scene 0's titles enter with hookKeyframes instead of the theme entrance: defaults.mjs applies it where it
//               applies the theme presets (step 4, so a hook title keeps its `exit`), blocks/index.mjs to a block's
//               `hook` parts (hookParts)
//   autoCues    step 5: a swoosh on each cut, a pop on each entrance, a ding on each counter landing, AUTO_CUE_GAP apart
//   changeGaps  the stretches longer than VIRAL_CHANGE_SECONDS in which the spec changes nothing (no page needed)
// The numbers are tunable defaults from the platforms' ad specs and creator guidance, not platform rules.
// Import cycle: defaults.mjs imports this module and this module imports constants from defaults.mjs; each side reads
// the other's exports only when a function runs, never while its module loads. Keep it that way.
import { canvasSize, safeInsets, VIRAL_SAFE_ZONE } from './formats.mjs';
import { flattenElements } from './groups.mjs';
import { MAX_CUES } from './audio.mjs';
import { windowSeconds } from './transitions.mjs';
import { cameraSpans } from './camera.mjs';
import { DEFAULT_FPS, TYPING_SECONDS_PER_CHAR, typingLength, counterSeconds } from './defaults.mjs';

export const VIRAL_MODE = 'viral';
export const VIRAL_FORMAT = '9:16';
export const VIRAL_LOUDNESS = Object.freeze({ integrated: -14, truePeak: -1 });
// Scene 0's title is the hook: on screen from frame 0 (opacity 1), settling from a slight scale with the `enter` ease.
export const HOOK_ENTRANCE = Object.freeze({ scale: 1.08, seconds: 0.4, ease: 'enter' });
export const HOOK_WORDS = Object.freeze({ min: 3, max: 7 }); // check.mjs: the hook's length in whitespace-separated words
// Something should cut, reveal or move at least this often. changeGaps (the no-browser path) reads it; the page path
// (scripts/lib/viral-checks.mjs stillWarnings) uses audits.mjs DEAD_STRETCH_SECONDS, also 3: change both together.
export const VIRAL_CHANGE_SECONDS = 3;
export const AUTO_CUE_GAP = 0.4; // seconds: an auto cue this close after the one before is dropped
// The cue each kind of moment gets and its volume (a literal gain). The key order breaks ties at the same moment.
const AUTO_CUES = Object.freeze({ swoosh: 0.6, ding: 0.5, pop: 0.35 });
const KIND_ORDER = Object.keys(AUTO_CUES);
const ENTRANCE_PROPS = ['opacity', 'draw', 'reveal']; // starting at 0 on one of these is an entrance
const T_DECIMALS = 1e4;
const EPSILON = 1e-9;
const round = (t) => Math.round(t * T_DECIMALS) / T_DECIMALS;

export const isViral = (spec) => spec?.mode === VIRAL_MODE;

/**
 * The insets a viral spec lays out and judges with (safeInsets of its `viral.safeZone`, VIRAL_SAFE_ZONE when it has
 * none) on canvas `size`, or null for a spec that is not viral (the plain safe margin applies). Pure.
 */
export const viralInsets = (spec, size = canvasSize(spec)) => (isViral(spec) ? safeInsets(size, spec.viral?.safeZone ?? VIRAL_SAFE_ZONE) : null);

// The last moment a keyframe may land in a scene: one frame before its end, so the final pose is shown.
const lastFrame = (duration, fps) => Math.floor((duration - 1 / fps) * T_DECIMALS) / T_DECIMALS;

/** The hook entrance of `el` in a scene of `sceneDuration` seconds: shown at t 0, scaled down to its own scale. Pure. */
export function hookKeyframes(el, sceneDuration, fps) {
  const end = round(Math.min(HOOK_ENTRANCE.seconds, lastFrame(sceneDuration, fps)));
  const scale = el.scale ?? 1;
  return [{ t: 0, opacity: el.opacity ?? 1, scale: round(HOOK_ENTRANCE.scale * scale) }, { t: end, scale, ease: HOOK_ENTRANCE.ease }];
}

/** Whether `el` (a group, or any element) is on screen at t 0: its first opacity keyframe, else its own opacity, is above 0. */
export const visibleAtStart = (el) => ((el.keyframes ?? []).find((kf) => kf.opacity !== undefined)?.opacity ?? el.opacity ?? 1) > 0;

/**
 * A block's group (blocks/index.mjs expandBlocks, scene 0 of a viral spec) with the parts its definition names as its
 * hook (`parts`, part names such as ['title']) on the hook entrance instead of the block's own, so the thumbnail shows
 * them. A block that names none comes back as it is. Pure.
 */
export function hookParts(group, parts, sceneDuration, fps) {
  if (!parts?.length) return group;
  const ids = new Set(parts.map((part) => `${group.id}/${part}`));
  return { ...group, children: group.children.map((el) => (ids.has(el.id) ? { ...el, keyframes: hookKeyframes(el, sceneDuration, fps) } : el)) };
}

/**
 * Pipeline step 2: a copy of a viral spec with the viral defaults filled in (a spec that is not viral comes back as it
 * is). `format` 9:16 when neither `size` nor `format` is written; `loudness` -14 LUFS / -1 dBTP when absent;
 * `viral.safeZone` VIRAL_SAFE_ZONE when absent. (The hook entrance is applied with the presets; see the header.)
 */
export function applyViral(spec) {
  if (!isViral(spec)) return spec;
  const out = structuredClone(spec);
  if (out.size === undefined && out.format === undefined) out.format = VIRAL_FORMAT;
  out.loudness ??= { ...VIRAL_LOUDNESS };
  out.viral = { ...out.viral, safeZone: out.viral?.safeZone ?? { ...VIRAL_SAFE_ZONE } };
  return out;
}

// Scene seconds where `el` enters: the earliest of its first opacity, draw or reveal keyframes that starts at 0; null
// when none does (it is on screen from the start, or only leaves).
function entranceAt(el) {
  const starts = ENTRANCE_PROPS.flatMap((prop) => {
    const kf = (el.keyframes ?? []).find((k) => k[prop] !== undefined);
    return kf?.[prop] === 0 ? [kf.t] : [];
  });
  return starts.length ? Math.min(...starts) : null;
}

// Scene seconds where a counter lands: its last `value` keyframe, or the end of its default count; null for the rest.
function landingAt(el, sceneDuration) {
  if (el.type !== 'counter') return null;
  const values = (el.keyframes ?? []).filter((kf) => kf.value !== undefined);
  return values.length ? values.at(-1).t : counterSeconds(sceneDuration);
}

/**
 * Pipeline step 5 (after the presets): the cues a viral spec gets when it writes no `cues`. Candidates are a swoosh
 * at every scene start but the first, a pop at every element's entrance and a ding at every counter's landing (a pop
 * or ding on the scene's last frame or later is dropped). They are sorted by video time, then kind (swoosh, ding, pop),
 * then element order; one less than AUTO_CUE_GAP after the last kept is dropped, so a cut gets one cue; the list is
 * cut at MAX_CUES. `spec` is a withDefaults spec (fps set, presets applied). Pure and deterministic.
 */
export function autoCues(spec) {
  const fps = spec.fps ?? DEFAULT_FPS;
  const candidates = [];
  let start = 0;
  spec.scenes.forEach((scene, si) => {
    const last = scene.duration - 1 / fps;
    const add = (kind, at, order) => candidates.push({ kind, scene: scene.id, at: round(at), time: round(start + at), order });
    if (si > 0) add('swoosh', 0, -1);
    flattenElements(scene.elements).forEach(({ el }, order) => {
      for (const [kind, at] of [['pop', entranceAt(el)], ['ding', landingAt(el, scene.duration)]]) {
        if (at !== null && at < last - EPSILON) add(kind, at, order);
      }
    });
    start += scene.duration;
  });
  candidates.sort((a, b) => a.time - b.time || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.order - b.order);
  const kept = [];
  for (const c of candidates) if (!kept.length || c.time - kept.at(-1).time >= AUTO_CUE_GAP - EPSILON) kept.push(c);
  return kept.slice(0, MAX_CUES).map(({ kind, scene, at }) => ({ cue: kind, scene, at, volume: AUTO_CUES[kind] }));
}

// Scene-second spans over which `el` changes the frame continuously: every tween (two consecutive keyframes setting the
// same property, a move or fade as much as a count, draw or reveal), and a counter's or typing text's default count
// when it has no `value` keyframes.
function continuousSpans(el, sceneDuration) {
  const keyframes = el.keyframes ?? [];
  const props = [...new Set(keyframes.flatMap((kf) => Object.keys(kf)))].filter((prop) => prop !== 't' && prop !== 'ease');
  const spans = props.flatMap((prop) => {
    const times = keyframes.filter((kf) => kf[prop] !== undefined).map((kf) => kf.t);
    return times.slice(1).map((to, i) => [times[i], to]);
  });
  if (keyframes.some((kf) => kf.value !== undefined)) return spans;
  if (el.type === 'counter') spans.push([0, counterSeconds(sceneDuration)]);
  if (el.type === 'text' && el.typing) spans.push([0, typingLength(el.text ?? '') * TYPING_SECONDS_PER_CHAR]);
  return spans;
}

/**
 * The stretches longer than VIRAL_CHANGE_SECONDS in which the spec changes nothing, as [{ from, to }] in video seconds.
 * Change moments are every scene start, every keyframe and every one of `captionTimes` (video seconds where a caption
 * group appears or goes); any tween, and the window of a scene's transition, is change all through its span. The video's end closes the last stretch. Read
 * from the spec alone (no page), so a tween between two equal values still counts as change. Pure.
 */
export function changeGaps(spec, captionTimes = []) {
  const spans = captionTimes.map((t) => [t, t]);
  let start = 0;
  for (const [si, scene] of spec.scenes.entries()) {
    spans.push([start, start + windowSeconds(scene, si)]); // a transition window is change all through
    for (const kf of scene.camera?.keyframes ?? []) spans.push([start + kf.t, start + kf.t]); // the camera, as the elements
    for (const [a, b] of cameraSpans(scene.camera, scene.duration)) spans.push([start + a, start + b]);
    for (const { el } of flattenElements(scene.elements)) {
      for (const kf of el.keyframes ?? []) spans.push([start + kf.t, start + kf.t]);
      for (const [a, b] of continuousSpans(el, scene.duration)) spans.push([start + a, start + b]);
    }
    start += scene.duration;
  }
  spans.sort((a, b) => a[0] - b[0]);
  const gaps = [];
  let cursor = 0;
  for (const [a, b] of [...spans, [start, start]]) {
    if (a - cursor > VIRAL_CHANGE_SECONDS + EPSILON) gaps.push({ from: round(cursor), to: round(a) });
    cursor = Math.max(cursor, b);
  }
  return gaps;
}

// Beat references, pure: a keyframe `t` or a cue, audio or captions `at` written "beat:<n>" becomes that beat's time in
// seconds. `t` is scene time (the beat's time minus the scene's start); `at` is video time, or scene time when the item
// names a `scene`, exactly as a plain number is read. No file access: scripts/lib/beats-file.mjs loads the beats list and
// calls this (pipeline step 1b: after vars, before viral mode, blocks, presets and auto cues).
import { pathJoin } from '../../shared/errors.mjs';

const BEATISH = /^\s*beat:/i; // anything that reads as an attempt: " beat:1" and "Beat:1" get the beat hint, not a bare "must be number"
const REFERENCE = /^beat:(\d{1,6})$/;
const T_DECIMALS = 1e4;
const EPSILON = 1e-6; // seconds: float noise in a scene boundary is not "outside"

/** Thrown by resolveBeats: `errors` is every problem found, as [{ path, message }] in the validator's path format. */
export class BeatRefError extends Error {
  constructor(errors) {
    super(errors[0].message);
    this.name = 'BeatRefError';
    this.errors = errors;
  }
}

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const round = (t) => Math.round(t * T_DECIMALS) / T_DECIMALS;
const plainSeconds = (t) => `${Math.round(t * 1000) / 1000}s`; // 4s, 5.5s
const beatSeconds = (t) => { // 6.0s, 6.125s
  const text = String(Math.round(t * 1000) / 1000);
  return `${text.includes('.') ? text : `${text}.0`}s`;
};

// `list` with `fn` applied to every entry; the very same array when nothing changed (and anything not an array as it is).
const mapKeep = (list, fn) => {
  if (!Array.isArray(list)) return list;
  const next = list.map(fn);
  return next.some((item, i) => item !== list[i]) ? next : list;
};
const setKey = (obj, key, value) => (obj[key] === value ? obj : { ...obj, [key]: value });

// Each scene's id, start and length in video seconds. A scene with no usable length has none: its beats are left alone.
function scenesOf(scenes) {
  let start = 0;
  return (Array.isArray(scenes) ? scenes : []).map((scene) => {
    const duration = isPlain(scene) ? scene.duration : undefined;
    const span = isPlain(scene) && Number.isFinite(duration) ? { id: scene.id, start, duration } : null;
    if (Number.isFinite(duration)) start += duration;
    return span;
  });
}

// `value` as seconds when it is a beat reference. `scene`: the span it is relative to, or undefined for video time.
function resolveValue(value, at, ctx, scene) {
  if (typeof value !== 'string' || !BEATISH.test(value)) return value;
  const fail = (message) => { ctx.errors.push({ path: at, message }); return value; };
  const match = REFERENCE.exec(value);
  if (!match) return fail(`${JSON.stringify(value)} is not a beat reference; write "beat:<n>" with n a whole number from 0, like "beat:12"`);
  if (ctx.beats === undefined) return fail(`${JSON.stringify(value)} needs a root "beats" file`);
  const n = Number(match[1]);
  if (n >= ctx.beats.length) return fail(`beat:${n} does not exist; the file has ${ctx.beats.length} beat${ctx.beats.length === 1 ? '' : 's'}`);
  const time = ctx.beats[n];
  if (scene === undefined) return round(time);
  const inScene = time - scene.start;
  if (inScene < -EPSILON || inScene > scene.duration + EPSILON) {
    return fail(`beat:${n} is at ${beatSeconds(time)}, outside scene ${JSON.stringify(scene.id)} (${plainSeconds(scene.start)} to ${plainSeconds(scene.start + scene.duration)})`);
  }
  return round(Math.max(0, inScene));
}

const timed = (obj, key, at, ctx, scene) => (isPlain(obj) ? setKey(obj, key, resolveValue(obj[key], pathJoin(at, key), ctx, scene)) : obj);

// An element's keyframes, and its children's (a group's), at any depth.
function resolveElement(el, at, ctx, scene) {
  if (!isPlain(el)) return el;
  const keyframes = mapKeep(el.keyframes, (kf, i) => timed(kf, 't', pathJoin(pathJoin(at, 'keyframes'), i), ctx, scene));
  const children = mapKeep(el.children, (child, i) => resolveElement(child, pathJoin(pathJoin(at, 'children'), i), ctx, scene));
  return setKey(setKey(el, 'keyframes', keyframes), 'children', children);
}

function resolveScene(scene, at, ctx, span) {
  if (!isPlain(scene) || span === null) return scene;
  const elements = mapKeep(scene.elements, (el, i) => resolveElement(el, pathJoin(pathJoin(at, 'elements'), i), ctx, span));
  const camera = isPlain(scene.camera)
    ? setKey(scene.camera, 'keyframes', mapKeep(scene.camera.keyframes, (kf, i) => timed(kf, 't', pathJoin(pathJoin(pathJoin(at, 'camera'), 'keyframes'), i), ctx, span)))
    : scene.camera;
  return setKey(setKey(scene, 'elements', elements), 'camera', camera);
}

// An audio track, cue or captions track: `at` is video time, or time in the scene its `scene` names.
function resolveItem(item, at, ctx) {
  if (!isPlain(item) || typeof item.at !== 'string' || !BEATISH.test(item.at)) return item;
  if (item.scene === undefined) return timed(item, 'at', at, ctx, undefined);
  const index = ctx.scenes.findIndex((s) => s?.id === item.scene);
  if (index < 0) {
    ctx.errors.push({ path: pathJoin(at, 'scene'), message: `scene ${JSON.stringify(item.scene)} not found; scenes: ${ctx.names.join(', ')}` });
    return item;
  }
  return timed(item, 'at', at, ctx, ctx.scenes[index]);
}

/**
 * `spec` with every "beat:<n>" in a keyframe `t` (elements, groups' children, scene cameras) and in an audio, cues or
 * captions `at` replaced by seconds. `beats`: the beat times in seconds (a validated, ascending list), or undefined when
 * the spec names no beats file. Pure: `spec` is not changed, and one without a beat reference comes back as the same
 * object. Throws a BeatRefError listing every problem: a reference that is not `beat:<n>`, one with no `beats` file,
 * an index past the end, a beat outside the scene it is timed in, and a `scene` that does not exist.
 */
export function resolveBeats(spec, beats) {
  if (!isPlain(spec)) return spec;
  const scenes = scenesOf(spec.scenes);
  const ctx = { beats, scenes, names: (Array.isArray(spec.scenes) ? spec.scenes : []).map((s) => s?.id), errors: [] };
  let out = setKey(spec, 'scenes', mapKeep(spec.scenes, (scene, i) => resolveScene(scene, pathJoin('scenes', i), ctx, scenes[i])));
  for (const key of ['audio', 'cues', 'captions']) {
    out = setKey(out, key, mapKeep(spec[key], (item, i) => resolveItem(item, pathJoin(key, i), ctx)));
  }
  if (ctx.errors.length) throw new BeatRefError(ctx.errors);
  return out;
}

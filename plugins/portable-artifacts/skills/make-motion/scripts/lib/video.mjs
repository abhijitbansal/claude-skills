// The `video` element, Node side: probe a clip with ffprobe, decode its trimmed range into a frame cache with ffmpeg,
// and plan its audio. The renderer shows cached frame i as an image, so every frame is exact and two renders hash the
// same. The cache is keyed by the file's hash, the range, the frame rate and the size, so a changed clip or field
// decodes again and an unchanged one never does.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { flattenElements } from '../../template/groups.mjs';
import { resolveAsset } from './paths.mjs';
import { probeVideo, fileSha256, decodeFrames, readCache } from './video-probe.mjs';

// What the cut-out tool also uses lives in video-probe.mjs (no template/ import); this file keeps its names for version 1.
export { VIDEO_EXTENSIONS, probeArgs, probeVideo, fileSha256, decodeArgs, decodeFrames, readCache } from './video-probe.mjs';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CACHE_ROOT = path.join(SKILL_ROOT, '.cache/video'); // gitignored; doctor --fix cache clears it
const CACHE_VERSION = 1; // salted into every cache key; bump it when the decode or the folder layout changes

export const isVideo = (el) => el?.type === 'video';
/** True when any scene holds a video element, at any group depth. */
export const specHasVideo = (spec) => (spec?.scenes ?? []).some((s) => flattenElements(s.elements).some(({ el }) => isVideo(el)));

/**
 * The cache folder name for one decode: sha256 hex of its inputs, in a fixed order, salted with CACHE_VERSION (bumped
 * whenever the decode or the folder layout changes) and the ffmpeg version (another build may decode differently).
 */
export function frameCacheKey({ sha256, trimStart, trimEnd, fps, width, height, fit, alpha, ffmpegVersion: version }) {
  const input = { v: CACHE_VERSION, ffmpegVersion: version, sha256, trimStart, trimEnd, fps, width, height, fit, alpha };
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

const versions = new Map();
/** The first line of `ffmpeg -version` ("ffmpeg version 8.1.1 …"), probed once per binary per process. */
export function ffmpegVersion(ffmpeg) {
  if (!versions.has(ffmpeg)) {
    const r = spawnSync(ffmpeg, ['-version'], { encoding: 'utf8' });
    versions.set(ffmpeg, r.status === 0 ? (r.stdout ?? '').split('\n')[0].trim() : 'unknown');
  }
  return versions.get(ffmpeg);
}

// Every video element of the spec with the scene it sits in: [{ el, scene, sceneStart }].
function videoElements(spec) {
  let start = 0;
  return spec.scenes.flatMap((scene) => {
    const sceneStart = start;
    start += scene.duration;
    return flattenElements(scene.elements).filter(({ el }) => isVideo(el)).map(({ el }) => ({ el, scene, sceneStart }));
  });
}

// The clip of element `el` as the validator accepted it: its absolute file, its probe and its trimmed range.
function clipOf(el, dir, ffprobe) {
  const { file, error } = resolveAsset(dir, el.src);
  if (error) throw new Error(`video "${el.id}": ${error}`);
  const info = probeVideo(ffprobe, file);
  if (info.error) throw new Error(`video "${el.id}": ffprobe cannot read ${el.src}: ${info.error}`);
  return { file, info, trimStart: el.trimStart ?? 0, trimEnd: el.trimEnd ?? info.duration };
}

/**
 * Decodes (or finds in the cache) the frames of every video element of `spec` at `fps`.
 * -> `{ [elementId]: { key, count, fps, ext } }`, served to the render page as /frames.json.
 */
export function prepareVideo(spec, dir, ffmpeg, ffprobe, fps) {
  if (!ffprobe) throw new Error('ffprobe not found (needed for video elements); it comes with ffmpeg');
  // The ids are the user's: Object.fromEntries makes each one an own key, "__proto__" and "constructor" included.
  return Object.fromEntries(videoElements(spec).map(({ el }) => {
    const { file, info, trimStart, trimEnd } = clipOf(el, dir, ffprobe);
    const opts = { trimStart, trimEnd, fps, width: Math.round(el.width), height: Math.round(el.height), fit: el.fit ?? 'contain', alpha: info.hasAlpha };
    const key = frameCacheKey({ sha256: fileSha256(file), ffmpegVersion: ffmpegVersion(ffmpeg), ...opts }); // the decoder follows from the file, which the key hashes
    const cacheDir = path.join(CACHE_ROOT, key);
    const ext = opts.alpha ? 'png' : 'jpg';
    const count = readCache(cacheDir, ext)?.count ?? decodeFrames(ffmpeg, { file, dir: cacheDir, ...opts, decoder: info.alphaDecoder }).count;
    return [el.id, { key, count, fps, ext }];
  }));
}

/**
 * The clip audio of every video element that has sound and is not muted, as mix tracks: it starts `offset` seconds
 * into its scene, plays the trimmed range, and is cut when its scene ends (the clip leaves the screen then, so its sound
 * never plays over the next scenes). `clipStart` skips into the file (trimStart).
 */
export function videoAudioTracks(spec, dir, ffprobe, total) {
  if (!specHasVideo(spec)) return [];
  return videoElements(spec).flatMap(({ el, scene, sceneStart }) => {
    if (el.mute) return [];
    const { file, info, trimStart, trimEnd } = clipOf(el, dir, ffprobe);
    if (!info.hasAudio) return [];
    const start = sceneStart + (el.offset ?? 0);
    const sceneEnd = Math.min(total, sceneStart + scene.duration);
    if (start >= sceneEnd) return [];
    const end = Math.min(sceneEnd, start + trimEnd - trimStart);
    return [{ file, start, end, volume: el.volume ?? 1, fadeIn: 0, fadeOut: 0, clipStart: trimStart }];
  });
}

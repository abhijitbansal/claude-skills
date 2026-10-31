// The `video` element, Node side: probe a clip with ffprobe, decode its trimmed range into a frame cache with ffmpeg,
// and plan its audio. The renderer shows cached frame i as an image, so every frame is exact and two renders hash the
// same. The cache is keyed by the file's hash, the range, the frame rate and the size, so a changed clip or field
// decodes again and an unchanged one never does.
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { flattenElements } from '../../template/groups.mjs';
import { resolveAsset } from './paths.mjs';
import { PROTOCOL_WHITELIST, fileInput } from './ffmpeg.mjs';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CACHE_ROOT = path.join(SKILL_ROOT, '.cache/video'); // gitignored; doctor --fix cache clears it
export { VIDEO_EXTENSIONS } from '../../template/media.mjs';
const ALPHA_PIX_FMT = /^(yuva|rgba|argb|bgra|gbrap)/;
const DONE = 'done.json';
const CACHE_VERSION = 1; // salted into every cache key; bump it when the decode or the folder layout changes
const MS = 1000;
const HASH_CHUNK = 1 << 20;
const FIT_SCALE = { contain: 'decrease', cover: 'increase' }; // `fill` scales to exactly W:H

export const isVideo = (el) => el?.type === 'video';
/** True when any scene holds a video element, at any group depth. */
export const specHasVideo = (spec) => (spec?.scenes ?? []).some((s) => flattenElements(s.elements).some(({ el }) => isVideo(el)));

const round3 = (n) => Math.round(n * MS) / MS;
const rate = (text) => {
  const [num, den] = String(text ?? '').split('/').map(Number);
  return den ? num / den : num;
};

/**
 * `{ duration, width, height, fps, hasAudio, hasAlpha }` of `file`'s first video stream, or `{ error }` when ffprobe
 * cannot read it or it has no video. `duration` is the video stream's (else the container's), rounded to ms.
 */
// ffprobe opens the clip through the file protocol only: no playlist renamed to .mp4 can make it fetch a URL.
export const probeArgs = (file) => ['-v', 'error', ...PROTOCOL_WHITELIST, '-show_streams', '-show_format', '-of', 'json', file];

export function probeVideo(ffprobe, file) {
  const r = spawnSync(ffprobe, probeArgs(file), { encoding: 'utf8' });
  if (r.status !== 0) return { error: (r.stderr ?? '').trim().split('\n')[0] || r.error?.message || `ffprobe exited ${r.status}` };
  let info;
  try { info = JSON.parse(r.stdout); } catch { return { error: 'ffprobe gave no readable answer' }; }
  const streams = info.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
  if (!video) return { error: 'no video stream' };
  const duration = Number(video.duration ?? info.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) return { error: 'unknown duration' };
  return {
    duration: round3(duration),
    width: video.width,
    height: video.height,
    fps: rate(video.avg_frame_rate) || rate(video.r_frame_rate),
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
    hasAlpha: ALPHA_PIX_FMT.test(video.pix_fmt ?? ''),
  };
}

/** sha256 hex of a file, read in chunks so a long clip is never held in memory whole. */
export function fileSha256(file) {
  const hash = createHash('sha256');
  const buf = Buffer.alloc(HASH_CHUNK);
  const fd = openSync(file, 'r');
  try {
    for (let n; (n = readSync(fd, buf, 0, HASH_CHUNK, null)) > 0;) hash.update(buf.subarray(0, n));
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}

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

export function decodeArgs({ file, trimStart, trimEnd, fps, width, height, fit, alpha, dir }) {
  const scale = FIT_SCALE[fit] ? `scale=${width}:${height}:force_original_aspect_ratio=${FIT_SCALE[fit]}` : `scale=${width}:${height}`;
  const output = alpha ? [path.join(dir, '%06d.png')] : ['-q:v', '1', path.join(dir, '%06d.jpg')];
  return ['-v', 'error', '-y', '-ss', String(trimStart), '-to', String(trimEnd), ...fileInput(file), '-vf', `fps=${fps},${scale}`, ...output];
}

const frameName = (n, ext) => `${String(n).padStart(6, '0')}.${ext}`;
const suffix = () => `${process.pid}-${randomBytes(4).toString('hex')}`;
const RENAME_TRIES = 3;

/**
 * `{ count }` when `dir` holds a whole decode in `ext`: a done.json whose count is a positive integer, and its first and
 * last frames on disk. Anything else (an interrupted decode, a damaged or hand-edited folder) is null: decode again.
 */
export function readCache(dir, ext) {
  let done;
  try { done = JSON.parse(readFileSync(path.join(dir, DONE), 'utf8')); } catch { return null; }
  const count = done?.count;
  if (!Number.isInteger(count) || count <= 0) return null;
  if (!existsSync(path.join(dir, frameName(1, ext))) || !existsSync(path.join(dir, frameName(count, ext)))) return null;
  return { count };
}

// Moves the finished `work` folder to `dir`. A whole decode already at `dir` (another render won the race, and may be
// serving it) is kept and `work` is dropped. An unfinished one is renamed aside first and removed only once replaced,
// so no folder is deleted while it could be in use.
function publish(work, dir, ext) {
  const stale = [];
  try {
    for (let attempt = 0; attempt < RENAME_TRIES; attempt++) {
      try {
        renameSync(work, dir);
        return;
      } catch (e) {
        if (e.code !== 'ENOTEMPTY' && e.code !== 'EEXIST') throw e;
      }
      if (readCache(dir, ext)) return;
      const aside = `${dir}.stale-${suffix()}`;
      try {
        renameSync(dir, aside);
        stale.push(aside);
      } catch (e) {
        if (e.code !== 'ENOENT') throw e; // ENOENT: another render moved it first; retry
      }
    }
    if (!readCache(dir, ext)) throw new Error(`could not put the decoded frames in place at ${dir}`);
  } finally {
    for (const folder of stale) rmSync(folder, { recursive: true, force: true }); // renamed aside: unused under that name
  }
}

/**
 * Decodes `file` from `trimStart` to `trimEnd` at `fps` into `dir` as 000001.jpg… (PNG when `alpha`), scaled to
 * width x height by `fit`. Writes into a private folder first, with `done.json` (`{ count }`) last, then puts it in
 * place (see publish), so a reader never sees a half-written cache and two renders decoding the same key at once do not
 * collide. -> `{ count }`.
 */
export function decodeFrames(ffmpeg, { dir, ...opts }) {
  const ext = opts.alpha ? 'png' : 'jpg';
  const work = `${dir}.partial-${suffix()}`;
  mkdirSync(work, { recursive: true });
  try {
    const r = spawnSync(ffmpeg, decodeArgs({ ...opts, dir: work }), { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`ffmpeg cannot decode ${opts.file}: ${(r.stderr ?? '').trim().split('\n')[0] || r.error?.message}`);
    const count = readdirSync(work).filter((f) => /^\d{6}\.(jpg|png)$/.test(f)).length;
    if (count === 0) throw new Error(`ffmpeg decoded no frames from ${opts.file} between ${opts.trimStart}s and ${opts.trimEnd}s`);
    writeFileSync(path.join(work, DONE), JSON.stringify({ count }));
    publish(work, dir, ext);
    return { count };
  } finally {
    rmSync(work, { recursive: true, force: true }); // gone already once published
  }
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
  const frames = {};
  for (const { el } of videoElements(spec)) {
    const { file, info, trimStart, trimEnd } = clipOf(el, dir, ffprobe);
    const opts = { trimStart, trimEnd, fps, width: Math.round(el.width), height: Math.round(el.height), fit: el.fit ?? 'contain', alpha: info.hasAlpha };
    const key = frameCacheKey({ sha256: fileSha256(file), ffmpegVersion: ffmpegVersion(ffmpeg), ...opts });
    const cacheDir = path.join(CACHE_ROOT, key);
    const ext = opts.alpha ? 'png' : 'jpg';
    const count = readCache(cacheDir, ext)?.count ?? decodeFrames(ffmpeg, { file, dir: cacheDir, ...opts }).count;
    frames[el.id] = { key, count, fps, ext };
  }
  return frames;
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

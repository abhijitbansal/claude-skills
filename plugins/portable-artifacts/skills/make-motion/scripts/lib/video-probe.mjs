// What the cut-out tool takes from a clip, Node side: probe it with ffprobe, hash it in chunks, and decode a trimmed range
// into numbered frames with ffmpeg. It imports nothing from version 1, so the tool and version 2 stand without it. (Version
// 1's `video` element, scripts/lib/video.mjs, built its frame cache on these; it was deleted at cut-over.)
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PROTOCOL_WHITELIST, fileInput } from './ffmpeg.mjs';

// The file extensions a clip may have (case-insensitive). The cut-out tool tells a clip from a photo by this list.
export const VIDEO_EXTENSIONS = Object.freeze(['mp4', 'mov', 'webm', 'm4v']);
const ALPHA_PIX_FMT = /^(yuva|rgba|argb|bgra|gbrap)/;
// A VP9 stream with alpha says pix_fmt yuv420p and carries the alpha as side data (tag alpha_mode=1) that only libvpx decodes:
// ffmpeg's own vp9 decoder drops it. cutout.mjs writes these.
const VP9_ALPHA_DECODER = 'libvpx-vp9';
const DONE = 'done.json';
const MS = 1000;
const HASH_CHUNK = 1 << 20;
const FIT_SCALE = { contain: 'decrease', cover: 'increase' }; // `fill` scales to exactly W:H

const round3 = (n) => Math.round(n * MS) / MS;
const rate = (text) => {
  const [num, den] = String(text ?? '').split('/').map(Number);
  return den ? num / den : num;
};

/**
 * `{ duration, width, height, fps, hasAudio, hasAlpha, alphaDecoder? }` of `file`'s first video stream, or `{ error }` when
 * ffprobe cannot read it or it has no video. `duration` is the video stream's (else the container's), rounded to ms.
 * `alphaDecoder` is the ffmpeg decoder to name (`-c:v`) to read the alpha of a stream that needs one, else absent.
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
  const vp9Alpha = video.codec_name === 'vp9' && video.tags?.alpha_mode === '1';
  return {
    duration: round3(duration),
    width: video.width,
    height: video.height,
    fps: rate(video.avg_frame_rate) || rate(video.r_frame_rate),
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
    hasAlpha: vp9Alpha || ALPHA_PIX_FMT.test(video.pix_fmt ?? ''),
    ...(vp9Alpha ? { alphaDecoder: VP9_ALPHA_DECODER } : {}),
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

export function decodeArgs({ file, trimStart, trimEnd, fps, width, height, fit, alpha, dir, decoder }) {
  const scale = FIT_SCALE[fit] ? `scale=${width}:${height}:force_original_aspect_ratio=${FIT_SCALE[fit]}` : `scale=${width}:${height}`;
  const output = alpha ? [path.join(dir, '%06d.png')] : ['-q:v', '1', path.join(dir, '%06d.jpg')];
  return ['-v', 'error', '-y', '-ss', String(trimStart), '-to', String(trimEnd), ...(decoder ? ['-c:v', decoder] : []), ...fileInput(file), '-vf', `fps=${fps},${scale}`, ...output];
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

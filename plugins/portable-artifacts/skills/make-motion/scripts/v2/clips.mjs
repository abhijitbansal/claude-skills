// Video clips a film names (the media kind's `src` of a clip, engine/kinds/media-clip.mjs). Each file is found inside the
// film's folder after its links are followed, probed by ffprobe before ffmpeg decodes it (an allow-list of containers,
// one video stream of an accepted codec, at most one audio stream of an accepted codec, no cover art, nothing else), and
// decoded once by ffmpeg into PNG frames at the film's fps over the range its shots use. Every ffmpeg and ffprobe call
// opens the file through the file protocol, the clip demuxers and the accepted decoders only (clipInput): ffprobe's own
// analysis opens a decoder per stream, and one off the list is refused there, so it never runs on the file's bytes. The server serves those frames by index
// (/clip/<k>/<n>); a shot's sound is cut from the clip to the shot's length and mixed under the voice unless `muted`.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { findFfmpeg, findFfprobe } from './render.mjs';
import { SpecError } from './spec.mjs';
import { fileInside, CLIP_FRAME_PATTERN } from './server.mjs';
import { isClipSrc, clipFrameIndex } from '../../engine/kinds/media-clip.mjs';

export { isClipSrc, clipFrameIndex };

/** The demuxers a clip may be opened with (ffmpeg names): MP4, MOV and M4V (the mov demuxer), WebM and MKV (matroska). */
export const CLIP_DEMUXERS = Object.freeze(['mov', 'mp4', 'm4a', 'matroska', 'webm']);
const CLIP_FORMATS = new Set(['mov,mp4,m4a,3gp,3g2,mj2', 'matroska,webm']); // as ffprobe reports them
export const VIDEO_CODECS = Object.freeze(['h264', 'hevc', 'vp8', 'vp9', 'av1', 'mpeg4', 'prores']);
export const AUDIO_CODECS = Object.freeze(['aac', 'mp3', 'opus', 'vorbis', 'flac', 'alac', 'pcm_s16le', 'pcm_s24le']);
const CONTAINERS_LABEL = 'MP4, MOV, M4V, WebM or MKV';
export const MAX_CLIP_SIDE = 4096; // px of a clip's frame
export const MAX_CLIP_SECONDS = 60; // of one file that a film uses
export const MAX_CLIPS = 8; // distinct clip files in a film
const END_TOLERANCE = 0.05; // s: an out this close past the clip's end is its end
const RUN_TIMEOUT_MS = 300_000;
const PROBE_TIMEOUT_MS = 10_000;
const MAX_BUFFER = 1024 * 1024;
const SILENCE_PEAK = 10; // of 32767: a clip's sound that never reaches about -70 dBFS is silence, and is left out
const WHITELIST_REFUSAL = /Codec \([^)]*\) not on whitelist/; // what libavcodec logs when a decoder is off the codec whitelist (a format off its own list says "Format … not on whitelist")
const FFMPEG_HINT ='install ffmpeg with its ffprobe (they come together), or set FFMPEG_PATH and FFPROBE_PATH';

/**
 * The decoders a clip may be read with (ffmpeg's decoder names, which are not always the codec's: mp3 is decoded by
 * "mp3float", AV1 by "libdav1d"): the ones ffmpeg picks for the accepted codecs. ffprobe opens a decoder for every stream
 * while it analyses a file, so this list is what keeps a decoder outside it from running on a clip's bytes at all.
 */
export const CLIP_DECODERS = Object.freeze(['h264', 'hevc', 'vp8', 'libvpx', 'vp9', 'libvpx-vp9', 'av1', 'libdav1d', 'libaom-av1', 'mpeg4', 'prores',
  'aac', 'aac_fixed', 'mp3', 'mp3float', 'opus', 'libopus', 'vorbis', 'libvorbis', 'flac', 'alac', 'pcm_s16le', 'pcm_s24le']);

/** A clip as an ffmpeg or ffprobe input: the file protocol only, the clip demuxers only, and the accepted decoders only. */
export const clipInput = (file) => ['-protocol_whitelist', 'file', '-format_whitelist', CLIP_DEMUXERS.join(','), '-codec_whitelist', CLIP_DECODERS.join(','), '-i', file];

function run(binary, args, { signal, timeout = RUN_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { encoding: 'utf8', timeout, killSignal: 'SIGKILL', maxBuffer: MAX_BUFFER, signal }, (err, stdout, stderr) => {
      if (err?.name === 'AbortError') return reject(err);
      return resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout, stderr, killed: err?.killed === true });
    });
  });
}

async function tools() {
  const ffmpeg = await findFfmpeg();
  const ffprobe = findFfprobe({ ffmpeg });
  if (ffprobe === null) throw Object.assign(new Error('ffprobe not found: it is needed to check a video clip before it is used'), { hint: FFMPEG_HINT });
  return { ffmpeg, ffprobe };
}

const lastLine = (text) => text.trim().split('\n').at(-1) ?? '';

/**
 * What ffprobe reads of a clip: { format, duration, width, height, codec, audio, audioCodec, streams: [{ type, codec,
 * index, attachedPic }], videoIndex }, or { format: null, error } when it does not open (a format off the list, a file that
 * is not a clip), with `codecRefused` when ffprobe stopped at a stream whose decoder is not on the list.
 */
export async function probeClip({ file, ffprobe, signal }) {
  const binary = ffprobe ?? (await tools()).ffprobe;
  const args = ['-v', 'error', '-show_entries', 'format=format_name,duration:stream=index,codec_type,codec_name,width,height:stream_disposition=attached_pic', '-of', 'json', ...clipInput(file)];
  const result = await run(binary, args, { signal, timeout: PROBE_TIMEOUT_MS });
  if (result.killed) throw Object.assign(new Error(`ffprobe did not finish reading ${path.basename(file)}`), { hint: FFMPEG_HINT });
  if (result.code !== 0) return { format: null, error: lastLine(result.stderr).replace(`${file}: `, '') || `ffprobe exited ${result.code}`, codecRefused: WHITELIST_REFUSAL.test(result.stderr) };
  const parsed = JSON.parse(result.stdout);
  const streams = (parsed.streams ?? []).map((s) => ({ index: s.index, type: s.codec_type, codec: s.codec_name, width: s.width, height: s.height, attachedPic: s.disposition?.attached_pic === 1 }));
  const video = streams.find((s) => s.type === 'video' && !s.attachedPic);
  const audio = streams.find((s) => s.type === 'audio');
  return { format: parsed.format?.format_name ?? null, duration: Number(parsed.format?.duration), width: video?.width, height: video?.height, codec: video?.codec, audio: audio !== undefined, audioCodec: audio?.codec, streams, videoIndex: video?.index };
}

/** Why a probed clip cannot be used, or null. The message follows the clip's src. */
export function clipProblem(probe) {
  if (probe.codecRefused === true) return `has a stream whose codec is not one of the accepted codecs (video: ${VIDEO_CODECS.join(', ')}; sound: ${AUDIO_CODECS.join(', ')}); a clip holds one video stream and at most one audio stream, and cover art is a video stream`;
  if (probe.error !== undefined) return `cannot be read as a clip (${probe.error}); a clip must be ${CONTAINERS_LABEL}, a format not on the list of clip containers is refused`;
  if (!CLIP_FORMATS.has(probe.format)) return `is in the "${probe.format}" format, not on the list of clip containers (${CONTAINERS_LABEL})`;
  if (probe.streams.some((s) => s.attachedPic)) return 'has an attached picture (cover art); a clip holds one video stream and at most one audio stream';
  const videos = probe.streams.filter((s) => s.type === 'video');
  if (videos.length !== 1) return videos.length === 0 ? 'has no video stream' : `has ${videos.length} video streams; a clip must have one`;
  if (!VIDEO_CODECS.includes(probe.codec)) return `has ${probe.codec} video, which is not one of: ${VIDEO_CODECS.join(', ')}`;
  const audios = probe.streams.filter((s) => s.type === 'audio');
  if (audios.length > 1) return `has ${audios.length} audio streams; a clip may have one`;
  if (probe.audio && !AUDIO_CODECS.includes(probe.audioCodec)) return `has ${probe.audioCodec} sound, which is not one of: ${AUDIO_CODECS.join(', ')}`;
  const other = probe.streams.find((s) => s.type !== 'video' && s.type !== 'audio');
  if (other !== undefined) return `has a ${other.type ?? 'data'} stream; a clip holds one video stream and at most one audio stream`;
  if (!(probe.width > 0 && probe.height > 0) || probe.width > MAX_CLIP_SIDE || probe.height > MAX_CLIP_SIDE) return `is ${probe.width}x${probe.height}; a clip's frame may be at most ${MAX_CLIP_SIDE} px a side`;
  if (!Number.isFinite(probe.duration) || probe.duration <= 0) return 'has no length ffmpeg can read';
  return null;
}

/** The clips a film names, by src in first-seen order: { src, uses: [{ index, in, out, muted }] }. */
export function clipUses(film) {
  const bySrc = new Map();
  film.shots.forEach((shot, index) => {
    if (shot.show !== 'media' || !isClipSrc(shot.src)) return;
    if (!bySrc.has(shot.src)) bySrc.set(shot.src, { src: shot.src, uses: [] });
    bySrc.get(shot.src).uses.push({ index, in: shot.in, out: shot.out, muted: shot.muted === true });
  });
  return [...bySrc.values()];
}

const filmError = (index, field, message) => new SpecError([{ path: `shots[${index}].${field}`, message }]);
const even = (v) => Math.max(2, Math.round(v / 2) * 2);

// The frame size a clip is decoded at: its own, or scaled down to fit the canvas's long side (never up), even sides.
function decodedSize(probe, canvas) {
  const scale = Math.min(1, Math.max(canvas.w, canvas.h) / Math.max(probe.width, probe.height));
  return scale === 1 ? [probe.width, probe.height] : [even(probe.width * scale), even(probe.height * scale)];
}

// The range of the file the shots use, [from, to], each use checked against the clip's length.
function usedRange(entry, duration) {
  for (const use of entry.uses) {
    const start = use.in ?? 0;
    if (start >= duration) throw filmError(use.index, 'in', `starts at ${start} s, past the clip's end (${duration.toFixed(1)} s)`);
    if ((use.out ?? duration) > duration + END_TOLERANCE) throw filmError(use.index, 'out', `ends at ${use.out} s, past the clip's end (${duration.toFixed(1)} s)`);
  }
  const from = Math.min(...entry.uses.map((u) => u.in ?? 0));
  const to = Math.min(duration, Math.max(...entry.uses.map((u) => u.out ?? duration)));
  if (to - from > MAX_CLIP_SECONDS) throw filmError(entry.uses[0].index, 'src', `uses ${(to - from).toFixed(1)} s of the clip; a film may use at most ${MAX_CLIP_SECONDS} s of one clip: trim it with in and out`);
  return [from, to];
}

// `stream`: the index of the probed video stream, mapped by that index (never "the first video", which could be a picture).
async function decode({ ffmpeg, file, stream, from, to, fps, size, dir, signal }) {
  mkdirSync(dir, { recursive: true });
  const args = ['-nostdin', '-v', 'error', '-y', '-ss', String(from), '-t', String(to - from), ...clipInput(file), '-map', `0:${stream}`, '-an', '-sn', '-dn',
    '-vf', `fps=${fps},scale=${size[0]}:${size[1]}:flags=bicubic,format=rgb24`, '-start_number', '1', '-f', 'image2', '-c:v', 'png', path.join(dir, CLIP_FRAME_PATTERN)];
  const result = await run(ffmpeg, args, { signal });
  if (result.code !== 0) throw Object.assign(new Error(`ffmpeg could not decode the clip ${path.basename(file)}: ${lastLine(result.stderr)}`), { hint: FFMPEG_HINT });
  const count = readdirSync(dir).filter((f) => f.endsWith('.png')).length;
  if (count === 0) throw new Error(`ffmpeg decoded no frame of the clip ${path.basename(file)}`);
  return count;
}

// The real path of a clip src inside the film's folder, or the film's error at that shot's src.
function clipFile(specDir, entry) {
  const root = realpathSync(specDir);
  const file = path.isAbsolute(entry.src) ? null : fileInside(root, path.resolve(root, entry.src));
  if (file === null || !isClipSrc(file)) throw filmError(entry.uses[0].index, 'src', `${JSON.stringify(entry.src)} is not a clip file inside the film's folder`);
  return file;
}

// ---- the frame cache: <out dir>/.clips/<key>/, beside the voice cache (<out dir>/.voice/) ----------------------------

const CACHE_VERSION = 1; // salted into every key; bump it when the decode or the folder layout changes
export const CLIP_CACHE_MAX_BYTES = 2 * 1024 ** 3; // the whole .clips folder; the oldest entries go first
const DONE = 'done.json';

function fileHash(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file).on('error', reject).on('data', (chunk) => hash.update(chunk)).on('end', () => resolve(hash.digest('hex')));
  });
}

// The entry's frame count when it is whole (its done marker names the key and as many frames as the folder holds).
function readDone(dir, key) {
  try {
    const done = JSON.parse(readFileSync(path.join(dir, DONE), 'utf8'));
    const count = readdirSync(dir).filter((f) => f.endsWith('.png')).length;
    return done.key === key && Number.isInteger(done.count) && done.count > 0 && done.count === count ? count : null;
  } catch (err) {
    if (err.code === 'ENOENT' || err instanceof SyntaxError) return null;
    throw err;
  }
}

const folderBytes = (dir) => readdirSync(dir).reduce((sum, f) => sum + statSync(path.join(dir, f)).size, 0);

// Keeps the cache under `maxBytes`: the entries least recently used go first, never the one in use.
function pruneCache(cacheDir, keep, maxBytes) {
  const entries = readdirSync(cacheDir).filter((f) => !f.startsWith('.')).map((name) => {
    const dir = path.join(cacheDir, name);
    return { name, dir, bytes: folderBytes(dir), used: statSync(dir).mtimeMs };
  }).sort((a, b) => b.used - a.used);
  let total = entries.reduce((sum, e) => sum + e.bytes, 0);
  for (const e of entries.slice().reverse()) {
    if (total <= maxBytes) break;
    if (e.name === keep) continue;
    rmSync(e.dir, { recursive: true, force: true });
    total -= e.bytes;
  }
}

// The clip's frames for this decode, from the cache when an entry with the same key is whole, else decoded into a
// temporary folder and moved into place. The key holds the file's content hash, the range, the fps, the size, the
// ffmpeg version and CACHE_VERSION, so a changed clip or new trims never reuse frames.
async function cachedDecode({ ffmpeg, version, file, stream, from, to, fps, size, cacheDir, maxBytes, signal }) {
  const key = createHash('sha256').update(JSON.stringify({ v: CACHE_VERSION, sha256: await fileHash(file), from, to, fps, size, version })).digest('hex');
  const dir = path.join(cacheDir, key);
  const hit = readDone(dir, key);
  if (hit !== null) {
    const now = new Date(); // the entry's last use, for pruning (never reaches a frame)
    utimesSync(dir, now, now);
    pruneCache(cacheDir, key, maxBytes);
    return { dir, count: hit, cached: true };
  }
  const tmp = path.join(cacheDir, `.partial-${key}-${process.pid}`);
  rmSync(tmp, { recursive: true, force: true });
  const count = await decode({ ffmpeg, file, stream, from, to, fps, size, dir: tmp, signal });
  writeFileSync(path.join(tmp, DONE), JSON.stringify({ key, count }));
  rmSync(dir, { recursive: true, force: true });
  renameSync(tmp, dir);
  pruneCache(cacheDir, key, maxBytes);
  return { dir, count, cached: false };
}

async function ffmpegVersion(ffmpeg, signal) {
  return lastLine((await run(ffmpeg, ['-version'], { signal, timeout: PROBE_TIMEOUT_MS })).stdout.split('\n')[0] ?? '');
}

/**
 * Probes every clip the film names and gets its frames from the cache in `cacheDir` (<out dir>/.clips, made here),
 * decoding them when the cache has no whole entry. -> [{ src, file, dir, count, width, height, from, fps, audio,
 * duration, cached }], same order as clipUses. A clip that is the film's to fix (outside the folder, off the lists, an in
 * or out past its end) is a SpecError at that shot's field; ffmpeg trouble throws.
 */
export async function prepareClips({ film, specDir, timeline, cacheDir, canvas, signal, maxCacheBytes = CLIP_CACHE_MAX_BYTES }) {
  const entries = clipUses(film);
  if (entries.length === 0) return [];
  if (entries.length > MAX_CLIPS) throw filmError(entries[MAX_CLIPS].uses[0].index, 'src', `a film may use at most ${MAX_CLIPS} clip files; this one names ${entries.length}`);
  const { ffmpeg, ffprobe } = await tools();
  const version = await ffmpegVersion(ffmpeg, signal);
  mkdirSync(cacheDir, { recursive: true });
  const clips = [];
  for (const [k, entry] of entries.entries()) {
    const file = clipFile(specDir, entry);
    const probe = await probeClip({ file, ffprobe, signal });
    const problem = clipProblem(probe);
    if (problem !== null) throw filmError(entry.uses[0].index, 'src', `${JSON.stringify(entry.src)} ${problem}`);
    const [from, to] = usedRange(entry, probe.duration);
    const size = decodedSize(probe, canvas);
    const { dir, count, cached } = await cachedDecode({ ffmpeg, version, file, stream: probe.videoIndex, from, to, fps: timeline.fps, size, cacheDir, maxBytes: maxCacheBytes, signal });
    clips.push({ src: entry.src, file, dir, count, width: size[0], height: size[1], from, fps: timeline.fps, audio: probe.audio, duration: probe.duration, cached });
  }
  return clips;
}

// The highest absolute 16-bit sample of a WAV we wrote (its data chunk found by name).
function wavPeak(file) {
  const bytes = readFileSync(file);
  let at = 12;
  while (at + 8 <= bytes.length && bytes.toString('latin1', at, at + 4) !== 'data') at += 8 + bytes.readUInt32LE(at + 4);
  let peak = 0;
  for (let i = at + 8; i + 1 < bytes.length; i += 2) peak = Math.max(peak, Math.abs(bytes.readInt16LE(i)));
  return peak;
}

/**
 * The film's clip sound as extra tracks for the mix (run.mjs soundFiles): one per shot that shows a clip with sound and is
 * not `muted`, cut from its in for the shot's length (to its out), at the shot's start on `timeline`. Silence is left out.
 */
export async function clipAudioTracks({ clips, film, timeline, work, signal }) {
  const { ffmpeg } = await tools();
  const tracks = [];
  for (const [index, shot] of film.shots.entries()) {
    const clip = shot.show === 'media' && !shot.muted ? clips.find((c) => c.src === shot.src) : undefined;
    if (!clip?.audio) continue;
    const start = shot.in ?? 0;
    const seconds = Math.min(timeline.shots[index].duration, (shot.out ?? clip.duration) - start);
    const out = path.join(work, `clip-sound-${index}.wav`);
    const args = ['-nostdin', '-v', 'error', '-y', '-ss', String(start), '-t', String(seconds), ...clipInput(clip.file), '-map', '0:a:0', '-vn', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', '-map_metadata', '-1', '-fflags', '+bitexact', '-f', 'wav', out];
    const result = await run(ffmpeg, args, { signal });
    if (result.code !== 0) throw Object.assign(new Error(`ffmpeg could not cut the sound of ${shot.src}: ${lastLine(result.stderr)}`), { hint: FFMPEG_HINT });
    if (wavPeak(out) > SILENCE_PEAK) tracks.push({ file: out, recording: true, fadeFrom: null, at: timeline.shots[index].start });
  }
  return tracks;
}

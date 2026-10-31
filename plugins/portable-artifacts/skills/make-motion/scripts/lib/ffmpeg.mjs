import { spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import path from 'node:path';
import { doctorCommand, npmInstallFfmpegStatic } from './doctor-hint.mjs';

const HINT = 'ffmpeg not found. Install it (macOS: brew install ffmpeg; Windows: winget install Gyan.FFmpeg; Debian/Ubuntu: sudo apt-get install ffmpeg), '
  + `or set FFMPEG_PATH, or run: ${npmInstallFfmpegStatic()} `
  + `(doctor: ${doctorCommand()}, id ffmpeg)`;

const isExecutable = (p) => {
  try { accessSync(p, constants.X_OK); return true; } catch { return false; }
};

// $FFMPEG_PATH, then PATH, then an optionally installed ffmpeg-static.
export async function findFfmpeg({ skipStatic = false } = {}) {
  const fromEnv = process.env.FFMPEG_PATH;
  if (fromEnv && isExecutable(fromEnv)) return fromEnv;
  if (fromEnv) process.stderr.write(`warning: FFMPEG_PATH is set to "${fromEnv}" but it is not executable; looking elsewhere\n`);
  const probe = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  if (!probe.error && probe.status === 0) {
    const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['ffmpeg'], { encoding: 'utf8' });
    return which.status === 0 ? which.stdout.split('\n')[0].trim() : 'ffmpeg';
  }
  if (!skipStatic) {
    try {
      const mod = await import('ffmpeg-static');
      const p = mod.default ?? mod;
      if (typeof p === 'string' && isExecutable(p)) return p;
    } catch { /* optional dependency not installed */ }
  }
  throw new Error(HINT);
}

// $FFPROBE_PATH, then the ffprobe beside ffmpeg (`ffmpeg`, else $FFMPEG_PATH: the pair that belongs
// together), then ffprobe on PATH; null when none.
export function findFfprobe({ ffmpeg } = {}) {
  const fromEnv = process.env.FFPROBE_PATH;
  if (fromEnv && isExecutable(fromEnv)) return fromEnv;
  if (fromEnv) process.stderr.write(`warning: FFPROBE_PATH is set to "${fromEnv}" but it is not executable; looking elsewhere\n`);
  const beside = ffmpeg ?? process.env.FFMPEG_PATH;
  if (beside && /[\\/]/.test(beside)) { // a bare `ffmpeg` has no folder to look in
    const sibling = path.join(path.dirname(beside), 'ffprobe');
    if (isExecutable(sibling)) return sibling;
  }
  return spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0 ? 'ffprobe' : null;
}

const VIDEO_INPUT = (fps) => ['-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-'];
const VIDEO_CODEC = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
const AUDIO_CODEC = ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2']; // always stereo: amix follows the first input's layout
const MS_PER_SECOND = 1000;
const PROBE_SECONDS = '0.1';
// amix adopts the first input's rate and layout, so every track is normalised first;
// without this a mono 24 kHz voice listed first collapses stereo music to mono 24 kHz.
const AFORMAT = 'aformat=sample_rates=48000:channel_layouts=stereo';
const PREFLIGHT_VIDEO = (fps) => `color=s=16x16:r=${fps}:d=${PROBE_SECONDS}`;

// A user file (audio track, video clip) as an ffmpeg input that may only be read through the file or pipe protocol:
// ffmpeg sniffs content, so a playlist renamed to .mp3 or .mp4 must not make it fetch a URL. The offline guarantee.
export const PROTOCOL_WHITELIST = ['-protocol_whitelist', 'file,pipe'];
export const fileInput = (file) => [...PROTOCOL_WHITELIST, '-i', file];

// Round to ms so float noise (1.3000000000000003) never reaches a filter graph.
const sec = (n) => String(Math.round(n * MS_PER_SECOND) / MS_PER_SECOND);

// One track -> trim to its clip, gain, fades, then delay to its absolute start. `end` is the fade-out anchor.
// `clipStart` (a video element's trimStart) first skips that far into the file.
function trackChain(track, index) {
  const length = track.end - track.start;
  const skip = track.clipStart > 0 ? [`atrim=start=${sec(track.clipStart)}`, 'asetpts=PTS-STARTPTS'] : [];
  const steps = [...skip, AFORMAT, `atrim=end=${sec(length)}`, `volume=${sec(track.volume)}`];
  if (track.fadeIn > 0) steps.push(`afade=t=in:st=0:d=${sec(track.fadeIn)}`);
  if (track.fadeOut > 0) steps.push(`afade=t=out:st=${sec(Math.max(0, length - track.fadeOut))}:d=${sec(track.fadeOut)}`);
  steps.push(`adelay=${Math.round(track.start * MS_PER_SECOND)}:all=1`);
  return `[${index + 1}:a]${steps.join(',')}[a${index}]`;
}

function audioGraph(audio) {
  const chains = audio.map(trackChain);
  if (audio.length === 1) return { graph: chains[0], label: '[a0]' };
  const labels = audio.map((_, i) => `[a${i}]`).join('');
  return { graph: `${chains.join(';')};${labels}amix=inputs=${audio.length}:duration=longest:normalize=0[aout]`, label: '[aout]' };
}

// `audio`: resolveAudio() output plus an absolute `file` per track. `duration` caps the MP4 at the video length.
const metadataArgs = (m = {}) => Object.entries(m).filter(([, v]) => v).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]);

// `quality`: "final" (the default: the arguments are exactly those of a call without it) or "draft" (a faster, smaller encode).
export const QUALITIES = ['draft', 'final'];
const DRAFT_CODEC = ['-crf', '30', '-preset', 'veryfast'];

// A draft is half the size on each side, rounded down to even (yuv420p needs even sides), and never under the 16 px
// minimum side that --size accepts.
const DRAFT_MIN_SIDE = 16;
export const draftSize = (size) => size.map((n) => Math.max(DRAFT_MIN_SIDE, 2 * Math.floor(n / 4)));

// `metadata`: { comment?, artist? } written into the MP4 container tags.
export function encodeArgs({ fps, out, audio = [], duration, metadata, quality = 'final' }) {
  if (!QUALITIES.includes(quality)) throw new Error(`encodeArgs: quality must be "draft" or "final" (got ${JSON.stringify(quality)})`);
  const videoCodec = quality === 'draft' ? [...VIDEO_CODEC, ...DRAFT_CODEC] : VIDEO_CODEC;
  if (audio.length === 0) return [...VIDEO_INPUT(fps), ...videoCodec, ...metadataArgs(metadata), out];
  if (!Number.isFinite(duration)) throw new Error('encodeArgs: duration is required when audio tracks are given');
  const { graph, label } = audioGraph(audio);
  return [...VIDEO_INPUT(fps), ...audio.flatMap((t) => fileInput(t.file)), '-filter_complex', graph,
    '-map', '0:v', '-map', label, ...videoCodec, ...AUDIO_CODEC, '-t', sec(duration), ...metadataArgs(metadata), out];
}

// The real mix graph against a lavfi video stand-in, discarded after PROBE_SECONDS: proves the
// installed ffmpeg accepts every filter and option before a single frame is captured.
export function preflightArgs({ fps, audio }) {
  const { graph, label } = audioGraph(audio);
  return ['-v', 'error', '-f', 'lavfi', '-i', PREFLIGHT_VIDEO(fps), ...audio.flatMap((t) => fileInput(t.file)),
    '-filter_complex', graph, '-map', '0:v', '-map', label, '-t', PROBE_SECONDS, '-f', 'null', '-'];
}

function firstStderrLine(r) {
  if (r.status === 0) return null;
  return (r.stderr ?? '').split('\n').find((l) => l.trim()) ?? r.error?.message ?? `ffmpeg exited ${r.status}`;
}

const LOUDNESS_FILTER = 'ebur128=peak=true';
const dbValue = (text) => (text === '-inf' ? -Infinity : Number(text));

/** { lufs, truePeak } from an ffmpeg `ebur128` summary on stderr (-Infinity for silence), or null when it has none. */
export function parseLoudness(stderr) {
  const lufs = [...stderr.matchAll(/\bI:\s+(-?[\d.]+|-inf) LUFS/g)].at(-1);
  const peak = [...stderr.matchAll(/True peak:\s+Peak:\s+(-?[\d.]+|-inf) dBFS/g)].at(-1);
  return lufs && peak ? { lufs: dbValue(lufs[1]), truePeak: dbValue(peak[1]) } : null;
}

// Integrated loudness and true peak of `file`'s first audio stream; null when ffmpeg cannot measure it. A report, not a gate.
export function measureLoudness(ffmpegPath, file) {
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-nostats', '-i', file, '-map', '0:a:0', '-af', LOUDNESS_FILTER, '-f', 'null', '-'], { encoding: 'utf8' });
  return r.status === 0 ? parseLoudness(r.stderr ?? '') : null;
}

// null when ffmpeg accepts the mix graph, else the first stderr line. `args` overrides for tests.
export function probeGraph(ffmpegPath, plan, args = preflightArgs(plan)) {
  return firstStderrLine(spawnSync(ffmpegPath, args, { encoding: 'utf8' }));
}

export const probeAudioArgs = (file) => ['-v', 'error', ...fileInput(file), '-map', '0:a:0', '-t', PROBE_SECONDS, '-f', 'null', '-'];

// null when ffmpeg can decode the start of `file`'s first audio stream, else the first stderr line.
// Mapping 0:a:0 makes a video-only or image file fail here instead of after every frame is captured.
export function probeAudio(ffmpegPath, file) {
  const args = probeAudioArgs(file);
  return firstStderrLine(spawnSync(ffmpegPath, args, { encoding: 'utf8' }));
}

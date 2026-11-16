// Render a film to an H.264 yuv420p MP4. The page draws each frame (post pass included); a screenshot of it goes to
// ffmpeg on a pipe. Two capture modes: `exact` takes PNG (lossless: tests, sheets, --exact) and the default `fast`
// takes JPEG at quality 98 (a grainy frame costs far less to encode as JPEG). A frame whose __stateKey equals the
// previous frame's is not captured again: the previous picture is sent twice. The video is written to a partial file
// beside the output and renamed when ffmpeg is done, so a stop or a failure leaves no half-written MP4 behind.
// A film's sound (voice/master.mjs: its narration, and the cues and music bed of the run's sound plan) is mixed, mastered
// and encoded to AAC before the first frame is captured, so a broken audio chain or a level the film would be refused
// for fails fast; after the video encode the AAC is muxed into a second partial file, both streams copied, and only that
// file is renamed to the output. A film with neither a voice nor sound
// takes none of those steps: its video is exactly what it was before.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { findFfmpeg } from '../lib/ffmpeg.mjs';
import { registries } from '../../engine/registry.mjs';
import '../../engine/modes/index.mjs'; // registers the modes whose loudness a voiced film is mastered to
import { loadFilm } from './pipeline.mjs';
import { openSession } from './session.mjs';

// The voice steps, loaded only for a voiced film: a silent film imports nothing of the voice (nor version 1's loudness
// module, which brings its whole spec validator, about 200 ms of loading measured on the dev machine).
const voiceSteps = () => import('./voice/master.mjs');

export const JPEG_QUALITY = 98;
const HELD_CHUNK = 150; // frames whose held flags are fetched in one page.evaluate
const MS_PER_SECOND = 1000;
const BITS_PER_BYTE = 8;
const MEGA = 1e6;
const STDERR_KEEP = 4000;
const STDERR_LINES = 5;
const PARTIAL_MAX_AGE_MS = 60 * 60 * 1000;
const PARTIAL_RE = /^\..+\.partial-\d+\.mp4$/;
const QUIET = ['-hide_banner', '-loglevel', 'error'];
const DEFAULT_MODE = 'pro'; // as the timeline's (engine/script/timing.mjs)

// A JPEG decodes to full-range YUV; the video is limited-range yuv420p like every other, so scale between the two.
const JPEG_RANGE_FILTER = ['-vf', 'scale=in_range=pc:out_range=tv'];

// The encoder settings, chosen by measurement (see the report of task 12, round 4): libx264 at crf 23 with `-tune film`
// keeps the look's grain (about 85% of its high-pass energy on flat paper) at a size that a 20 s 1080p desk film fits in
// under 20 MB; the version 1 default (no -crf, so crf 23 with no tune) gave 28 Mbit/s on grain at 0.05.
export const ENCODER = Object.freeze({ preset: 'medium', crf: 23, tune: 'film' });

/**
 * The ffmpeg arguments for frames on a pipe: PNG frames (exact) or JPEG frames (fast: scaled from full to limited
 * range, since a JPEG decodes to full-range YUV) into H.264 yuv420p. Built here rather than from the version 1 helper,
 * which cannot express a crf or a tune.
 */
export function encoderArgs({ fps, out, exact }) {
  const input = ['-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', exact ? 'png' : 'mjpeg', '-i', '-', ...(exact ? [] : JPEG_RANGE_FILTER)];
  const video = ['-c:v', 'libx264', '-preset', ENCODER.preset, '-crf', String(ENCODER.crf), '-tune', ENCODER.tune, '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
  return [...input, ...video, out];
}

// A promise that rejects when `signal` aborts (never settles without one); a stalled ffmpeg must not hold a stop request.
function abortion(signal) {
  const promise = new Promise((_, reject) => {
    if (!signal) return;
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  promise.catch(() => {}); // it is only ever raced: an abort nobody is waiting on is not an unhandled rejection
  return promise;
}

// An ffmpeg process with a promise for its end and a write() that waits for the pipe, fails when ffmpeg has died and
// gives way to `signal`. Its failures carry the last STDERR_LINES lines ffmpeg said.
function startEncoder(ffmpeg, args, signal) {
  const child = spawn(ffmpeg, args, { stdio: ['pipe', 'ignore', 'pipe'] });
  const aborted = abortion(signal);
  let stderr = '';
  let failure = null;
  let exitCode = null; // set once the process has ended
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-STDERR_KEEP); });
  child.stdin.on('error', (err) => { failure ??= err; });
  const ended = new Promise((resolve) => {
    child.on('error', (err) => { failure ??= err; exitCode = -1; resolve(-1); });
    child.on('close', (code) => { exitCode = code; resolve(code); });
  });
  const said = () => stderr.trim().split('\n').filter(Boolean).slice(-STDERR_LINES).join(' | ');
  const fail = (code) => new Error(`ffmpeg failed (${failure?.message ?? `exit ${code}`}): ${said()}`);
  return {
    async write(buffer) {
      signal?.throwIfAborted();
      if (!failure && exitCode === null && !child.stdin.write(buffer)) {
        await Promise.race([new Promise((resolve) => child.stdin.once('drain', resolve)), ended, aborted]); // neither a dying nor a stalled ffmpeg may hold this
      }
      if (failure || exitCode !== null) throw fail(exitCode);
    },
    async finish() {
      child.stdin.end();
      const code = await Promise.race([ended, aborted]);
      if (code !== 0 || failure) throw fail(code);
    },
    async stop() {
      child.kill('SIGKILL');
      await ended;
    },
  };
}

// A video that was being written when a run was killed leaves `.<name>.partial-<pid>.mp4` beside the output; those older
// than an hour belong to no live run and are removed.
export function sweepPartials(dir, { olderThanMs = PARTIAL_MAX_AGE_MS, now = Date.now() } = {}) {
  if (!existsSync(dir)) return [];
  const stale = readdirSync(dir).filter((name) => PARTIAL_RE.test(name) && now - statSync(path.join(dir, name)).mtimeMs > olderThanMs);
  for (const name of stale) rmSync(path.join(dir, name), { force: true });
  return stale;
}

// Which of frames from..to equal their predecessor under the capture key.
const heldChunk = (page, from, to) => page.evaluate(([a, b]) => window.__heldFlags(a, b, true), [from, to]);

async function capture(page, exact) {
  return page.screenshot(exact ? { type: 'png' } : { type: 'jpeg', quality: JPEG_QUALITY });
}

async function encodeFrames({ session, encoder, exact, signal, onProgress }) {
  const { page, timeline } = session;
  const frames = timeline.frameCount;
  let previous = null;
  let captured = 0;
  for (let from = 0; from < frames; from += HELD_CHUNK) {
    const to = Math.min(frames, from + HELD_CHUNK) - 1;
    const held = await heldChunk(page, from, to);
    for (let k = 0; k < held.length; k++) {
      signal?.throwIfAborted();
      if (previous === null || !held[k]) {
        await page.evaluate((i) => window.__seek(i), from + k);
        previous = await capture(page, exact);
        captured++;
      }
      await encoder.write(previous);
      onProgress?.({ frame: from + k + 1, frames, captured });
    }
  }
  return captured;
}

// Whether the run's sound plan has anything to put in the film: a cue track or music.
const hasSound = (sound) => Boolean(sound?.cues) || Boolean(sound?.music);

// The mode's loudness targets for a film with a voice or sound (validateMode required them when the mode registered); a
// voiced film rendered without its voice is refused, never rendered silent as if it had none. null: nothing to master.
function loudnessFor(film, voice, sound) {
  if (voice === undefined && film.voice !== undefined) throw new Error('renderFilm: the film has a voice; pass the voice stage\'s result ({ dir, sidecar }) as `voice`');
  if (voice === undefined && !hasSound(sound)) return null;
  return registries.modes.get(film.mode ?? DEFAULT_MODE).loudness;
}

// The report's audio: the level measured in the finished file, with what the sound plan put in it.
const audioOf = (level, sound) => ({ ...level, cues: sound?.cues?.count ?? 0, music: sound?.music?.summary ?? null });

/**
 * @param {{ specPath?: string, out: string, exact?: boolean, onProgress?: (p: { frame: number, frames: number, captured: number }) => void,
 *   session?: object, signal?: AbortSignal, voice?: { dir: string, sidecar: object },
 *   sound?: { cues: { file: string, count: number } | null, music: { file: string, recording: boolean, fadeFrom: number | null,
 *   duck: object[], summary: object } | null } }} opts a session (openSession) is used and left open when given;
 *   otherwise the film at specPath is loaded and opened here and closed after. exact: PNG capture (default: JPEG at quality
 *   98). voice: what the voice stage made, required for a film with `voice`. sound: the run's sound plan (run.mjs: the cue
 *   track and the music, as files in the run's work folder), mixed with the voice into one master (voice/master.mjs).
 * @returns {Promise<{ out: string, frames: number, captured: number, seconds: number, msPerFrame: number, capture: 'fast' | 'exact', post: string, bytes: number, mbps: number,
 *   audio: { lufs: number | null, truePeakDb: number | null, note: string | null, cues: number, music: object | null } | null }>}
 *   audio: the sound as measured in the finished file (lufs null, with a note, when it is too short to measure), with the
 *   cue count and the music summary of the plan; null with neither a voice nor sound (and then the video is exactly what
 *   it was: no audio step runs). A level more than 1 LU off the mode's target, or a true peak over its ceiling, fails
 *   the render (voice/master.mjs judgeLevel): the AAC encode of the master is judged before any frame is captured, and
 *   the finished file again after the mux (the same stream, copied).
 */
export async function renderFilm({ specPath, out, exact = false, onProgress, session, signal, voice, sound }) {
  const ffmpeg = await findFfmpeg();
  const own = session === undefined;
  const loaded = own ? loadFilm(specPath) : null;
  const loudness = loudnessFor(own ? loaded.film : session.film, voice, sound);
  const open = own ? await openSession(loaded) : session;
  const partial = path.join(path.dirname(out), `.${path.basename(out)}.partial-${process.pid}.mp4`);
  const muxed = path.join(path.dirname(out), `.${path.basename(out)}.voice.partial-${process.pid}.mp4`);
  let encoder = null;
  let work = null;
  const started = performance.now();
  try {
    const steps = loudness === null ? null : await voiceSteps();
    const run = steps?.ffmpegRunner(ffmpeg, signal);
    // A film with no narration (no voice, or a voice whose shots have no say) is cues and music alone, which may stop
    // short of the target (judgeLevel noVoice).
    const narrated = steps !== null && steps.hasNarration(voice);
    const subject = narrated ? 'the mastered narration' : 'the mastered sound';
    mkdirSync(path.dirname(out), { recursive: true });
    sweepPartials(path.dirname(out));
    if (steps !== null) work = mkdtempSync(path.join(tmpdir(), 'mm-voice-'));
    const master = steps === null ? null : await steps.masterTrack({ run, voice, timeline: open.timeline, loudness, workDir: work, cues: sound?.cues ?? undefined, music: sound?.music ?? undefined });
    // Before any frame is captured: the master encoded to the AAC the film ships (raised by what AAC took from it), and
    // that encode judged with the finished file's rule, so a film that would fail after the capture fails here. The mux
    // copies this stream, so the judgement after it can no longer differ.
    const encoded = master === null ? null : await steps.encodeMaster({ run, master, out: path.join(work, 'sound.m4a'), duration: open.timeline.duration, loudness });
    // An encode lowered to the ceiling (encodeMaster's held) may sit under the target: noted, not refused.
    const judgement = { noVoice: !narrated, held: encoded?.held ?? false };
    if (encoded !== null) steps.judgeLevel(encoded.level, loudness, subject, judgement);
    encoder = startEncoder(ffmpeg, [...QUIET, ...encoderArgs({ fps: open.timeline.fps, out: partial, exact })], signal);
    const captured = await encodeFrames({ session: open, encoder, exact, signal, onProgress });
    await encoder.finish();
    encoder = null;
    const audio = encoded === null ? null : audioOf(steps.judgeLevel(await steps.muxVoice({ run, video: partial, audio: encoded.file, out: muxed, duration: open.timeline.duration }), loudness, undefined, judgement), sound);
    renameSync(audio === null ? partial : muxed, out);
    const seconds = (performance.now() - started) / MS_PER_SECOND;
    const frames = open.timeline.frameCount;
    const bytes = statSync(out).size;
    const mbps = (bytes * BITS_PER_BYTE) / (frames / open.timeline.fps) / MEGA;
    return { out, frames, captured, seconds, msPerFrame: (seconds * MS_PER_SECOND) / frames, capture: exact ? 'exact' : 'fast', post: open.info.post, bytes, mbps, audio };
  } finally {
    if (encoder) await encoder.stop();
    rmSync(partial, { force: true });
    rmSync(muxed, { force: true });
    if (work !== null) rmSync(work, { recursive: true, force: true });
    if (own) await open.close();
  }
}

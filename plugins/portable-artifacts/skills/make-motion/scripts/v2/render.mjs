// Render a film to an H.264 yuv420p MP4. The page draws each frame (post pass included); a screenshot of it goes to
// ffmpeg on a pipe. Two capture modes: `exact` takes PNG (lossless: tests, sheets, --exact) and the default `fast`
// takes JPEG at quality 98 (a grainy frame costs far less to encode as JPEG). A frame whose __stateKey equals the
// previous frame's is not captured again: the previous picture is sent twice. The video is written to a partial file
// beside the output and renamed when ffmpeg is done, so a stop or a failure leaves no half-written MP4 behind.
import { spawn } from 'node:child_process';
import { mkdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { findFfmpeg, encodeArgs } from '../lib/ffmpeg.mjs';
import { loadFilm } from './pipeline.mjs';
import { openSession } from './session.mjs';

export const JPEG_QUALITY = 98;
const HELD_CHUNK = 150; // frames whose held flags are fetched in one page.evaluate
const MS_PER_SECOND = 1000;
const STDERR_KEEP = 2000;
const QUIET = ['-hide_banner', '-loglevel', 'error'];

// A JPEG decodes to full-range YUV; the video is limited-range yuv420p like every other, so scale between the two.
const JPEG_RANGE_FILTER = ['-vf', 'scale=in_range=pc:out_range=tv'];

// encodeArgs reads PNG frames; the fast mode feeds it JPEG frames instead.
export function jpegInput(args) {
  const at = args.findIndex((arg, k) => arg === '-c:v' && args[k + 1] === 'png');
  const input = args.indexOf('-i', at);
  if (at < 0 || input < 0) throw new Error('render: encodeArgs no longer takes png frames from a pipe; update jpegInput');
  return [...args.slice(0, at + 1), 'mjpeg', ...args.slice(at + 2, input + 2), ...JPEG_RANGE_FILTER, ...args.slice(input + 2)];
}

// An ffmpeg process with a promise for its end and a write() that waits for the pipe and fails when ffmpeg has died.
function startEncoder(ffmpeg, args) {
  const child = spawn(ffmpeg, args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '';
  let failure = null;
  let exitCode = null; // set once the process has ended
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-STDERR_KEEP); });
  child.stdin.on('error', (err) => { failure ??= err; });
  const ended = new Promise((resolve) => {
    child.on('error', (err) => { failure ??= err; exitCode = -1; resolve(-1); });
    child.on('close', (code) => { exitCode = code; resolve(code); });
  });
  const fail = (code) => new Error(`ffmpeg failed (${failure?.message ?? `exit ${code}`}): ${stderr.trim().split('\n').at(-1) ?? ''}`);
  return {
    async write(buffer) {
      if (!failure && exitCode === null && !child.stdin.write(buffer)) {
        await Promise.race([new Promise((resolve) => child.stdin.once('drain', resolve)), ended]); // ffmpeg dying must not leave this waiting
      }
      if (failure || exitCode !== null) throw fail(exitCode);
    },
    async finish() {
      child.stdin.end();
      const code = await ended;
      if (code !== 0 || failure) throw fail(code);
    },
    async stop() {
      child.kill('SIGKILL');
      await ended;
    },
  };
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

/**
 * @param {{ specPath?: string, out: string, exact?: boolean, onProgress?: (p: { frame: number, frames: number, captured: number }) => void,
 *   session?: object, signal?: AbortSignal }} opts a session (openSession) is used and left open when given; otherwise
 *   the film at specPath is loaded and opened here and closed after. exact: PNG capture (default: JPEG at quality 98).
 * @returns {Promise<{ out: string, frames: number, captured: number, seconds: number, msPerFrame: number, capture: 'fast' | 'exact', post: string }>}
 */
export async function renderFilm({ specPath, out, exact = false, onProgress, session, signal }) {
  const ffmpeg = await findFfmpeg();
  const own = session === undefined;
  const open = own ? await openSession(loadFilm(specPath)) : session;
  const partial = path.join(path.dirname(out), `.${path.basename(out)}.partial-${process.pid}.mp4`);
  let encoder = null;
  const started = performance.now();
  try {
    mkdirSync(path.dirname(out), { recursive: true });
    const args = encodeArgs({ fps: open.timeline.fps, out: partial });
    encoder = startEncoder(ffmpeg, [...QUIET, ...(exact ? args : jpegInput(args))]);
    const captured = await encodeFrames({ session: open, encoder, exact, signal, onProgress });
    await encoder.finish();
    encoder = null;
    renameSync(partial, out);
    const seconds = (performance.now() - started) / MS_PER_SECOND;
    const frames = open.timeline.frameCount;
    return { out, frames, captured, seconds, msPerFrame: (seconds * MS_PER_SECOND) / frames, capture: exact ? 'exact' : 'fast', post: open.info.post };
  } finally {
    if (encoder) await encoder.stop();
    rmSync(partial, { force: true });
    if (own) await open.close();
  }
}

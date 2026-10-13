// Rendering a motion.json to an MP4 by running make-motion's own CLI as a child
// process (importing its render.mjs would run it). The output goes to a
// temporary folder that is gone before this returns, so a build that fails
// later leaves nothing behind; the page build writes the bytes next to the page.
// Every child has a time limit that holds: SIGTERM first (make-motion cleans up
// on it), SIGKILL after a grace period if it is still there.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSibling, siblingDir, SiblingError, MISSING_HINT, installCommand } from './siblings.mjs';
import { SectionErrors } from './section-errors.mjs';
import { VIDEO_MAX_BYTES } from './motion-source.mjs';

export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
export const TIMEOUT_ENV = 'PA_MOTION_TIMEOUT_MS';
export const KILL_GRACE_MS = 5000;
const POSTER_TIMEOUT_MS = 30 * 1000;
const POSTER_GRACE_MS = 2000;
const POSTER_WIDTH = 960;
const POSTER_POINT = 0.85; // the point of a scene make-motion's contact sheet shows
const KEPT_OUTPUT_BYTES = 64 * 1024; // the end of each stream is kept, the rest is dropped
const TAIL_LINES = 6;
const TAIL_LINE_CHARS = 200;
const MB = 1024 * 1024;
const NEEDS = /ffmpeg not found|No browser available/;

const timeoutOf = (env) => {
  const n = Number(env?.[TIMEOUT_ENV]);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
};
const lines = (text) => String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
const cut = (line) => (line.length > TAIL_LINE_CHARS ? `${line.slice(0, TAIL_LINE_CHARS)}…` : line);

/**
 * Run a program and wait for it. Always resolves { status, signal, error, timedOut, stdout, stderr }
 * (the last KEPT_OUTPUT_BYTES of each stream). After `timeoutMs` it gets SIGTERM, and SIGKILL `graceMs` later
 * if it has not exited, so this never waits longer than their sum.
 */
export function runChild(command, args, { cwd, env, timeoutMs, graceMs = KILL_GRACE_MS }) {
  return new Promise((resolve) => {
    const out = { stdout: '', stderr: '' };
    let timedOut = false;
    let done = false;
    let killTimer;
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      resolve({ status: null, signal: null, error: undefined, ...result, timedOut, ...out });
    };
    for (const name of ['stdout', 'stderr']) {
      child[name].setEncoding('utf8');
      child[name].on('data', (chunk) => { out[name] = (out[name] + chunk).slice(-KEPT_OUTPUT_BYTES); });
    }
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), graceMs);
    }, timeoutMs);
    child.on('error', (error) => finish({ error }));
    child.on('close', (status, signal) => finish({ status, signal }));
  });
}

/**
 * The message for a child process result that did not succeed: what is missing
 * (with make-motion's own install hint) when it cannot run here, else the end of its output.
 */
export function renderFailure({ status, signal, error, timedOut, stderr, stdout }, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (timedOut) return `make-motion did not finish within ${timeoutMs} ms; shorten the video or raise ${TIMEOUT_ENV}`;
  if (error?.code === 'ENOBUFS') return 'make-motion wrote more output than can be kept; run its scripts/render.mjs by hand to see what it says';
  if (error) return `make-motion could not start: ${error.message}`;
  if (signal) return `make-motion was stopped by ${signal}`;
  const err = lines(stderr);
  const missing = err.find((l) => NEEDS.test(l));
  if (missing) return `make-motion cannot render this spec: it needs ffmpeg and a Chromium browser. ${missing}`;
  const tail = (err.length > 0 ? err : lines(stdout)).slice(-TAIL_LINES).map((l) => `  ${cut(l)}`);
  return `make-motion failed (exit ${status}); the end of its output:\n${tail.length > 0 ? tail.join('\n') : '  (no output)'}`;
}

/** The make-motion CLI arguments: a spec that names no theme is drawn with the page's. */
export function motionArgs(specAbs, outFile, spec, pageTheme) {
  return [specAbs, '--out', outFile, ...(spec.theme === undefined && pageTheme !== undefined ? ['--theme', pageTheme] : [])];
}

/** A still from the rendered video, for the poster. Best effort: no poster is not an error, and not a hang. */
export async function posterFrame(video, tmp, seconds, { timeoutMs = POSTER_TIMEOUT_MS, graceMs = POSTER_GRACE_MS } = {}) {
  try {
    const { findFfmpeg } = await loadSibling('make-motion', 'scripts/lib/ffmpeg.mjs');
    const out = path.join(tmp, 'poster.png');
    const args = ['-v', 'error', '-y', '-ss', String(seconds), '-i', video, '-frames:v', '1', '-vf', `scale='min(${POSTER_WIDTH},iw)':-2`, out];
    const r = await runChild(await findFfmpeg(), args, { cwd: tmp, env: process.env, timeoutMs, graceMs });
    return r.status === 0 && fs.existsSync(out) ? fs.readFileSync(out) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The environment make-motion runs in: ours, without EVAL_LOG. That variable counts validate runs for the
 * evals; a make-motion CLI that ever logged to it would inflate the count.
 */
export function childEnv(env) {
  const { EVAL_LOG: _evalLog, ...rest } = env;
  return rest;
}

/**
 * Render `specAbs` (a validated motion.json) -> { video: Buffer, poster?: Buffer }. `pageTheme` is the theme
 * of the page the video is for. Throws SectionErrors (at `spec`) when make-motion cannot render it here or the
 * video is over `maxBytes`, SiblingError when it is not installed.
 */
export async function renderMotion(specAbs, spec, env = process.env, { maxBytes = VIDEO_MAX_BYTES, pageTheme } = {}) {
  const script = path.join(siblingDir('make-motion'), 'scripts/render.mjs');
  if (!fs.existsSync(script)) {
    throw new SiblingError(`make-motion/scripts/render.mjs not found in ${siblingDir('make-motion')}; ${MISSING_HINT(['make-motion'])}`, installCommand(['make-motion']));
  }
  const timeoutMs = timeoutOf(env);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-motion-render-'));
  try {
    const file = path.join(tmp, 'video.mp4');
    const r = await runChild(process.execPath, [script, ...motionArgs(specAbs, file, spec, pageTheme)], { cwd: tmp, env: childEnv(env), timeoutMs });
    if (r.error || r.timedOut || r.status !== 0) throw new SectionErrors([{ path: 'spec', message: renderFailure(r, { timeoutMs }) }]);
    const size = fs.statSync(file).size;
    if (size > maxBytes) {
      throw new SectionErrors([{ path: 'spec', message: `rendered video is ${(size / MB).toFixed(1)} MB; the limit is ${maxBytes / MB} MB — shorten it or lower the size in the spec` }]);
    }
    return { video: fs.readFileSync(file), poster: await posterFrame(file, tmp, (spec.scenes?.[0]?.duration ?? 0) * POSTER_POINT) };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

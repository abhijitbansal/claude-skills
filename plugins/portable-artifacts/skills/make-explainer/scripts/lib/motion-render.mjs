// Rendering a motion.json to an MP4 by running make-motion's own CLI as a child
// process (importing its render.mjs would run it). The output goes to a
// temporary folder that is gone before this returns, so a build that fails
// later leaves nothing behind; the page build writes the bytes next to the page.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSibling, siblingDir, SiblingError, MISSING_HINT, installCommand } from './siblings.mjs';
import { SectionErrors } from './section-errors.mjs';

export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
export const TIMEOUT_ENV = 'PA_MOTION_TIMEOUT_MS';
const POSTER_WIDTH = 960;
const POSTER_POINT = 0.85; // the point of a scene make-motion's contact sheet shows
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const NEEDS = /ffmpeg not found|No browser available/;

const timeoutOf = (env) => {
  const n = Number(env?.[TIMEOUT_ENV]);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
};
const lines = (text) => String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);

/**
 * The message for a child process result that did not succeed: what is missing
 * (with make-motion's own install hint) when it cannot run here, else its last line.
 */
export function renderFailure({ status, signal, error, stderr, stdout }, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (error?.code === 'ETIMEDOUT') return `make-motion did not finish within ${timeoutMs} ms; shorten the video or raise ${TIMEOUT_ENV}`;
  if (error) return `make-motion could not start: ${error.message}`;
  if (signal) return `make-motion was stopped by ${signal}`;
  const err = lines(stderr);
  const missing = err.find((l) => NEEDS.test(l));
  if (missing) return `make-motion cannot render this spec: it needs ffmpeg and a Chromium browser. ${missing}`;
  const last = err.at(-1) ?? lines(stdout).at(-1) ?? 'no message';
  return `make-motion failed (exit ${status}): ${last}`;
}

// A still from the rendered video, for the poster. Best effort: no poster is not an error.
async function posterFrame(video, tmp, seconds) {
  try {
    const { findFfmpeg } = await loadSibling('make-motion', 'scripts/lib/ffmpeg.mjs');
    const out = path.join(tmp, 'poster.png');
    const r = spawnSync(await findFfmpeg(), ['-v', 'error', '-y', '-ss', String(seconds), '-i', video, '-frames:v', '1', '-vf', `scale='min(${POSTER_WIDTH},iw)':-2`, out], { stdio: 'ignore' });
    return r.status === 0 && fs.existsSync(out) ? fs.readFileSync(out) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Render `specAbs` (a validated motion.json) -> { video: Buffer, poster?: Buffer }.
 * Throws SectionErrors (at `spec`) when make-motion cannot render it here, SiblingError when it is not installed.
 */
export async function renderMotion(specAbs, spec, env = process.env) {
  const script = path.join(siblingDir('make-motion'), 'scripts/render.mjs');
  if (!fs.existsSync(script)) {
    throw new SiblingError(`make-motion/scripts/render.mjs not found in ${siblingDir('make-motion')}; ${MISSING_HINT(['make-motion'])}`, installCommand(['make-motion']));
  }
  const timeoutMs = timeoutOf(env);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-motion-render-'));
  try {
    const file = path.join(tmp, 'video.mp4');
    const r = spawnSync(process.execPath, [script, specAbs, '--out', file], { cwd: tmp, encoding: 'utf8', env, timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES });
    if (r.error || r.status !== 0) throw new SectionErrors([{ path: 'spec', message: renderFailure(r, { timeoutMs }) }]);
    return { video: fs.readFileSync(file), poster: await posterFrame(file, tmp, (spec.scenes?.[0]?.duration ?? 0) * POSTER_POINT) };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

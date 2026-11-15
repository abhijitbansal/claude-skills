// Test helpers for the stages that run on a session (scripts/v2/session.mjs): open a film, or learn that this machine
// has no browser or no ffmpeg so the test can skip. PA_REQUIRE_BROWSER=1 turns a missing browser or ffmpeg into a failure.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTimeline } from '../../../engine/script/timing.mjs';
import { openSession } from '../../../scripts/v2/session.mjs';
import { findFfmpeg } from '../../../scripts/lib/ffmpeg.mjs';
import { launchBrowser } from '../../../scripts/lib/browser.mjs';

const NO_BROWSER = /^No browser available/;
export const DEFAULT_FPS = 30;
export const HERE = path.dirname(fileURLToPath(import.meta.url));
const required = () => process.env.PA_REQUIRE_BROWSER === '1';

/** A session on `film` (fps defaults to 30), or null when there is no browser and none is required. */
export async function sessionOrNull(film, { specDir = HERE, ...options } = {}) {
  const timeline = buildTimeline(film, { fps: film.fps ?? DEFAULT_FPS });
  try {
    return await openSession({ film: { fps: DEFAULT_FPS, ...film }, timeline, specDir }, options);
  } catch (err) {
    if (NO_BROWSER.test(err.message) && !required()) return null;
    throw err;
  }
}

let browserProbe = null;
/** Whether a browser can be launched here; false when there is none and none is required (probed once, then cached). */
export function browserAvailable() {
  browserProbe ??= (async () => {
    try {
      await (await launchBrowser({ quiet: true })).close();
      return true;
    } catch (err) {
      if (NO_BROWSER.test(err.message) && !required()) return false;
      throw err;
    }
  })();
  return browserProbe;
}

/** The ffmpeg path, or null when there is none and none is required. */
export async function ffmpegOrNull() {
  try {
    return await findFfmpeg();
  } catch (err) {
    if (!required()) return null;
    throw err;
  }
}

/** { codec, pix_fmt, frames, duration, width, height } of the first video stream of `file`, by ffprobe (null: no ffprobe). */
export function probeVideo(file) {
  const args = ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,pix_fmt,nb_read_frames,width,height:format=duration', '-of', 'json', file];
  const run = spawnSync('ffprobe', args, { encoding: 'utf8' });
  if (run.status !== 0) return null;
  const { streams: [stream], format } = JSON.parse(run.stdout);
  return { codec: stream.codec_name, pix_fmt: stream.pix_fmt, frames: Number(stream.nb_read_frames), duration: Number(format.duration), width: stream.width, height: stream.height };
}

/** The process ids of running headless browsers (pgrep), as a Set of numbers. */
export function headlessPids() {
  const run = spawnSync('pgrep', ['-f', 'chrome-headless-shell']);
  return new Set(String(run.stdout ?? '').split('\n').filter(Boolean).map(Number));
}

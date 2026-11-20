// A looping film (root `loop: true`, version 1's `viral.loop`): the review compares the last frame with the first and,
// past LOOP_DIFF_MAX, says the film does not loop cleanly. The contract is version 1's check (loopWarnings in
// scripts/lib/viral-checks.mjs, deleted at cut-over): the mean absolute per-channel difference over 255 of the two frames
// as drawn, post pass included. Copied, not imported.
import { readPng } from './png.mjs';

/** The largest first-to-last frame difference a looping film may have (version 1's LOOP_DIFF_MAX). */
export const LOOP_DIFF_MAX = 0.12;
const CHANNELS = 3;
const BYTE = 255;
const DECIMALS = 2;

// A frame as the page draws it, decoded (png.mjs): the page's policy refuses data: pictures, so pixels are read in Node.
async function framePixels(page, frame) {
  await page.evaluate((i) => window.__seek(i), frame);
  return readPng(await page.screenshot({ type: 'png' }));
}

/** The mean absolute per-channel difference (0 to 1) between frames `a` and `b` of the session's page. */
export async function frameDifference(page, a, b) {
  const p = await framePixels(page, a);
  const q = await framePixels(page, b);
  if (p.width !== q.width || p.height !== q.height || p.channels !== q.channels) throw new Error('loop: the two frames differ in size');
  let sum = 0;
  for (let i = 0; i < p.data.length; i += p.channels) {
    for (let k = 0; k < CHANNELS; k++) sum += Math.abs(p.data[i + k] - q.data[i + k]);
  }
  return sum / ((p.data.length / p.channels) * CHANNELS * BYTE);
}

/**
 * The loop finding of a session's film: [] without `loop: true` or when its last frame is within LOOP_DIFF_MAX of its
 * first; else one creative finding at `loop`, on the last shot, at the last frame's time.
 */
export async function loopFindings(session) {
  const { film, timeline, page } = session;
  if (film.loop !== true) return [];
  const last = timeline.frameCount - 1;
  const diff = await frameDifference(page, 0, last);
  if (diff <= LOOP_DIFF_MAX) return [];
  return [{
    kind: 'creative',
    shot: timeline.shots.at(-1).id,
    path: 'loop',
    t: last / timeline.fps,
    message: `the last frame does not match the first (difference ${diff.toFixed(DECIMALS)}); end on the opening picture again so the film loops`,
  }];
}

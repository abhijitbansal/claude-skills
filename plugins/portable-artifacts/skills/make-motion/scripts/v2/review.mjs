// Film review: audit snapshots of the film in Node. The page reports one snapshot per audit moment (the sheet frames
// and one per half second); auditFrame checks each, the still-frame pacing rule runs on the whole film, and the
// findings are deduplicated by (shot, rule, node) keeping the first time each occurs. A frame inside a cut's
// transition is skipped: both shots are on screen then, so overlapping text is expected.
import { registries } from '../../engine/registry.mjs';
import { resolveLook } from '../../engine/graph/film.mjs';
import { auditFrame } from '../../engine/review/frame.mjs';
import { stillStretches, shotAtFrame } from '../../engine/review/pacing.mjs';
import { canvasSize } from '../../template/formats.mjs';
import { auditMoments } from './plan.mjs';

const SNAPSHOT_CHUNK = 20; // snapshots fetched per page.evaluate, so a stop request is heard between chunks
const HELD_CHUNK = 150;
const SECOND_DECIMALS = 2;
const DEFAULT_MODE = 'pro';

const timeText = (t) => t.toFixed(SECOND_DECIMALS);

/**
 * One finding per (shot, rule, node): the earliest, its time in the message. Items are { shot, t, finding }.
 * @returns {{ kind: string, shot: string, path: string, message: string, t: number, rule: string, node: string }[]} in time order
 */
export function dedupeFindings(items) {
  const first = new Map();
  for (const item of items) {
    const key = JSON.stringify([item.shot, item.finding.rule, item.finding.node]);
    if (!first.has(key) || item.t < first.get(key).t) first.set(key, item);
  }
  return [...first.values()]
    .sort((a, b) => a.t - b.t)
    .map(({ shot, t, finding }) => ({ ...finding, shot, t, message: `${finding.message} (at ${timeText(t)} s)` }));
}

// The frames to audit: those outside the first `cut.dur` seconds of a shot that came in on a cut.
function auditableFrames(film, timeline) {
  const inTransition = (frame) => {
    const shot = shotAtFrame(timeline, frame);
    if (shot.index === 0) return false;
    const cut = registries.cuts.get(film.shots[shot.index].cut ?? 'cut');
    return frame / timeline.fps - shot.start < Math.min(cut.dur, shot.duration);
  };
  return auditMoments(film, timeline).filter((frame) => !inTransition(frame));
}

async function snapshotsOf(session, frames, signal) {
  const out = [];
  for (let from = 0; from < frames.length; from += SNAPSHOT_CHUNK) {
    signal?.throwIfAborted();
    const chunk = frames.slice(from, from + SNAPSHOT_CHUNK);
    const trees = await session.page.evaluate((list) => list.map((i) => window.__snapshot(i)), chunk);
    chunk.forEach((frame, k) => out.push({ frame, tree: trees[k] }));
  }
  return out;
}

async function heldFlags(session, signal) {
  const { frameCount } = session.timeline;
  const held = [];
  for (let from = 0; from < frameCount; from += HELD_CHUNK) {
    signal?.throwIfAborted();
    const to = Math.min(frameCount, from + HELD_CHUNK) - 1;
    held.push(...await session.page.evaluate(([a, b]) => window.__heldFlags(a, b, false), [from, to]));
  }
  return held;
}

function frameFindings(film, timeline, { frame, tree }) {
  const shot = shotAtFrame(timeline, frame);
  const t = frame / timeline.fps;
  const [width, height] = canvasSize(film);
  const ctx = { look: resolveLook(film), canvas: { w: width, h: height }, mode: film.mode ?? DEFAULT_MODE, shotId: shot.id, t, isFirstShot: shot.index === 0 };
  return auditFrame(tree, ctx).map((finding) => ({ shot: shot.id, t, finding }));
}

function pacingFindings(film, timeline, held) {
  const { maxStillSeconds } = registries.modes.get(film.mode ?? DEFAULT_MODE);
  return stillStretches({ held, timeline, maxStillSeconds }).map((s) => ({
    kind: 'creative',
    shot: s.shot,
    path: `shots[${s.shot}]`,
    t: s.start,
    rule: 'still',
    node: '',
    message: `the picture holds still for ${timeText(s.seconds)} s from ${timeText(s.start)} s; the ${film.mode ?? DEFAULT_MODE} mode allows ${maxStillSeconds} s, so add motion or cut sooner`,
  }));
}

/**
 * @param {{ session: object, signal?: AbortSignal }} opts session from openSession
 * @returns {Promise<{ kind: 'mechanical' | 'creative', shot: string, path: string, message: string, t: number, rule: string, node: string }[]>}
 */
export async function reviewFilm({ session, signal }) {
  const { film, timeline } = session;
  const snapshots = await snapshotsOf(session, auditableFrames(film, timeline), signal);
  const audited = snapshots.flatMap((snap) => frameFindings(film, timeline, snap));
  const deduped = dedupeFindings(audited);
  const still = pacingFindings(film, timeline, await heldFlags(session, signal));
  return [...deduped, ...still].sort((a, b) => a.t - b.t);
}

// Film review: audit snapshots of the film in Node. The page reports one snapshot per audit moment (plan.mjs: the sheet
// frames, every `on` landing, the last frame of each shot and one frame every 0.25 s); auditFrame checks each, the
// still-frame pacing rule runs on the whole film, and the findings are deduplicated by (shot, rule, node) keeping the
// first time each occurs.
//
// A frame inside a cut's window (the first `cut.dur` seconds of a shot that came in on a cut) shows both shots, so
// overlapping text is expected; there the incoming shot is audited alone, through the page's __snapshotShot, so its own
// nodes are still judged. A shot shorter than its cut window is audited at its last frame the same way.
//
// What escapes: a defect that is on screen for less than the sampling step (0.25 s, 7 frames at 30 fps) and falls
// between two sampled frames, one that exists only while a text is still arriving, pulsing or pushed by the camera
// (engine/review/frame.mjs judges landed, settled texts), and anything the audit has no rule for.
import { registries } from '../../engine/registry.mjs';
import { resolveLook } from '../../engine/graph/film.mjs';
import { auditFrame, textScalesIn } from '../../engine/review/frame.mjs';
import { stillStretches, shotAtFrame } from '../../engine/review/pacing.mjs';
import { compositionRect } from '../../engine/kinds/shared.mjs';
import { canvasSize, safeInsets, VIRAL_SAFE_ZONE } from '../../template/formats.mjs';
import { auditMoments } from './plan.mjs';
import { pageFinding } from './report.mjs';

const SNAPSHOT_CHUNK = 20; // snapshots fetched per page.evaluate, so a stop request is heard between chunks
const HELD_CHUNK = 150;
const SECOND_DECIMALS = 2;
const DEFAULT_MODE = 'pro';
const NOT_A_CUT_SHOT = -1;

const timeText = (t) => t.toFixed(SECOND_DECIMALS);

/**
 * The rectangle text must stay inside: the rectangle the kinds compose in (compositionRect: the platform safe zone for
 * pop on 9:16), else the canvas less the format's safe insets.
 * @returns {{ left: number, top: number, right: number, bottom: number }} canvas pixels
 */
export function safeRectFor(canvas, look) {
  const size = [canvas.w, canvas.h];
  const rect = compositionRect({ canvas, look, viralInsets: safeInsets(size, VIRAL_SAFE_ZONE) });
  if (rect.safe) return { left: rect.left, top: rect.top, right: rect.left + rect.w, bottom: rect.top + rect.h };
  const margin = safeInsets(size);
  return { left: margin.left, top: margin.top, right: canvas.w - margin.right, bottom: canvas.h - margin.bottom };
}

// node id -> Set of word indices at opacity 0 on this frame, for every text in the tree that has word tracks.
export function hiddenWordsIn(tree) {
  const hidden = new Map();
  const walk = (n) => {
    if (n.type === 'text' && Array.isArray(n.words)) {
      const none = n.words.flatMap((w, i) => (w.opacity === 0 ? [i] : []));
      if (none.length > 0) hidden.set(n.id, new Set(none));
    }
    (n.children ?? []).forEach(walk);
  };
  (tree ?? []).forEach(walk);
  return hidden;
}

// The spec field a text finding is about, so its path points at what to edit (shots[2].kicker rather than shots[2]).
function fieldOf(shot, finding) {
  const field = {
    kicker: 'kicker', caption: 'caption', label: 'label', tag: 'delta',
    affix: finding.node?.endsWith('.prefix') ? 'prefix' : 'suffix',
    hero: ['text', 'say', 'value'].find((name) => shot?.[name] !== undefined),
  }[finding.role];
  return field !== undefined && shot?.[field] !== undefined ? `.${field}` : '';
}

/**
 * One finding per (shot, rule, node): the earliest, its time in the message. Items are { shot, t, finding }; with the
 * film's `shots` array given, a finding about a text gets the path of the field that holds it.
 * @returns {{ kind: string, shot: string, path: string, message: string, t: number, rule: string, node: string }[]} in time order
 */
export function dedupeFindings(items, shots = []) {
  const first = new Map();
  for (const item of items) {
    const key = JSON.stringify([item.shot, item.finding.rule, item.finding.node]);
    if (!first.has(key) || item.t < first.get(key).t) first.set(key, item);
  }
  return [...first.values()]
    .sort((a, b) => a.t - b.t)
    .map(({ shot, t, finding }) => {
      const spec = shots.find((s) => s?.id === shot);
      return { ...finding, shot, t, path: `${finding.path}${fieldOf(spec, finding)}`, message: `${finding.message} (at ${timeText(t)} s)` };
    });
}

// For each audit frame: which shot to audit alone ([shot index, frame]) when the frame is inside a cut window, else
// [-1, frame] for the whole frame.
export function auditPlan(film, timeline) {
  const windowShot = (frame) => {
    const shot = shotAtFrame(timeline, frame);
    if (shot.index === 0) return NOT_A_CUT_SHOT;
    const cut = registries.cuts.get(film.shots[shot.index].cut ?? 'cut');
    return frame / timeline.fps - shot.start < Math.min(cut.dur, shot.duration) ? shot.index : NOT_A_CUT_SHOT;
  };
  return auditMoments(film, timeline).map((frame) => [windowShot(frame), frame]);
}

async function snapshotsOf(session, plan, signal) {
  const out = [];
  for (let from = 0; from < plan.length; from += SNAPSHOT_CHUNK) {
    signal?.throwIfAborted();
    const chunk = plan.slice(from, from + SNAPSHOT_CHUNK);
    const trees = await session.page.evaluate((list) => list.map(([shot, i]) => (shot < 0 ? window.__snapshot(i) : window.__snapshotShot(shot, i))), chunk);
    chunk.forEach(([, frame], k) => out.push({ frame, tree: trees[k] }));
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

// shot id -> what its last frame says about its texts (see engine/review/frame.mjs): the words at opacity 0 there are
// permanently hidden, and the scale each text stands at there is the scale it rests at.
function restingByShot(timeline, snapshots) {
  const byFrame = new Map(snapshots.map((snap) => [snap.frame, snap.tree]));
  return new Map(timeline.shots.map((shot) => {
    const tree = byFrame.get(Math.round(shot.end * timeline.fps) - 1);
    return [shot.id, tree ? { hiddenWords: hiddenWordsIn(tree), restScales: textScalesIn(tree) } : {}];
  }));
}

function frameFindings(film, timeline, restingOf, { frame, tree }) {
  const shot = shotAtFrame(timeline, frame);
  const t = frame / timeline.fps;
  const [width, height] = canvasSize(film);
  const look = resolveLook(film), canvas = { w: width, h: height };
  const ctx = {
    look, canvas, safe: safeRectFor(canvas, look), mode: film.mode ?? DEFAULT_MODE, shotId: shot.id, shotIndex: shot.index, t,
    isFirstShot: shot.index === 0, ...restingOf.get(shot.id),
  };
  return auditFrame(tree, ctx).map((finding) => ({ shot: shot.id, t, finding }));
}

function pacingFindings(film, timeline, held) {
  const { maxStillSeconds } = registries.modes.get(film.mode ?? DEFAULT_MODE);
  return stillStretches({ held, timeline, maxStillSeconds }).map((s) => ({
    kind: 'creative',
    shot: s.shot,
    path: `shots[${timeline.shots.findIndex((x) => x.id === s.shot)}]`,
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
  const snapshots = await snapshotsOf(session, auditPlan(film, timeline), signal);
  const restingOf = restingByShot(timeline, snapshots);
  const audited = snapshots.flatMap((snap) => frameFindings(film, timeline, restingOf, snap));
  const deduped = dedupeFindings(audited, film.shots);
  const still = pacingFindings(film, timeline, await heldFlags(session, signal));
  return [...deduped, ...still].sort((a, b) => a.t - b.t);
}

const EFFECTS = Object.freeze({ halftone: 'halftone', bloom: 'bloom' });
const listOf = (names) => names.map((name) => EFFECTS[name] ?? name).join(' and ');

/**
 * What the page and the post pass say about themselves, as findings (shot null, path ''): a post pass that had to fall
 * back to 2D (a shader that would not build is mechanical, a browser without WebGL2 is advice when the look loses an
 * effect), and every page error, console error, blocked request and server error the session collected.
 */
export function sessionFindings(session) {
  const notice = session.info?.postNotice;
  const out = [];
  if (notice?.failed) {
    const dropped = notice.dropped.length > 0 ? `${listOf(notice.dropped)} from the look were dropped` : 'the look asks for nothing else';
    out.push(pageFinding('mechanical', `WebGL was unavailable (${notice.reason}); the 2D post pass was used, with grain only: ${dropped}`));
  } else if (notice?.dropped.length > 0) {
    out.push(pageFinding('creative', `post: ${notice.reason}, so ${listOf(notice.dropped)} from the look are dropped; the 2D post pass has grain only`));
  }
  for (const message of new Set(session.errors ?? [])) out.push(pageFinding('mechanical', `page: ${message}`));
  for (const url of new Set(session.blocked ?? [])) out.push(pageFinding('mechanical', `page: request blocked: ${url}`));
  return out;
}

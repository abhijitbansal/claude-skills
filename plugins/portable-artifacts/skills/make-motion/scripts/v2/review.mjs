// Film review: audit snapshots of the film in Node. The page reports one snapshot per audit moment (plan.mjs: the sheet
// frames, every `on` landing, the last frame of each shot and one frame every 0.25 s); auditFrame checks each, the
// still-frame pacing rule runs on the whole film, and the findings are deduplicated by (shot, rule, node) keeping the
// first time each occurs.
//
// A frame inside a cut's window (the first `cut.dur` seconds of a shot that came in on a cut) shows both shots, so
// overlapping text is expected; there the incoming shot is audited alone, through the page's __snapshotShot, so its own
// nodes are still judged. A shot shorter than its cut window is audited at its last frame the same way.
//
// A text that is on screen in a shot but at rest on none of its sampled frames is a mechanical finding of its own
// (settleFindings): no layout rule could judge it.
//
// What escapes: a defect that is on screen for less than the sampling step (0.25 s, 7 frames at 30 fps) and falls
// between two sampled frames, one that exists only while a text is still arriving, pulsing or pushed by the camera
// (engine/review/frame.mjs judges landed, settled texts) when the text also rests on another sampled frame, and
// anything the audit has no rule for.
import { registries } from '../../engine/registry.mjs';
import { resolveLook } from '../../engine/graph/film.mjs';
import { auditFrame, textStatesIn, textLandings } from '../../engine/review/frame.mjs';
import { stillStretches, shotAtFrame } from '../../engine/review/pacing.mjs';
import { compositionRect } from '../../engine/kinds/shared.mjs';
import { canvasSize, safeInsets, VIRAL_SAFE_ZONE } from '../../template/formats.mjs';
import { resolveAnchor } from '../../engine/script/anchors.mjs';
import { aloneAfterFrame } from '../../engine/cuts/index.mjs';
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

// The field the shot's kind says a node shows (its `nodeField(shot, nodeId)` hook: a path inside the shot such as
// "title" or "items[2]", null for the shot itself), or undefined when the kind has no say in it.
function kindField(shot, finding) {
  const kind = typeof shot?.show === 'string' && registries.kinds.has(shot.show) ? registries.kinds.get(shot.show) : null;
  return typeof kind?.nodeField === 'function' ? kind.nodeField(shot, String(finding.node ?? '')) : undefined;
}

// The spec field a text finding is about, so its path points at what to edit (shots[2].kicker rather than shots[2]): what
// the kind says first (kindField), else by the text's role.
function fieldOf(shot, finding) {
  const own = kindField(shot, finding);
  if (own !== undefined) return own === null ? '' : `.${own}`;
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
    // once p > 0 a punch draws only the incoming shot: its frames are audited as drawn (a pinned overlay's place included)
    if (cut.incomingOnly === true && frame > Math.round(shot.start * timeline.fps)) return NOT_A_CUT_SHOT;
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
    chunk.forEach(([shot, frame], k) => out.push({ frame, tree: trees[k], whole: shot < 0 }));
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

const SCALE_DECIMALS = 1e4; // scales that agree to 4 decimals are the same rest

// One more sighting of `scale` in a tally (rounded key -> { n, scale }).
function tally(seen = new Map(), scale) {
  const key = Math.round(scale * SCALE_DECIMALS) / SCALE_DECIMALS;
  return seen.set(key, { n: (seen.get(key)?.n ?? 0) + 1, scale });
}
// The scale seen most in a tally (a tie goes to the one first seen latest), or `fallback` for an empty one.
const modal = (seen, fallback) => (seen && seen.size > 0 ? [...seen.values()].reduce((best, c) => (c.n >= best.n ? c : best)).scale : fallback);

// text id -> the scale it stands at on most of the `trees` where it shows in full (accumulated opacity 1): its rest. A
// last frame that catches the tail of a spring, a pulse or a push would otherwise leave the text's whole at-rest layout
// unjudged, and the frames before an entrance (hidden, held at the entrance's start scale) would outvote a text that
// lands late. A text never shown in full on a sampled frame rests at its last frame's scale.
function modalScales(trees, lastTree) {
  const counts = new Map();
  trees.forEach((tree) => textStatesIn(tree).forEach(({ scale, opacity }, id) => {
    if (opacity >= 1) counts.set(id, tally(counts.get(id), scale));
  }));
  const last = textStatesIn(lastTree);
  return new Map([...last].map(([id, state]) => [id, modal(counts.get(id), state.scale)]));
}

// text id -> per word index, the scale the word holds on most of the `trees` where it and its text show in full
// (ties: the one first seen latest), else on the last frame.
function modalWordScales(trees, lastTree) {
  const counts = new Map();
  trees.forEach((tree) => textStatesIn(tree).forEach(({ opacity, node }, id) => {
    if (opacity < 1 || !Array.isArray(node.words)) return;
    const perWord = counts.get(id) ?? [];
    node.words.forEach((w, i) => { if ((w.opacity ?? 1) >= 1) perWord[i] = tally(perWord[i], w.scale ?? 1); });
    counts.set(id, perWord);
  }));
  const last = textStatesIn(lastTree);
  return new Map([...last].filter(([, s]) => Array.isArray(s.node.words)).map(([id, s]) => [id, s.node.words.map((w, i) => modal(counts.get(id)?.[i], w.scale ?? 1))]));
}

/**
 * shot id -> what its sampled frames say about its texts (see engine/review/frame.mjs): the scale each text
 * (restScales) and each of its words (restWords) holds on most of its frames is the scale it rests at.
 * @param {{ fps: number, shots: { id: string, start: number, end: number }[] }} timeline
 * @param {{ frame: number, tree: object[] }[]} snapshots
 */
export function restingByShot(timeline, snapshots) {
  const byFrame = new Map(snapshots.map((snap) => [snap.frame, snap.tree]));
  return new Map(timeline.shots.map((shot) => {
    const first = Math.round(shot.start * timeline.fps), last = Math.round(shot.end * timeline.fps) - 1;
    const tree = byFrame.get(last);
    const trees = snapshots.filter((snap) => snap.frame >= first && snap.frame <= last).map((snap) => snap.tree);
    return [shot.id, tree ? { restScales: modalScales(trees, tree), restWords: modalWordScales(trees, tree) } : {}];
  }));
}

/**
 * The frame on which shot `index` opens for the opening rule (engine/review/frame.mjs openingFindings), or null: the
 * first frame that shows the shot alone after its cut (a hard cut's first frame, the frame after a punch's p 0, the
 * first frame after a slide's or a match's window: cuts/index.mjs aloneAfterFrame). The film's own first
 * frame only in a mode that reads from frame 0 (its data sets hookFromFrameZero); elsewhere a film may open on its
 * field (the director's ruling).
 */
export function openingFrameOf(film, timeline, index) {
  const shot = timeline.shots[index];
  const first = Math.round(shot.start * timeline.fps);
  if (index === 0) return registries.modes.get(film.mode ?? DEFAULT_MODE).hookFromFrameZero === true ? first : null;
  const offset = aloneAfterFrame(film.shots[index].cut, timeline.fps);
  return first + offset > Math.round(shot.end * timeline.fps) - 1 ? null : first + offset;
}

/** Is `frame`, audited whole, the frame a shot opens on (openingFrameOf)? */
export function opensShotAt(film, timeline, frame, whole) {
  const shot = shotAtFrame(timeline, frame);
  return whole === true && frame === openingFrameOf(film, timeline, shot.index);
}

// The ctx auditFrame takes for one snapshot: the shot it belongs to, the look and canvas, what the shot's frames say,
// and the colour painted under the shot (`backgrounds`, per shot, from the page: session.info.backgrounds).
function frameContext(film, timeline, restingOf, { frame, whole }, backgrounds = []) {
  const shot = shotAtFrame(timeline, frame);
  const [width, height] = canvasSize(film);
  const look = resolveLook(film), canvas = { w: width, h: height };
  return {
    look, canvas, safe: safeRectFor(canvas, look), mode: film.mode ?? DEFAULT_MODE, shotId: shot.id, shotIndex: shot.index, t: frame / timeline.fps,
    isFirstShot: shot.index === 0, ...restingOf.get(shot.id),
    opensShot: opensShotAt(film, timeline, frame, whole),
    background: backgrounds[shot.index],
  };
}

function frameFindings(film, timeline, restingOf, snap, backgrounds) {
  const ctx = frameContext(film, timeline, restingOf, snap, backgrounds);
  return auditFrame(snap.tree, ctx).map((finding) => ({ shot: ctx.shotId, t: ctx.t, finding }));
}

/**
 * A text on screen in a shot that is at rest on none of the shot's sampled frames (still arriving, fading or moving on
 * each) escapes every layout rule, so it is a mechanical finding of its own, at the first frame it shows. Items as
 * dedupeFindings takes them: { shot, t, finding }.
 */
export function settleFindings(film, timeline, restingOf, snapshots) {
  const seen = new Map(); // JSON [shot, text id] -> { shot, t, ctx, role, landed }
  for (const snap of snapshots) {
    const ctx = frameContext(film, timeline, restingOf, snap);
    for (const { id, landed, role } of textLandings(snap.tree, ctx)) {
      const key = JSON.stringify([ctx.shotId, id]);
      const before = seen.get(key);
      seen.set(key, { shot: ctx.shotId, t: before?.t ?? ctx.t, path: `shots[${ctx.shotIndex}]`, id, role, landed: landed || before?.landed === true });
    }
  }
  return [...seen.values()].filter((s) => !s.landed).map(({ shot, t, path, id, role }) => ({
    shot, t, finding: {
      kind: 'mechanical', path, rule: 'unsettled', node: id, ...(role ? { role } : {}),
      message: `text "${id}" never settles within the shot: on every sampled frame it is still arriving, fading or moving, so it cannot be checked; let it land well before the shot ends (lengthen the shot or bring it in sooner)`,
    },
  }));
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

const MECHANICAL_KIND = 'mechanical';
const CREATIVE_KIND = 'creative';

/**
 * One finding a kind's review gave about shot `shot` (the film's shot `index`, `timing` its timeline shot) as the film
 * review's: creative unless it says `kind: 'mechanical'`. Any other `kind` (a typo would silently soften an honesty
 * rule) is an error naming the kind, never read as creative.
 */
export function kindFinding(shot, index, timing, f) {
  if (f.kind !== undefined && f.kind !== MECHANICAL_KIND && f.kind !== CREATIVE_KIND) {
    throw new Error(`kind "${shot.show}" review: a finding's kind is ${JSON.stringify(f.kind)}, not "${MECHANICAL_KIND}" or "${CREATIVE_KIND}"`);
  }
  return { kind: f.kind ?? CREATIVE_KIND, shot: shot.id, path: `shots[${index}].${f.path}`, t: timing.start + f.at, rule: 'kind', node: f.path, message: f.message };
}

// Advice a kind gives about its own shots (kind.review(shot, { look, timing, at, canvas }) -> [{ path, at, message, kind? }]):
// the clipping kind says a region event comes too early to show the whole picture first (creative, the default); the
// chart kind says a chart breaks an honesty rule (kind: 'mechanical', which fails the run like any mechanical finding).
function kindFindings(film, timeline) {
  const look = resolveLook(film);
  const [w, h] = canvasSize(film);
  return film.shots.flatMap((shot, index) => {
    const review = registries.kinds.get(shot.show).review;
    if (typeof review !== 'function') return [];
    const timing = timeline.shots[index];
    return review(shot, { look, timing, at: (ref) => resolveAnchor(ref, timing), canvas: { w, h } }).map((f) => kindFinding(shot, index, timing, f));
  });
}

// The first shot of a mode that reads from frame 0 must show all of its text on frame 0: in a kind that says its hero
// reads so (kind.hookText: the statement), every word of the hero is on screen (opacity above 0) in the first frame.
// Mechanical when not.
export function hookFindings(film, timeline, snapshots) {
  const mode = registries.modes.get(film.mode ?? DEFAULT_MODE);
  const first = film.shots[0];
  const zero = snapshots.find((snap) => snap.frame === 0);
  if (!mode.hookFromFrameZero || registries.kinds.get(first.show).hookText !== true || !zero) return [];
  const texts = [];
  const walk = (n) => { if (n.type === 'text' && n.props?.role === 'hero') texts.push(n); (n.children ?? []).forEach(walk); };
  zero.tree.forEach(walk);
  const [shown, all] = texts.reduce((sum, n) => [sum[0] + (n.words ?? []).filter((w) => w.opacity > 0).length, sum[1] + (n.words ?? []).length], [0, 0]);
  if (all === 0 || shown === all) return [];
  return [{
    kind: 'mechanical', shot: first.id, path: 'shots[0]', t: 0, rule: 'hook', node: '',
    message: `the first shot of a ${film.mode} film must show all of its text on frame 0; ${all - shown} of its ${all} words are not on screen yet`,
  }];
}

/**
 * @param {{ session: object, signal?: AbortSignal }} opts session from openSession
 * @returns {Promise<{ kind: 'mechanical' | 'creative', shot: string, path: string, message: string, t: number, rule: string, node: string }[]>}
 */
export async function reviewFilm({ session, signal }) {
  const { film, timeline } = session;
  const snapshots = await snapshotsOf(session, auditPlan(film, timeline), signal);
  const restingOf = restingByShot(timeline, snapshots);
  const backgrounds = session.info?.backgrounds ?? [];
  const audited = snapshots.flatMap((snap) => frameFindings(film, timeline, restingOf, snap, backgrounds));
  const deduped = dedupeFindings([...audited, ...settleFindings(film, timeline, restingOf, snapshots)], film.shots);
  const still = pacingFindings(film, timeline, await heldFlags(session, signal));
  return [...deduped, ...still, ...kindFindings(film, timeline), ...hookFindings(film, timeline, snapshots)].sort((a, b) => a.t - b.t);
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

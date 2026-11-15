// What to look at: the review sheets of a film, planned from its timeline alone (no browser). A shot gets one sheet
// tiling its start + 0.1 s, a frame every 1.2 s after that, its middle, its 85% point and each `on` event's landing +
// 0.05 s, in time order, plus the 85% frame again as a 360 px phone tile, so a reviewer can judge its motion; each cut
// gets a strip of every frame of its window (the first `cut.dur` seconds of the incoming shot; a hard cut's window is
// its first frame) plus two frames each side. auditMoments adds a frame every quarter second and each shot's first and
// last frame so the audit sees more than the sheets do.
import { registries } from '../../engine/registry.mjs';
import { aloneFromFrame } from '../../engine/cuts/index.mjs';
import { resolveAnchor } from '../../engine/script/anchors.mjs';
import { shotAtFrame } from '../../engine/review/pacing.mjs';

export const PHONE_TILE_WIDTH = 360;
const START_OFFSET = 0.1;
const MIDDLE = 0.5;
const LATE = 0.85;
const LANDING_OFFSET = 0.05;
const STEP = 1.2; // seconds: a shot sheet has a tile at least this often
const CUT_SIDE_FRAMES = 2; // frames shown before and after a cut's window
const AUDIT_STEP = 0.25;
const MIDDLE_DOT = '·';
const SECOND_DECIMALS = 2;

const stamp = (id, t) => `${id} ${MIDDLE_DOT} ${t.toFixed(SECOND_DECIMALS)}s`;

// A tile at frame `frame` of the shot `id`; its time is the time of that frame.
function tile(timeline, role, frame, id, extra = {}) {
  const t = frame / timeline.fps;
  return { role, frame, t, label: stamp(id, t), ...extra };
}

const firstFrameOf = (timeline, shot) => Math.round(shot.start * timeline.fps);
const lastFrameOf = (timeline, shot) => Math.round(shot.end * timeline.fps) - 1;

// The frame nearest second `t` that is inside `shot`.
function frameIn(timeline, shot, t) {
  return Math.min(lastFrameOf(timeline, shot), Math.max(firstFrameOf(timeline, shot), Math.round(t * timeline.fps)));
}

// The shot's moments in the order the brief lists them; a frame reached twice keeps its first role.
function shotMoments(film, timeline, index) {
  const shot = timeline.shots[index];
  const fixed = [START_OFFSET, shot.duration * MIDDLE, shot.duration * LATE].map((offset) => ({ role: 'frame', t: shot.start + offset }));
  const landings = (film.shots[index].on ?? []).map((item) => ({ role: 'landing', t: shot.start + resolveAnchor(item.at, shot) + LANDING_OFFSET }));
  const steps = Array.from({ length: Math.max(0, Math.ceil((shot.duration - START_OFFSET) / STEP)) }, (_, k) => ({ role: 'frame', t: shot.start + START_OFFSET + k * STEP }));
  const seen = new Set();
  return [...fixed, ...landings, ...steps].flatMap(({ role, t }) => {
    const frame = frameIn(timeline, shot, t);
    if (seen.has(frame)) return [];
    seen.add(frame);
    return [{ role, frame }];
  }).sort((a, b) => a.frame - b.frame);
}

function shotSheet(film, timeline, index) {
  const shot = timeline.shots[index];
  const moments = shotMoments(film, timeline, index);
  const tiles = moments.map(({ role, frame }) => tile(timeline, role, frame, shot.id));
  const late = frameIn(timeline, shot, shot.start + shot.duration * LATE);
  return { name: `${shot.id}.png`, kind: 'shot', shot: shot.id, tiles: [...tiles, tile(timeline, 'phone', late, shot.id, { width: PHONE_TILE_WIDTH })] };
}

// The frames of a cut's window, from the incoming shot's first frame for the cut's length (at least that one frame,
// at most the shot), plus CUT_SIDE_FRAMES each side, inside the film.
function cutFrames(film, timeline, index) {
  const to = timeline.shots[index];
  const cut = registries.cuts.get(film.shots[index].cut ?? 'cut');
  const first = firstFrameOf(timeline, to);
  const windowFrames = Math.max(1, Math.min(Math.round(cut.dur * timeline.fps), lastFrameOf(timeline, to) - first + 1));
  const from = Math.max(0, first - CUT_SIDE_FRAMES), until = Math.min(timeline.frameCount - 1, first + windowFrames - 1 + CUT_SIDE_FRAMES);
  return Array.from({ length: until - from + 1 }, (_, k) => from + k);
}

function cutSheet(film, timeline, index) {
  const [from, to] = [timeline.shots[index - 1], timeline.shots[index]];
  const tiles = cutFrames(film, timeline, index).map((frame) => tile(timeline, 'frame', frame, shotAtFrame(timeline, frame).id));
  return { name: `cut-${from.id}-${to.id}.png`, kind: 'cut', shot: to.id, tiles };
}

// A name used before gets -2, -3 ... until it is free, so a shot called "cut-a-b" cannot overwrite the strip of the cut
// from a to b, and a renamed strip cannot land on the name of another shot.
function uniqueNames(sheets) {
  const used = new Set();
  return sheets.map((sheet) => {
    const base = sheet.name.slice(0, -'.png'.length);
    let name = sheet.name, n = 1;
    while (used.has(name)) {
      n += 1;
      name = `${base}-${n}.png`;
    }
    used.add(name);
    return name === sheet.name ? sheet : { ...sheet, name };
  });
}

/**
 * @returns {{ name: string, kind: 'shot' | 'cut', shot: string, tiles: { role: 'frame' | 'landing' | 'phone', frame: number, t: number, label: string, width?: number }[] }[]}
 *   shot sheets in film order, then the cut strips
 */
export function planSheets(film, timeline) {
  const shots = timeline.shots.map((_, index) => shotSheet(film, timeline, index));
  const cuts = timeline.shots.slice(1).map((_, i) => cutSheet(film, timeline, i + 1));
  return uniqueNames([...shots, ...cuts]);
}

/** The frames the audit looks at: every sheet frame (this includes every `on` event's landing + 0.05 s, wherever it
 *  falls), one every 0.25 s, the first frame of each shot (what a cut opens on) and the last frame of each shot (its resting state, which says which words stay hidden), each
 *  once, in order. */
export function auditMoments(film, timeline) {
  const frames = new Set(planSheets(film, timeline).flatMap((sheet) => sheet.tiles.map((t) => t.frame)));
  timeline.shots.forEach((shot, index) => {
    frames.add(firstFrameOf(timeline, shot));
    frames.add(lastFrameOf(timeline, shot));
    // the first frame that shows the shot alone after its cut (a punch's frame after p 0), for the opening rule
    const alone = index === 0 ? null : aloneFromFrame(film.shots[index].cut);
    if (alone !== null) frames.add(Math.min(lastFrameOf(timeline, shot), firstFrameOf(timeline, shot) + alone));
  });
  for (let t = 0; t < timeline.duration; t += AUDIT_STEP) frames.add(Math.min(timeline.frameCount - 1, Math.round(t * timeline.fps)));
  return [...frames].sort((a, b) => a - b);
}

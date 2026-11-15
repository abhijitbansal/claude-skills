// What to look at: the review sheets of a film, planned from its timeline alone (no browser). A shot gets one sheet
// tiling its start + 0.1 s, its middle, its 85% point and each `on` event's landing + 0.05 s, in time order, plus the
// 85% frame again as a 360 px phone tile; each cut gets a strip of 5 frames from 0.2 s before to 0.2 s after.
// auditMoments adds a frame every half second so the audit sees more than the sheets do.
import { resolveAnchor } from '../../engine/script/anchors.mjs';
import { shotAtFrame } from '../../engine/review/pacing.mjs';

export const PHONE_TILE_WIDTH = 360;
const START_OFFSET = 0.1;
const MIDDLE = 0.5;
const LATE = 0.85;
const LANDING_OFFSET = 0.05;
const CUT_OFFSETS = Object.freeze([-0.2, -0.1, 0, 0.1, 0.2]);
const AUDIT_STEP = 0.5;
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
  const seen = new Set();
  return [...fixed, ...landings].flatMap(({ role, t }) => {
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

function cutSheet(timeline, index) {
  const [from, to] = [timeline.shots[index - 1], timeline.shots[index]];
  const last = timeline.frameCount - 1;
  const tiles = CUT_OFFSETS.map((offset) => {
    const frame = Math.min(last, Math.max(0, Math.round((to.start + offset) * timeline.fps)));
    return tile(timeline, 'frame', frame, shotAtFrame(timeline, frame).id);
  });
  return { name: `cut-${from.id}-${to.id}.png`, kind: 'cut', shot: to.id, tiles };
}

// A name used before gets -2, -3 ... so a shot called "cut-a-b" cannot overwrite the strip of the cut from a to b.
function uniqueNames(sheets) {
  const used = new Map();
  return sheets.map((sheet) => {
    const base = sheet.name.slice(0, -'.png'.length);
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return n === 1 ? sheet : { ...sheet, name: `${base}-${n}.png` };
  });
}

/**
 * @returns {{ name: string, kind: 'shot' | 'cut', shot: string, tiles: { role: 'frame' | 'landing' | 'phone', frame: number, t: number, label: string, width?: number }[] }[]}
 *   shot sheets in film order, then the cut strips
 */
export function planSheets(film, timeline) {
  const shots = timeline.shots.map((_, index) => shotSheet(film, timeline, index));
  const cuts = timeline.shots.slice(1).map((_, i) => cutSheet(timeline, i + 1));
  return uniqueNames([...shots, ...cuts]);
}

/** The frames the audit looks at: every sheet frame, one per half second and the last frame of each shot (its resting
 *  state, which says which words stay hidden), each once, in order. */
export function auditMoments(film, timeline) {
  const frames = new Set(planSheets(film, timeline).flatMap((sheet) => sheet.tiles.map((t) => t.frame)));
  timeline.shots.forEach((shot) => frames.add(lastFrameOf(timeline, shot)));
  for (let t = 0; t < timeline.duration; t += AUDIT_STEP) frames.add(Math.min(timeline.frameCount - 1, Math.round(t * timeline.fps)));
  return [...frames].sort((a, b) => a - b);
}

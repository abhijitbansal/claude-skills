// A whole film as frames: buildFilm expands every shot once through its kind, places it on the global clock, applies
// each shot's camera, and runs the cut that brings a shot in over its first `dur` seconds. sampleAt(t) is a pure
// function of t (nothing is cached between calls that could depend on their order). Pure and DOM-free: the caller
// passes the canvas size, the text measure and the loaded pictures' sizes.
import { registries } from '../registry.mjs';
import '../looks/index.mjs';
import '../modes/index.mjs';
import '../kinds/index.mjs';
import '../cuts/index.mjs';
import { applyAccent, gridX } from '../looks/index.mjs';
import { unitOf } from '../units.mjs';
import { srcsOfShot } from '../assets.mjs';
import { resolveAnchor } from '../script/anchors.mjs';
import { sampleGraph } from './sample.mjs';
import { camera as trackCamera, applyCamera, layeredCamera } from './camera.mjs';

const DEFAULT_MODE = 'pro';
const DEFAULT_SEED = 1;
const DEFAULT_CUT = 'cut';
const DEFAULT_BACKGROUND = '#000000';
const TIME_DECIMALS = 1e9; // shot-local time is rounded to 1e-9 s, so float noise cannot change a sample
const DEGREES_TO_RADIANS = Math.PI / 180;

/** The film's look: its `look`, else its mode's default, with the film's `accent` applied. */
export function resolveLook(film) {
  const mode = registries.modes.get(film.mode ?? DEFAULT_MODE);
  const look = registries.looks.get(film.look ?? mode.defaultLook);
  return film.accent === undefined ? look : applyAccent(look, film.accent);
}

// ctx.asset(src) for a shot: the size of one of the srcs the shot declares; any other string is an error.
function shotAsset(shot, kind, assets) {
  const declared = new Set(srcsOfShot(shot, kind.srcFields));
  return (src) => {
    if (!declared.has(src)) throw new Error(`shot "${shot.id}": "${src}" is not one of its srcs (it declares ${declared.size === 0 ? 'none' : [...declared].map((s) => `"${s}"`).join(', ')})`);
    const image = assets.get(src);
    if (!image) throw new Error(`shot "${shot.id}": no loaded picture for "${src}"`);
    return { width: image.width, height: image.height };
  };
}

/**
 * The ctx a kind's expand(shot, ctx) gets for shot `index`. `assets` maps a src to its picture (anything with a size).
 * `viralInsets` is the platform safe zone for this canvas (template/formats.mjs safeInsets with VIRAL_SAFE_ZONE),
 * which a viral look composes inside on 9:16; null leaves every look on the canvas.
 */
export function shotContext({ film, index, timeline, canvas, measure, assets = new Map(), look = resolveLook(film), viralInsets = null }) {
  const shot = film.shots[index];
  const timing = timeline.shots[index];
  const kind = registries.kinds.get(shot.show);
  return {
    look,
    mode: registries.modes.get(film.mode ?? DEFAULT_MODE),
    canvas,
    unit: unitOf(canvas),
    gridX: (column) => gridX(look, canvas, column),
    timing,
    at: (ref) => resolveAnchor(ref, timing),
    measure,
    seed: film.seed ?? DEFAULT_SEED,
    fps: timeline.fps,
    viralInsets,
    asset: shotAsset(shot, kind, assets),
    // the shot's 1-based place among the film's numbered shots (kinds with `numbered: true`): what a slug shows
    ordinal: film.shots.slice(0, index + 1).filter((s) => registries.kinds.has(s.show) && registries.kinds.get(s.show).numbered === true).length,
  };
}

// ---- camera ----

/**
 * A shot's camera as (t) => { x, y, zoom, rotate }. A kind gives either a track map (free) or layers of keys, which
 * add: pans and turns sum, zooms multiply, so a drift, a push and a punch combine (camera.mjs layeredCamera).
 */
function cameraOf(spec, canvas, where) {
  if (spec === undefined) return trackCamera({ canvas });
  if (!Array.isArray(spec)) return trackCamera({ tracks: spec, canvas });
  return layeredCamera(spec, where);
}

// ---- hero boxes ----

function matrixOf({ x = 0, y = 0, rotate = 0, scale = 1, scaleX = 1, scaleY = 1 }) {
  const a = rotate * DEGREES_TO_RADIANS, cos = Math.cos(a), sin = Math.sin(a);
  return [cos * scale * scaleX, sin * scale * scaleX, -sin * scale * scaleY, cos * scale * scaleY, x, y];
}

function invert([a, b, c, d, e, f]) {
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

const apply = (m, [px, py]) => [m[0] * px + m[2] * py + m[4], m[1] * px + m[3] * py + m[5]];

// The hero's resting box moved by however the node now stands (its tracks and the camera) relative to its rest pose.
function heroBox(n, rest) {
  const back = invert(matrixOf(rest.pose));
  const now = matrixOf(n);
  const [x, y, w, h] = rest.box;
  const corners = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map((p) => apply(now, apply(back, p)));
  const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
}

// ---- shots ----

function expandOne({ film, timeline, index, canvas, measure, assets, look, viralInsets }) {
  const shot = film.shots[index];
  const timing = timeline.shots[index];
  const kind = registries.kinds.get(shot.show);
  const out = kind.expand(shot, shotContext({ film, index, timeline, canvas, measure, assets, look, viralInsets }));
  if (!out || !Array.isArray(out.nodes)) throw new Error(`kind "${shot.show}" must return { nodes: [...] } for shot "${shot.id}"`);
  const heroNode = out.hero === undefined ? undefined : out.nodes.find((n) => n.id === out.hero);
  const box = kind.heroTarget === undefined ? undefined : out.boxes?.[kind.heroTarget];
  const cut = index === 0 ? null : registries.cuts.get(shot.cut ?? DEFAULT_CUT);
  return {
    start: timing.start,
    duration: timing.duration,
    nodes: out.nodes,
    cam: cameraOf(out.camera, canvas, `shot "${shot.id}"`),
    background: out.background ?? DEFAULT_BACKGROUND,
    hero: heroNode && box ? { id: heroNode.id, box, pose: heroNode.props } : null,
    cut,
    cutDur: cut ? Math.min(cut.dur, timing.duration) : 0,
  };
}

/**
 * @param {{ film: object, timeline: object, measure: Function, assets?: Map<string, { width: number, height: number }>,
 *   canvas: { w: number, h: number }, viralInsets?: { top, right, bottom, left } }} opts the film (defaults resolved here: mode, look, seed, accent), its timeline
 *   (buildTimeline), the text measure, the pictures by src, the canvas size of the film's format and the platform safe
 *   zone (see shotContext)
 * @returns {{ duration: number, frameCount: number, look: object, frameAt(t): { background: string, sampled: object[] },
 *   sampleAt(t): object[], sampleShot(index, t): object[] }}
 */
export function buildFilm({ film, timeline, measure, assets = new Map(), canvas, viralInsets = null }) {
  if (!film || !Array.isArray(film.shots)) throw new Error('buildFilm: film must have a shots array');
  if (!timeline || timeline.shots?.length !== film.shots.length) throw new Error('buildFilm: timeline must have one entry per shot (see buildTimeline)');
  if (timeline.shots.length === 0) throw new Error('the film has no shots');
  if (!(canvas?.w > 0 && canvas?.h > 0)) throw new Error('buildFilm: canvas must be { w, h }');
  const look = resolveLook(film);
  const shots = timeline.shots.map((_, index) => expandOne({ film, timeline, index, canvas, measure, assets, look, viralInsets }));

  // One shot alone at its local time t: sampled, camera applied, the hero carrying its box.
  const sampleShot = (index, t) => {
    const shot = shots[index];
    const sampled = applyCamera(sampleGraph(shot.nodes, t), shot.cam(t), canvas);
    if (!shot.hero) return sampled;
    return Object.freeze(sampled.map((n) => (n.id === shot.hero.id ? Object.freeze({ ...n, bbox: heroBox(n, shot.hero) }) : n)));
  };

  // The shot whose [start, end) holds t; the last shot also owns t === duration.
  const shotIndexAt = (t) => {
    if (!Number.isFinite(t) || t < 0 || t > timeline.duration + 1 / TIME_DECIMALS) throw new Error(`time must be in 0..${timeline.duration}, got ${t}`);
    return shots.findLastIndex((s) => s.start <= t + 1 / TIME_DECIMALS);
  };

  const frameAt = (t) => {
    const index = shotIndexAt(t);
    const shot = shots[index];
    const local = Math.round((t - shot.start) * TIME_DECIMALS) / TIME_DECIMALS + 0; // + 0 turns -0 into 0
    if (!shot.cut || local >= shot.cutDur) return { background: shot.background, sampled: sampleShot(index, local) };
    const from = sampleShot(index - 1, shots[index - 1].duration);
    // `frame`: how far p moves in one frame, for the cuts that smear what they move, given only in a look that asks for the
    // smear (look.smear); `background`: painted under each smear sample so that it covers the frame
    const frame = look.smear === true ? 1 / (timeline.fps * shot.cutDur) : undefined;
    const sampled = shot.cut.apply({ from, to: sampleShot(index, local), p: local / shot.cutDur, canvas, look, frame, background: shot.background });
    return { background: shot.background, sampled };
  };

  return {
    duration: timeline.duration,
    frameCount: timeline.frameCount,
    look,
    frameAt,
    sampleAt: (t) => frameAt(t).sampled,
    sampleShot,
  };
}

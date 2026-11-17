// A whole film as frames: buildFilm expands every shot once through its kind, places it on the global clock, applies
// each shot's camera, and runs the cut that brings a shot in over its first `dur` seconds. A captioned film (its
// `captions`, else its mode's) adds each narrated shot's captions after the kind's nodes (engine/captions). sampleAt(t) is a pure
// function of t (nothing is cached between calls that could depend on their order). Pure and DOM-free: the caller
// passes the canvas size, the text measure and the loaded pictures' sizes.
import { registries } from '../registry.mjs';
import '../looks/index.mjs';
import '../modes/index.mjs';
import '../kinds/index.mjs';
import '../cuts/index.mjs';
import { resolveShotCut, explicitCut } from '../cuts/resolve.mjs';
import { smearPlan, smearsAlong } from '../cuts/smear.mjs';
import { applyAccent, gridX, lookForFormat } from '../looks/index.mjs';
import { unitOf } from '../units.mjs';
import { srcsOfShot } from '../assets.mjs';
import { resolveAnchor } from '../script/anchors.mjs';
import { captionsOn, shotCaptions, kindContext } from '../captions/index.mjs';
import { sampleGraph } from './sample.mjs';
import { handLayer } from '../hand/index.mjs';
import { hasGrounds, shotLook, groundSheet } from '../looks/grounds.mjs';
import { node } from './node.mjs';
import { FIELD_ID } from '../kinds/shared.mjs';
import { stackArea } from '../kinds/stack.mjs';
import { withLookEmphasis } from '../kinds/emphasis-fallback.mjs';
import { localMatrix } from '../page/bounds.mjs';
import { camera as trackCamera, applyCamera, layeredCamera } from './camera.mjs';

const DEFAULT_MODE = 'pro';
const DEFAULT_SEED = 1;
const DEFAULT_BACKGROUND = '#000000';
const TIME_DECIMALS = 1e9; // shot-local time is rounded to 1e-9 s, so float noise cannot change a sample

/** Film second `t` as a time inside a shot that starts at `start`, rounded to 1e-9 s so float noise cannot change a
 *  sample: the drawn frame (frameAt) and the audited one (the page's __snapshotShot) read a shot at the same time. */
export const shotTime = (t, start) => Math.round((t - start) * TIME_DECIMALS) / TIME_DECIMALS + 0; // + 0 turns -0 into 0

/** The film's look: its `look`, else its mode's default, with the film's `accent` applied and its format's grid
 *  (lookForFormat: the same object for a look with one grid). */
export function resolveLook(film) {
  const mode = registries.modes.get(film.mode ?? DEFAULT_MODE);
  const look = lookForFormat(registries.looks.get(film.look ?? mode.defaultLook), film.format ?? mode.defaultFormat);
  return film.accent === undefined ? look : applyAccent(look, film.accent);
}

/** The look shot `index` of `film` draws with: resolveLook, on the shot's ground for a look that paints one a shot. */
export const lookOfShot = (film, index) => shotLook(resolveLook(film), index, film.seed ?? DEFAULT_SEED, showsOf(film));

// each shot's kind, in order (a look's kind may name the grounds it stands on: grounds.mjs groundKeys)
const showsOf = (film) => film.shots.map((s) => s?.show);

// ctx.asset(src) for a shot: the size of one of the srcs the shot declares; any other string is an error.
function shotAsset(shot, kind, assets) {
  const declared = new Set(srcsOfShot(shot, kind.srcFields));
  return (src) => {
    if (!declared.has(src)) throw new Error(`shot "${shot.id}": "${src}" is not one of its srcs (it declares ${declared.size === 0 ? 'none' : [...declared].map((s) => `"${s}"`).join(', ')})`);
    const image = assets.get(src);
    if (!image) throw new Error(`shot "${shot.id}": no loaded picture for "${src}"`);
    // a clip's decoded frames ({ from, fps, count }: engine/kinds/media-clip.mjs) and a picture's transparency ride along
    return { width: image.width, height: image.height, ...(image.clip ? { clip: image.clip } : {}), ...(image.alpha === true ? { alpha: true } : {}) };
  };
}

// { prepared } for a shot whose kind declares `prepared: true`: its entry in the film's prepared data (by shot id), which
// must be there; {} for any other kind. A missing entry is an error naming the shot, never an empty frame.
function preparedOf(shot, kind, prepared) {
  if (kind.prepared !== true) return {};
  const entry = prepared?.[shot.id];
  if (entry === undefined || entry === null) throw new Error(`shot "${shot.id}": kind "${shot.show}" needs prepared data and got none (scripts/v2/prepare)`);
  return { prepared: entry };
}

// Does a shot count among the film's numbered shots? Its kind says so: `numbered` true, or a function of the shot.
const isNumbered = (kind, shot) => (typeof kind.numbered === 'function' ? kind.numbered(shot) === true : kind.numbered === true);

/**
 * The ctx a kind's expand(shot, ctx) gets for shot `index`. `assets` maps a src to its picture (anything with a size).
 * `viralInsets` is the platform safe zone for this canvas (template/formats.mjs safeInsets with VIRAL_SAFE_ZONE),
 * which a viral look composes inside on 9:16; null leaves every look on the canvas.
 */
export function shotContext({ film, index, timeline, canvas, measure, assets = new Map(), look = resolveLook(film), viralInsets = null, prepared = {} }) {
  const shot = film.shots[index];
  const timing = timeline.shots[index];
  const kind = registries.kinds.get(shot.show);
  return {
    // the shot's prepared data (scripts/v2/prepare, sent with the film), for a kind that declares `prepared: true`
    ...preparedOf(shot, kind, prepared),
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
    captions: captionsOn(film, registries.modes.get(film.mode ?? DEFAULT_MODE)), // whether the film shows captions
    asset: shotAsset(shot, kind, assets),
    // the shot's 1-based place among the film's numbered shots (kinds with `numbered: true`): what a slug shows
    // (a kind's `numbered` may be a function of the shot: a compare counts only when it shows a slug)
    ordinal: film.shots.slice(0, index + 1).filter((s) => registries.kinds.has(s.show) && isNumbered(registries.kinds.get(s.show), s)).length,
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

// A pose as a matrix: page/bounds.mjs localMatrix, the one place a node's transform becomes one, with a pose's missing
// fields at rest.
const matrixOf = ({ x = 0, y = 0, rotate = 0, scale = 1, scaleX = 1, scaleY = 1 }) => localMatrix({ x, y, rotate, scale, scaleX, scaleY });

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

// The shot's nodes: its kind's, then its captions (drawn last, pinned over everything) when the film is captioned. `cam`
// is the shot's camera, for where its marks stand on the frame (the captions keep off them).
function withCaptions(out, shot, kind, ctx, film, cam) {
  if (!captionsOn(film, ctx.mode)) return out.nodes;
  const captions = shotCaptions(shot, ctx, { kind, hero: out.hero ?? null, filmStart: ctx.timing.start, nodes: out.nodes, camera: cam });
  return captions.length === 0 ? out.nodes : [...out.nodes, ...captions];
}

// A grounded look's shot (engine/looks/grounds.mjs, poster): the ground sheet first, and the field told the text area
// its cut-paper shapes keep clear of, at depth 0 so each shot keeps its own ground through a cut. Any other look, and a
// shot that draws no look field (a free shot, written by hand with its own background): the nodes as they are.
function groundLayer(nodes, ctx) {
  if (!hasGrounds(ctx.look) || !nodes.some((n) => n.type === 'field' && n.id === FIELD_ID)) return nodes;
  const area = stackArea(ctx);
  const clear = [area.left, area.top, area.w, area.h];
  const field = (n) => node('field', n.id, { ...n.props, params: { ...n.props.params, clear } }, { depth: 0 });
  return [groundSheet(ctx.look, ctx.canvas), ...nodes.map((n) => (n.type === 'field' && n.id === FIELD_ID ? field(n) : n))];
}

function expandOne({ film, timeline, index, canvas, measure, assets, look: filmLook, viralInsets, prepared }) {
  const shot = film.shots[index];
  const timing = timeline.shots[index];
  const kind = registries.kinds.get(shot.show);
  // the look this shot draws with: the film's, on the shot's ground for a look that paints one a shot
  const look = shotLook(filmLook, index, film.seed ?? DEFAULT_SEED, showsOf(film));
  const ctx = shotContext({ film, index, timeline, canvas, measure, assets, look, viralInsets, prepared });
  // the cut that opens the shot (the film's root cut and the look's cutStyle included), and the shot as its kind sees it:
  // with that cut written out in full, so a kind reading shot.cut (its camera, its opening) sees the cut the film draws
  const cut = resolveShotCut(film, index, { look });
  const kindShot = cut === null ? shot : { ...shot, cut: explicitCut(cut) };
  const out = kind.expand(kindShot, kindContext(film, kind, ctx)); // a captioned shot's kind keeps clear of the captions
  if (!out || !Array.isArray(out.nodes)) throw new Error(`kind "${shot.show}" must return { nodes: [...] } for shot "${shot.id}"`);
  const heroNode = out.hero === undefined ? undefined : out.nodes.find((n) => n.id === out.hero);
  const box = kind.heroTarget === undefined ? undefined : out.boxes?.[kind.heroTarget];
  const cam = cameraOf(out.camera, canvas, `shot "${shot.id}"`);
  return {
    start: timing.start,
    duration: timing.duration,
    // a look with `hand` data draws the shot with the drawing hand (engine/hand); any other look: the nodes as they are
    nodes: handLayer(groundLayer(withCaptions(out, shot, kind, ctx, film, cam), ctx), timing, ctx),
    cam,
    background: out.background ?? DEFAULT_BACKGROUND,
    hero: heroNode && box ? { id: heroNode.id, box, pose: heroNode.props } : null,
    cut,
    cutDur: cut ? Math.min(cut.dur, timing.duration) : 0,
  };
}

/**
 * A frame inside a smeared cut's window (engine/cuts/smear.mjs): `sampled` holds the nodes that do not move, and
 * `smear` the moving nodes at each sample's progress (layers), the gap between neighbouring copies in pixels, the unit
 * vector of the motion (null for a zoom), the nodes drawn over them, the cut, its direction and progress (the frame's
 * key), and `whole`, the frame's nodes at its own progress without the smear: what the review audits and sampleAt gives.
 * The page draws the still nodes, the mean of the layers over them, then `over`.
 */
function smearedFrame(shot, args, frame) {
  const parts = shot.cut.entry.parts(args);
  // a move across the axes the look smears along (cutStyle.<cut>.smearAxes) draws its plain frame
  if (!smearsAlong(parts.vector, args.look?.cutStyle?.[shot.cut.name]?.smearAxes)) return { background: shot.background, sampled: shot.cut.entry.apply(args) };
  const plan = smearPlan({ p: args.p, frame, travel: parts.travel, shutter: args.look?.cutMotion?.smearShutter });
  return {
    background: shot.background,
    sampled: Object.freeze(parts.still),
    smear: Object.freeze({
      layers: Object.freeze(plan.samples.map((q) => Object.freeze(parts.moving(q)))),
      gapPx: plan.gapPx,
      vector: parts.vector,
      over: Object.freeze(parts.over),
      cut: Object.freeze({ name: shot.cut.name, direction: shot.cut.direction, p: args.p }),
      whole: Object.freeze([...parts.still, ...parts.moving(args.p), ...parts.over]),
    }),
  };
}

/**
 * @param {{ film: object, timeline: object, measure: Function, assets?: Map<string, { width: number, height: number }>,
 *   canvas: { w: number, h: number }, viralInsets?: { top, right, bottom, left }, prepared?: Record<string, object> }} opts the film (defaults resolved here: mode, look, seed, accent), its timeline
 *   (buildTimeline), the text measure, the pictures by src, the canvas size of the film's format, the platform safe
 *   zone (see shotContext) and the prepared data by shot id (scripts/v2/prepare; a kind with `prepared: true` needs its
 *   shot's entry)
 * @returns {{ duration: number, frameCount: number, look: object, frameAt(t): { background: string, sampled: object[] },
 *   sampleAt(t): object[], sampleShot(index, t): object[], backgrounds: string[] }}
 */
export function buildFilm({ film: given, timeline, measure, assets = new Map(), canvas, viralInsets = null, prepared = {} }) {
  if (!given || !Array.isArray(given.shots)) throw new Error('buildFilm: film must have a shots array');
  // the shots buildTimeline timed: an emphasis device the look does not draw is the look's emphasis on its word
  const { film } = withLookEmphasis(given);
  if (!timeline || timeline.shots?.length !== film.shots.length) throw new Error('buildFilm: timeline must have one entry per shot (see buildTimeline)');
  if (timeline.shots.length === 0) throw new Error('the film has no shots');
  if (!(canvas?.w > 0 && canvas?.h > 0)) throw new Error('buildFilm: canvas must be { w, h }');
  const look = resolveLook(film);
  const shots = timeline.shots.map((_, index) => expandOne({ film, timeline, index, canvas, measure, assets, look, viralInsets, prepared }));

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
    const local = shotTime(t, shot.start);
    if (!shot.cut || local >= shot.cutDur) return { background: shot.background, sampled: sampleShot(index, local) };
    const from = sampleShot(index - 1, shots[index - 1].duration);
    // a layer or shader cut composes two pictures in the page: the incoming shot live, the outgoing one frozen at its end
    // (`t`: the film second it froze at, the time its fields are painted with)
    if (shot.cut.family !== 'node') {
      const prev = shots[index - 1];
      return {
        background: shot.background,
        sampled: sampleShot(index, local),
        cut: { name: shot.cut.name, family: shot.cut.family, p: local / shot.cutDur, direction: shot.cut.direction },
        from: { shot: index - 1, background: prev.background, sampled: from, t: prev.start + prev.duration },
      };
    }
    const args = { from, to: sampleShot(index, local), p: local / shot.cutDur, canvas, look, background: shot.background, direction: shot.cut.direction };
    // the smear, when the resolved cut asks for it (the shot's, the root cut's or the look's cutStyle), inside the window
    if (shot.cut.smear && args.p > 0 && args.p < 1) return smearedFrame(shot, args, 1 / (timeline.fps * shot.cutDur));
    return { background: shot.background, sampled: shot.cut.entry.apply(args) };
  };

  return {
    duration: timeline.duration,
    frameCount: timeline.frameCount,
    look,
    frameAt,
    sampleAt: (t) => {
      const frame = frameAt(t);
      return frame.smear?.whole ?? frame.sampled;
    },
    sampleShot,
    backgrounds: Object.freeze(shots.map((s) => s.background)), // per shot, the colour painted under it
  };
}

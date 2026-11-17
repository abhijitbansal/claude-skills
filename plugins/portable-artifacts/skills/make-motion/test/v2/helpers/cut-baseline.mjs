// Today's cut frames, pinned (cuts-resolve.test.mjs, fixtures/cuts/baseline-keys.json). Two halves:
//   - what each of cut, slide, punch and match returns from apply() at BASELINE_PS for two small hand-written node lists
//     (a shared background behind the picture plane, a shared hero with a box, two unshared nodes, one of them pinned),
//     with and without `frame`. The lists live here, so a change to a kind or a look cannot move them.
//   - the state of every frame inside the cut windows of references/examples/v2/gate-pop.json (two punches; gate-desk
//     has hard cuts only), built with buildFilm, the estimated timeline and the stand-in text measure of helpers/kinds.mjs.
//     This half is regenerated, with a stated reason, if that film or the pop look changes under it.
// Each state is reduced to a SHA-256 of its stateKey so the fixture stays small. This file imports nothing but node:crypto:
// the engine it reads is passed in, so the same code runs against the working tree (the test) and against a scratch
// copy of HEAD (the one-time generator, .scratch/t1/baseline.mjs).
import { createHash } from 'node:crypto';

export const BASELINE_CUTS = Object.freeze(['cut', 'slide', 'punch', 'match']);
export const BASELINE_PS = Object.freeze([0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]);
export const BASELINE_FILM = 'gate-pop';
const CANVAS = Object.freeze({ w: 1920, h: 1080 });
const FRAME = 1 / 12; // how far p moves in one frame of a 0.4 s cut at 30 fps
const BACKGROUND = '#102030';
const FRAME_EPSILON = 1e-9;
const DEFAULT_FPS = 30; // a film that names no fps (scripts/v2/spec.mjs DEFAULT_FPS)
const PICTURES = Object.freeze({ 'clipping.png': [1600, 1000] }); // the picture the film names, at its real size

const sha = (text) => createHash('sha256').update(text).digest('hex');

// A sampled node as sampleGraph gives one, at rest but for `extra`.
const sampledNode = (type, id, props, extra = {}) => Object.freeze({
  type, id, depth: 0, props: Object.freeze(props),
  x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, draw: 1, reveal: 1, blur: 0, visible: true,
  children: Object.freeze([]), ...extra,
});

const box = (fill) => ({ d: 'M0 0H200V120H0Z', fill });
const field = (x) => sampledNode('path', 'field', { d: `M0 0H${CANVAS.w}V${CANVAS.h}H0Z`, fill: '#f3eee3' }, { depth: 1, x });

// The outgoing and the incoming frame: a shared field (moved a little in the outgoing one, as a pushed-in shot leaves
// it), a shared hero with a bbox, and one unshared node each; the incoming one's is pinned (props.fixed).
export const FROM = Object.freeze([
  field(12),
  sampledNode('path', 'hero', box('#15130f'), { x: 300, y: 400, bbox: [300, 400, 200, 120] }),
  sampledNode('path', 'a', box('#aa3300'), { x: 900, y: 200, opacity: 0.8 }),
]);
export const TO = Object.freeze([
  field(0),
  sampledNode('path', 'hero', box('#15130f'), { x: 1100, y: 500, scale: 1.5, rotate: 10, bbox: [1100, 500, 300, 180] }),
  sampledNode('path', 'b', { ...box('#0033aa'), fixed: true }, { x: 100, y: 900 }),
]);

/** { "<cut> p<p> <frame|still>": sha } for every cut in BASELINE_CUTS at every p in BASELINE_PS. `cuts` is the cuts
 *  registry of the tree being pinned or checked, `stateKey` its graph/sample.mjs stateKey. */
export function nodeCutKeys({ cuts, stateKey }) {
  const out = {};
  for (const name of BASELINE_CUTS) {
    for (const p of BASELINE_PS) {
      for (const frame of [undefined, FRAME]) {
        const sampled = cuts.get(name).apply({ from: FROM, to: TO, p, canvas: CANVAS, frame, background: BACKGROUND });
        out[`${name} p${p} ${frame === undefined ? 'still' : 'frame'}`] = sha(stateKey(sampled));
      }
    }
  }
  return out;
}

/** { <cut>: { dur, incomingOnly } } for every cut in BASELINE_CUTS: the window each one opens, which says which frames
 *  of a film the cut draws (a slide of 0.5 s would move every frame after its 12th). */
export function cutWindows({ cuts }) {
  return Object.fromEntries(BASELINE_CUTS.map((name) => [name, { dur: cuts.get(name).dur, incomingOnly: cuts.get(name).incomingOnly === true }]));
}

/** { "frame <i>": sha } for every frame inside a cut window of `film` (a shot's first frame for its cut's length). `engine`:
 *  { cuts, stateKey, buildTimeline, buildFilm, measure, canvasOf, viralOf } of the tree being pinned or checked. */
export function filmCutKeys(engine, film) {
  const { cuts, stateKey, buildTimeline, buildFilm, measure, canvasOf, viralOf } = engine;
  const timeline = buildTimeline(film, { fps: film.fps ?? DEFAULT_FPS });
  const canvas = canvasOf(film.format);
  const assets = new Map(Object.entries(PICTURES).map(([src, [width, height]]) => [src, { width, height }]));
  const built = buildFilm({ film, timeline, measure, assets, canvas, viralInsets: viralOf(canvas) });
  const out = {};
  film.shots.forEach((shot, index) => {
    if (index === 0 || (shot.cut ?? 'cut') === 'cut') return;
    const first = Math.round(timeline.shots[index].start * timeline.fps);
    const count = Math.ceil(cuts.get(shot.cut).dur * timeline.fps - FRAME_EPSILON);
    for (let i = first; i < first + count; i += 1) out[`frame ${i}`] = sha(stateKey(built.frameAt(i / timeline.fps)));
  });
  return out;
}

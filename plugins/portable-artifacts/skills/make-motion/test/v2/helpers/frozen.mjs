// The frozen expansions of the approved kinds (kinds-frozen.test.mjs): every existing kind's example in desk and pop at
// 16:9 and 9:16, and every shot of the approved films, as a stable JSON of the nodes, tracks and camera, each reduced to
// a SHA-256 so the fixture stays small. This file imports nothing: the engine it reads is passed in, so the same
// serialiser runs against the working tree (the test) and against a scratch copy of HEAD (the one-time generator).
import { createHash } from 'node:crypto';

export const LOOKS = Object.freeze(['desk', 'pop']);
export const FORMATS = Object.freeze(['16:9', '9:16']);
export const FILMS = Object.freeze(['gate-desk', 'gate-pop', 'kinds-desk', 'kinds-pop']);
// The kinds registered when the fixture was made: later kinds are not frozen here.
export const FROZEN_KINDS = Object.freeze(['free', 'statement', 'number', 'clipping', 'end', 'list', 'quote', 'compare', 'chart']);
const FPS = 30;
const SEED = 3;
const FRAME_STEP = 0.1; // s between the sampled frames of a whole film
const EASE_PROBES = Object.freeze([0.1, 0.25, 0.5, 0.75, 0.9]); // an ease is recorded by its value at these fractions
const DECIMALS = 1e6; // numbers are rounded to 1e-6 so float noise in a JSON round trip cannot differ
// The pictures the examples and the approved films name, at their real sizes.
export const PICTURES = Object.freeze({ 'assets/screenshot.png': [640, 400], 'clipping.png': [1600, 1000], 'shot.png': [1600, 1000] });

const round = (v) => Math.round(v * DECIMALS) / DECIMALS + 0;

// JSON with sorted keys at every depth; a function (a track key's ease) becomes its values at EASE_PROBES.
function stable(v) {
  if (typeof v === 'function') return { ease: EASE_PROBES.map((p) => round(v(p))) };
  if (typeof v === 'number') return round(v);
  if (Array.isArray(v)) return v.map(stable);
  if (v === null || typeof v !== 'object') return v;
  return Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, stable(v[k])]));
}

export const stableJson = (v) => JSON.stringify(stable(v));
const sha = (text) => createHash('sha256').update(text).digest('hex');

// The example shot with a device the look has (desk circles, pop underlines), as the examples sweep gives it.
export const exampleFor = (example, look) => ({
  ...example,
  ...(example.on ? { on: example.on.map((item) => ({ ...item, do: look === 'pop' ? 'underline' : item.do })) } : {}),
});

const assetsMap = () => new Map(Object.entries(PICTURES).map(([src, [width, height]]) => [src, { width, height }]));

// Shot `index` of `film` expanded exactly as buildFilm does (kindContext included); only what the frame is made of.
function expandShot(engine, film, index) {
  const { registries, buildTimeline, shotContext, kindContext, measure, canvasOf, viralOf } = engine;
  const timeline = buildTimeline(film, { fps: film.fps });
  const canvas = canvasOf(film.format);
  const ctx = shotContext({ film, index, timeline, canvas, measure, assets: assetsMap(), viralInsets: viralOf(canvas) });
  const kind = registries.kinds.get(film.shots[index].show);
  const out = kind.expand(film.shots[index], kindContext(film, kind, ctx));
  return { nodes: out.nodes, camera: out.camera ?? null, background: out.background ?? null, hero: out.hero ?? null };
}

// Every frame of the film at FRAME_STEP, as buildFilm samples it (cuts, cameras and captions included).
function filmFrames(engine, film) {
  const { buildFilm, buildTimeline, measure, canvasOf, viralOf } = engine;
  const timeline = buildTimeline(film, { fps: film.fps });
  const canvas = canvasOf(film.format);
  const built = buildFilm({ film, timeline, measure, assets: assetsMap(), canvas, viralInsets: viralOf(canvas) });
  const count = Math.floor(built.duration / FRAME_STEP);
  return Array.from({ length: count + 1 }, (_, i) => built.frameAt(Math.min(built.duration, i * FRAME_STEP)));
}

const modeOf = (look) => (look === 'pop' ? 'viral' : 'pro');
const filmOfShot = (shot, look, format) => ({ version: 2, mode: modeOf(look), look, format, fps: FPS, seed: SEED, shots: [shot] });

/**
 * { [entry]: sha256 } for every frozen expansion. `engine` carries the modules of the tree being frozen or checked:
 * { registries, buildTimeline, buildFilm, shotContext, kindContext, measure, canvasOf, viralOf }; `films` maps a film
 * name in FILMS to its parsed JSON.
 */
export function frozenEntries(engine, films) {
  const entries = {};
  for (const name of FROZEN_KINDS) {
    const example = engine.registries.kinds.get(name).example;
    for (const look of LOOKS) {
      for (const format of FORMATS) {
        const film = filmOfShot(exampleFor(example, look), look, format);
        entries[`example ${name} ${look} ${format}`] = sha(stableJson(expandShot(engine, film, 0)));
      }
    }
  }
  for (const name of FILMS) {
    const film = { fps: FPS, ...films[name] };
    film.shots.forEach((shot, index) => {
      entries[`film ${name} shot ${shot.id}`] = sha(stableJson(expandShot(engine, film, index)));
    });
    entries[`film ${name} frames`] = sha(stableJson(filmFrames(engine, film)));
  }
  return entries;
}

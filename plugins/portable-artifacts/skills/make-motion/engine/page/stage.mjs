// The render page's stage. It loads the film from /film.json, loads the fonts the film and its look need, builds the
// film (every shot expanded once through its kind, cuts and cameras applied: engine/graph/film.mjs), then answers
// seeks: __seek(i) draws frame i, __snapshot(i) reports its laid-out nodes, __stateKey(i) a stable key of its state.
// window.__ready resolves once the page can be seeked. A frame is drawn in 2D into an offscreen canvas (window.__source,
// the picture before the post pass) and the visible canvas shows it through the post pass (post.mjs): WebGL2 when the
// browser has it, else a 2D copy with the same grain. __ready reports which as post: 'webgl2' | '2d' and, for '2d',
// postNotice: { reason, failed, dropped } (failed: a shader that would not build; dropped: effects the look asked for).
// __seek draws frames 0 .. frameCount - 1.
import { registries } from '../registry.mjs';
import '../fields/index.mjs';
import { buildFilm, resolveLook } from '../graph/film.mjs';
import { stateKey } from '../graph/sample.mjs';
import { canvasSize, safeInsets, VIRAL_SAFE_ZONE } from '/v1/formats.mjs';
import { drawFrame, resetContext } from './draw.mjs';
import { annotate } from './bounds.mjs';
import { applyFont, createMeasure } from './text-style.mjs';
import { facesFor, loadFaces } from './fonts-shared.mjs';
import { createPost, grainPhase } from './post.mjs';

// The face the review sheets stamp their tiles with; the sheet code reads window.__stampFamily.
const STAMP_FAMILY = 'JetBrains Mono';
const DEFAULT_SEED = 1;
// A field registered with `animated: true` paints from the time (mesh: the blobs sway), so its frames differ though the
// sampled tree is the same. The other fields are painted once and cached.
const isAnimatedField = (name) => registries.fields.has(name) && registries.fields.get(name).animated === true;
const hasAnimatedField = (nodes) => nodes.some((n) => (n.type === 'field' && isAnimatedField(n.props.field)) || hasAnimatedField(n.children));

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

// One picture per distinct src. `srcs` is the server's list from /film.json, and /asset/<n> is its n-th entry.
// A failed fetch or decode rejects naming the src.
async function loadImage(src, n) {
  const res = await fetch(`/asset/${n}`);
  if (!res.ok) throw new Error(`image "${src}" could not be loaded: HTTP ${res.status}`);
  try {
    return await createImageBitmap(await res.blob());
  } catch (err) {
    throw new Error(`image "${src}" could not be loaded: ${err.message}`);
  }
}

async function loadAssets(srcs) {
  const bitmaps = await Promise.all(srcs.map(loadImage));
  return new Map(srcs.map((src, n) => [src, bitmaps[n]]));
}

// The keys that say whether two frames look alike, over `frameState(i)`. drawKey: the sampled state, plus the frame itself
// when a field on screen is painted from the time (the sampled state alone does not say such a field moved). captureKey:
// what frame i looks like once the post pass has run, the 2D key plus the grain pattern when there is grain.
function frameKeys({ frameState, fps, grainNow }) {
  const drawKey = (i) => {
    const state = frameState(i);
    return hasAnimatedField(state.sampled) ? `${stateKey(state)}|frame${i}` : stateKey(state);
  };
  const captureKey = (i) => (grainNow() > 0 ? `${drawKey(i)}|grain${grainPhase(i / fps)}` : drawKey(i));
  return { drawKey, captureKey };
}

// For frames from..to: does each equal the one before it? `key` is one of the keys above.
const heldFlags = (key) => (from, to) => {
  let previous = from > 0 ? key(from - 1) : null;
  return Array.from({ length: to - from + 1 }, (_, j) => {
    const current = key(from + j);
    const same = current === previous;
    previous = current;
    return same;
  });
};

// The measured ink of each line of a text node, [{ ascent, descent }] in the text's own pixels: how far its glyphs
// really reach above and below the baseline (accents, ascenders, descenders). Undefined for a text without a font.
function lineInkOf(ctx) {
  return (n) => {
    const font = n.props.font;
    if (!font) return undefined;
    applyFont(ctx, font, { tracked: true });
    return n.props.layout.lines.map((line) => {
      const m = ctx.measureText(line.words.map((word) => word.text).join(' '));
      return { ascent: m.actualBoundingBoxAscent, descent: m.actualBoundingBoxDescent };
    });
  };
}

// The page's API: what the render, the review and the tests call.
function installApi({ fps, draw, post, source, measure, frameState, keys, setGrain, snapshotOf, snapshotShot }) {
  window.__seek = (i) => {
    draw(i);
    post.render(source, i / fps);
  };
  window.__snapshotShot = snapshotShot;
  window.__source = source; // the frame before the post pass, for tests
  window.__setPost = (next) => { // new strengths for the next __seek, for tests
    post.setStrengths(next);
    if (next.grain !== undefined) setGrain(next.grain);
  };
  window.__stampFamily = STAMP_FAMILY;
  window.__measure = measure; // the layout measure, for tests
  window.__snapshot = (i) => snapshotOf(frameState(i).sampled);
  window.__stateKey = keys.captureKey;
  // withGrain: compared by __stateKey (what is captured), else by the 2D state alone.
  window.__heldFlags = (from, to, withGrain) => heldFlags(withGrain ? keys.captureKey : keys.drawKey)(from, to);
}

async function init() {
  const { film, timeline, assets: srcs } = await fetchJson('/film.json');
  if (timeline.shots.length === 0) throw new Error('the film has no shots');
  const [w, h] = canvasSize(film);
  const canvas = { w, h };
  const element = document.getElementById('stage');
  element.width = w;
  element.height = h;
  const source = new OffscreenCanvas(w, h);
  const ctx = source.getContext('2d');
  const look = resolveLook(film);
  const post = createPost(element, { ...look.post, seed: film.seed ?? DEFAULT_SEED });
  // The designed kinds take their type from the look, so the look's fonts load with any the film names itself.
  await loadFaces(facesFor({ film, fonts: look.fonts, stamp: { family: STAMP_FAMILY } }));
  const assets = await loadAssets(srcs);
  const measure = createMeasure(document.createElement('canvas').getContext('2d'));
  const built = buildFilm({ film, timeline, measure, assets, canvas, viralInsets: safeInsets([w, h], VIRAL_SAFE_ZONE) });
  const { fps, frameCount } = timeline;
  let grain = look.post.grain; // what the post pass is using now (a test may change it)

  const frameState = (i) => {
    if (!Number.isInteger(i) || i < 0 || i > frameCount) throw new Error(`frame must be an integer in 0..${frameCount}, got ${i}`);
    return built.frameAt(i / fps);
  };
  const draw = (i) => {
    const { background, sampled } = frameState(i);
    // frame frameCount is the instant the film ends: it can be sampled but there is no frame to draw
    if (i === frameCount) throw new Error(`frame must be an integer in 0..${frameCount - 1} to draw, got ${i}`);
    resetContext(ctx); // a seek that threw halfway must not leave its clip, alpha or save stack to the next one
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
    drawFrame(ctx, sampled, { assets, canvas, time: i / fps });
  };
  const keys = frameKeys({ frameState, fps, grainNow: () => grain });
  const snapshotOf = (sampled) => annotate(sampled, { lineInk: lineInkOf(document.createElement('canvas').getContext('2d')) });
  // Shot `index` alone at frame i: only its own nodes, as they stand inside a cut window where both shots are drawn.
  const snapshotShot = (index, i) => {
    frameState(i);
    return snapshotOf(built.sampleShot(index, Math.max(0, i / fps - timeline.shots[index].start)));
  };
  installApi({ fps, draw, post, source, measure, frameState, keys, snapshotOf, snapshotShot, setGrain: (value) => { grain = value; } });
  const notice = post.unavailable ? { postNotice: { ...post.unavailable, dropped: post.dropped } } : {};
  return { frameCount, fps, size: [w, h], post: post.kind, ...notice };
}

window.__ready = init();

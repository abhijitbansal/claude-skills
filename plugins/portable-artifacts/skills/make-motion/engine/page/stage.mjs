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
import { buildFilm, resolveLook, shotTime } from '../graph/film.mjs';
import { stateKey } from '../graph/sample.mjs';
import { canvasSize, safeInsets, VIRAL_SAFE_ZONE } from '/v1/formats.mjs';
import { drawFrame, resetContext } from './draw.mjs';
import { annotate } from './bounds.mjs';
import { applyFont, createMeasure } from './text-style.mjs';
import { facesFor, loadFaces } from './fonts-shared.mjs';
import { createPost, grainPhase } from './post.mjs';
import { createCutPictures } from './cut-pictures.mjs';
import { createAccumulator } from './accumulate.mjs';
import { createClipFrames } from './clip-frames.mjs';
import { resolveShotCut } from '../cuts/resolve.mjs';
import { shaderUniforms, standInOf } from '../cuts/shaders/index.mjs';

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

const KEY_DECIMALS = 1e9; // a cut's progress in a key, rounded so float noise cannot split two equal frames

const keyOfP = (p) => Math.round(p * KEY_DECIMALS) / KEY_DECIMALS;

// The key of a frame's 2D state. Inside a layer or shader window the sampled nodes are the incoming shot's alone, which
// can stand still while the cut moves: the key then carries the cut, its direction, its progress and the outgoing shot.
// Inside a smeared window they are the still nodes alone (none for a punch): the key carries the smeared cut the same way.
function stateKeyOf(state) {
  const base = stateKey({ background: state.background, sampled: state.sampled });
  if (state.smear !== undefined) {
    const { name, direction, p } = state.smear.cut;
    return `${base}|smear:${name}:${direction}:${keyOfP(p)}`;
  }
  if (state.cut === undefined) return base;
  const { name, direction, p } = state.cut;
  return `${base}|cut:${name}:${direction}:${keyOfP(p)}|from:${state.from.shot}`;
}

// The keys that say whether two frames look alike, over `frameState(i)`. drawKey: the sampled state, plus the frame itself
// when a field on screen is painted from the time (the sampled state alone does not say such a field moved). captureKey:
// what frame i looks like once the post pass has run, the 2D key plus the grain pattern when there is grain.
function frameKeys({ frameState, fps, grainNow }) {
  const drawKey = (i) => {
    const state = frameState(i);
    return hasAnimatedField(state.sampled) ? `${stateKeyOf(state)}|frame${i}` : stateKeyOf(state);
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

// The measured ink of each line of a text node, [{ ascent, descent, words: [{ left, right }] }] in the text's own pixels:
// how far its glyphs really reach above and below the baseline (accents, ascenders, descenders), and where each word's
// ink starts and ends from that word's origin. Undefined for a text without a font.
function lineInkOf(ctx) {
  return (n) => {
    const font = n.props.font;
    if (!font) return undefined;
    applyFont(ctx, font, { tracked: true });
    return n.props.layout.lines.map((line) => {
      const m = ctx.measureText(line.words.map((word) => word.text).join(' '));
      const words = line.words.map((word) => {
        const w = ctx.measureText(word.text);
        return { left: -w.actualBoundingBoxLeft, right: w.actualBoundingBoxRight };
      });
      return { ascent: m.actualBoundingBoxAscent, descent: m.actualBoundingBoxDescent, words };
    });
  };
}

// The recipe a frame inside a cut window is composed by in 2D (engine/cuts/layers.mjs): a layer cut's own, or the
// stand-in of a shader cut the post pass cannot run.
function cutRecipe(cut, canvas, look) {
  const entry = registries.cuts.get(cut.name);
  if (entry.family === 'layer') return entry.layers({ p: cut.p, direction: cut.direction, canvas, look });
  if (entry.family === 'shader') {
    const standIn = standInOf(entry, cut.direction);
    return standIn.entry.layers({ p: cut.p, direction: standIn.direction, canvas, look });
  }
  throw new Error(`cut "${cut.name}": the page cannot compose a ${entry.family} cut`);
}

// The shader cuts `film` uses, each once, in the order the film first uses them: the post pass compiles them up front.
function shaderCutsOf(film, look) {
  const cuts = film.shots.map((_, index) => resolveShotCut(film, index, { look }));
  return [...new Set(cuts.filter((cut) => cut?.family === 'shader').map((cut) => cut.name))];
}

// A frame state without the film's captions (engine/captions: every caption node's id starts with <shot id>.captions),
// also inside a layer group, in each smear sample and in the outgoing picture of a cut window. The layout is not touched.
function captionFilter(film) {
  const prefixes = film.shots.map((shot) => `${shot.id}.captions`);
  const isCaption = (n) => prefixes.some((p) => n.id === p || n.id.startsWith(`${p}.`));
  const strip = (nodes) => nodes.filter((n) => !isCaption(n)).map((n) => (n.props.layer === true ? { ...n, children: strip(n.children) } : n));
  const stripSmear = (smear) => ({ ...smear, layers: smear.layers.map(strip), over: strip(smear.over), whole: strip(smear.whole) });
  return (state) => ({
    ...state,
    sampled: strip(state.sampled),
    ...(state.from === undefined ? {} : { from: { ...state.from, sampled: strip(state.from.sampled) } }),
    ...(state.smear === undefined ? {} : { smear: stripSmear(state.smear) }),
  });
}

// The page's API: what the render, the review and the tests call.
function installApi({ fps, draw, post, source, measure, frameState, keys, setGrain, snapshotOf, snapshotShot, cutPictures }) {
  // captions: false leaves the film's captions out of the frame (a poster), the rest drawn as laid out; progress (tests
  // only) draws a frame inside a cut window at that progress of the cut instead of its own
  window.__seek = (i, { captions = true, progress } = {}) => {
    const cut = draw(i, { captions, progress });
    post.render(source, i / fps, cut ?? undefined);
  };
  window.__cutCanvases = cutPictures.made; // how many second pictures the cuts have made, for tests
  window.__snapshotShot = snapshotShot;
  window.__source = source; // the frame before the post pass, for tests
  window.__setPost = (next) => { // new strengths for the next __seek, for tests
    post.setStrengths(next);
    if (next.grain !== undefined) setGrain(next.grain);
  };
  window.__stampFamily = STAMP_FAMILY;
  window.__measure = measure; // the layout measure, for tests
  // a smeared frame is audited at its own progress, without the smear (engine/graph/film.mjs smear.whole)
  window.__snapshot = (i) => {
    const state = frameState(i);
    return snapshotOf(state.smear?.whole ?? state.sampled);
  };
  window.__stateKey = keys.captureKey;
  // withGrain: compared by __stateKey (what is captured), else by the 2D state alone.
  window.__heldFlags = (from, to, withGrain) => heldFlags(withGrain ? keys.captureKey : keys.drawKey)(from, to);
}

async function init() {
  const { film, timeline, assets: srcs, alpha = [], clips = [], prepared = {} } = await fetchJson('/film.json');
  if (timeline.shots.length === 0) throw new Error('the film has no shots');
  const [w, h] = canvasSize(film);
  const canvas = { w, h };
  const element = document.getElementById('stage');
  element.width = w;
  element.height = h;
  const source = new OffscreenCanvas(w, h);
  const ctx = source.getContext('2d');
  const look = resolveLook(film);
  const seed = film.seed ?? DEFAULT_SEED;
  const post = createPost(element, { ...look.post, seed, shaders: shaderCutsOf(film, look) });
  // The designed kinds take their type from the look, so the look's fonts load with any the film names itself.
  await loadFaces(facesFor({ film, fonts: look.fonts, stamp: { family: STAMP_FAMILY } }));
  const assets = await loadAssets(srcs);
  const clipFrames = createClipFrames(clips); // a video clip's frames, loaded before each draw that shows them
  for (const [src, entry] of clipFrames.entries) assets.set(src, entry);
  const { frames } = clipFrames;
  const measure = createMeasure(document.createElement('canvas').getContext('2d'));
  // what a kind's ctx.asset(src) says: the size, a clip's frames, and whether the picture has transparency (the server
  // read it from the file's header: scripts/v2/asset-info.mjs); the page never inspects pixels for it
  const transparent = new Set(alpha);
  const layoutAssets = new Map([...assets].map(([src, a]) => [src, { width: a.width, height: a.height, ...(a.clip ? { clip: a.clip } : {}), ...(transparent.has(src) ? { alpha: true } : {}) }]));
  const built = buildFilm({ film, timeline, measure, assets: layoutAssets, canvas, viralInsets: safeInsets([w, h], VIRAL_SAFE_ZONE), prepared });
  const { fps, frameCount } = timeline;
  let grain = look.post.grain; // what the post pass is using now (a test may change it)

  const frameState = (i) => {
    if (!Number.isInteger(i) || i < 0 || i > frameCount) throw new Error(`frame must be an integer in 0..${frameCount}, got ${i}`);
    return built.frameAt(i / fps);
  };
  // One shot's whole frame onto c: its background, then its nodes, its fields painted at film second t.
  const drawShot = (c, { background, sampled, t }) => {
    resetContext(c); // a seek that threw halfway must not leave its clip, alpha or save stack to the next one
    c.fillStyle = background;
    c.fillRect(0, 0, w, h);
    drawFrame(c, sampled, { assets, canvas, time: t, frames });
  };
  const cutPictures = createCutPictures({ w, h, drawShot });
  const accumulator = createAccumulator({ w, h });
  // A smeared frame (engine/graph/film.mjs): the still nodes, the mean of the moving layers over them, then `over`.
  const drawSmeared = (state, t) => {
    const { layers, gapPx, vector, over } = state.smear;
    drawShot(ctx, { background: state.background, sampled: state.sampled, t });
    const mean = accumulator.mean((layer, k) => drawFrame(layer, layers[k], { assets, canvas, time: t, frames }), layers.length, { vector, gapPx });
    ctx.drawImage(mean, 0, 0);
    drawFrame(ctx, over, { assets, canvas, time: t, frames });
  };
  const withoutCaptions = captionFilter(film);
  // Draws frame i into the source. Returns the shader cut the post pass is to run over it, or null: inside a shader cut's
  // window the source then holds the incoming picture alone.
  const draw = (i, { captions = true, progress } = {}) => {
    const plain = captions ? frameState(i) : withoutCaptions(frameState(i));
    const state = progress === undefined || plain.cut === undefined ? plain : { ...plain, cut: { ...plain.cut, p: progress } };
    // frame frameCount is the instant the film ends: it can be sampled but there is no frame to draw
    if (i === frameCount) throw new Error(`frame must be an integer in 0..${frameCount - 1} to draw, got ${i}`);
    const t = i / fps;
    if (state.smear !== undefined) {
      drawSmeared(state, t);
      return null;
    }
    if (state.cut === undefined) {
      drawShot(ctx, { ...state, t });
      return null;
    }
    resetContext(ctx);
    if (state.cut.family === 'shader' && post.cuts.ran.includes(state.cut.name)) {
      drawShot(ctx, { ...state, t });
      const { shader } = registries.cuts.get(state.cut.name);
      return { from: cutPictures.outgoing(state), shader: state.cut.name, params: shaderUniforms(shader, { p: state.cut.p, direction: state.cut.direction, canvas, ground: state.background }) };
    }
    cutPictures.compose(ctx, state, cutRecipe(state.cut, canvas, look), t);
    return null;
  };
  const keys = frameKeys({ frameState, fps, grainNow: () => grain });
  const snapshotOf = (sampled) => annotate(sampled, { lineInk: lineInkOf(document.createElement('canvas').getContext('2d')) });
  // Shot `index` alone at frame i: only its own nodes, as they stand inside a cut window where both shots are drawn.
  const snapshotShot = (index, i) => {
    frameState(i);
    return snapshotOf(built.sampleShot(index, Math.max(0, shotTime(i / fps, timeline.shots[index].start))));
  };
  installApi({ fps, draw, post, source, measure, frameState, keys, snapshotOf, snapshotShot, cutPictures, setGrain: (value) => { grain = value; } });
  if (clips.length > 0) {
    // a film with clips: __seek loads the clip frames frame i shows, then draws (it returns a promise; page.evaluate
    // and every caller await it). A film without clips keeps the synchronous __seek.
    const drawNow = window.__seek;
    window.__seek = async (i, options) => {
      await clipFrames.prepare(frameState(i));
      drawNow(i, options);
    };
  }
  const notice = post.unavailable ? { postNotice: { ...post.unavailable, dropped: post.dropped } } : {};
  // the size each picture loaded at, by src: what a kind's review needs to know of a picture (scripts/v2/review.mjs)
  const pictures = Object.fromEntries([...assets].map(([src, bitmap]) => [src, [bitmap.width, bitmap.height]]));
  return { frameCount, fps, size: [w, h], post: post.kind, cuts: post.cuts, backgrounds: [...built.backgrounds], pictures, ...notice };
}

window.__ready = init();

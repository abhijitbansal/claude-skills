// The render page's stage. It loads the film from /film.json, loads the fonts the film and its look need, builds the
// film (every shot expanded once through its kind, cuts and cameras applied: engine/graph/film.mjs), then answers
// seeks: __seek(i) draws frame i, __snapshot(i) reports its laid-out nodes, __stateKey(i) a stable key of its state.
// window.__ready resolves once the page can be seeked. The WebGL post pass is a later task: this stage draws straight
// onto the visible canvas and reports post: '2d'.
import { buildFilm, resolveLook } from '../graph/film.mjs';
import { stateKey } from '../graph/sample.mjs';
import { canvasSize } from '/v1/formats.mjs';
import { drawFrame, resetContext } from './draw.mjs';
import { annotate } from './bounds.mjs';
import { createMeasure } from './text-style.mjs';
import { facesFor, loadFaces } from './fonts-shared.mjs';

const POST_PASS = '2d';

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

async function init() {
  const { film, timeline, assets: srcs } = await fetchJson('/film.json');
  if (timeline.shots.length === 0) throw new Error('the film has no shots');
  const [w, h] = canvasSize(film);
  const canvas = { w, h };
  const element = document.getElementById('stage');
  element.width = w;
  element.height = h;
  const ctx = element.getContext('2d');
  // The designed kinds take their type from the look, so the look's fonts load with any the film names itself.
  await loadFaces(facesFor({ film, fonts: resolveLook(film).fonts }));
  const assets = await loadAssets(srcs);
  const measure = createMeasure(document.createElement('canvas').getContext('2d'));
  const built = buildFilm({ film, timeline, measure, assets, canvas });
  const { fps, frameCount } = timeline;

  const frameState = (i) => {
    if (!Number.isInteger(i) || i < 0 || i > frameCount) throw new Error(`frame must be an integer in 0..${frameCount}, got ${i}`);
    return built.frameAt(i / fps);
  };

  window.__seek = (i) => {
    const { background, sampled } = frameState(i);
    resetContext(ctx); // a seek that threw halfway must not leave its clip, alpha or save stack to the next one
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
    drawFrame(ctx, sampled, { assets, canvas, time: i / fps });
  };
  window.__measure = measure; // the layout measure, for tests
  window.__snapshot = (i) => annotate(frameState(i).sampled);
  window.__stateKey = (i) => stateKey(frameState(i));
  return { frameCount, fps, size: [w, h], post: POST_PASS };
}

window.__ready = init();

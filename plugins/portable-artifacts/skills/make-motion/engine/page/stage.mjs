// The render page's stage. It loads the film from /film.json, loads the fonts the film needs, expands each shot
// through its kind, then answers seeks: __seek(i) draws frame i, __snapshot(i) reports its laid-out nodes,
// __stateKey(i) a stable key of its state. window.__ready resolves once the page can be seeked.
// Cuts, looks, fields, devices and the WebGL post pass are later tasks: this stage draws one shot at a time
// straight onto the visible canvas and reports post: '2d'.
import { registries } from '../registry.mjs';
import '../kinds/free.mjs';
import { sampleGraph, stateKey } from '../graph/sample.mjs';
import { camera as makeCamera, applyCamera } from '../graph/camera.mjs';
import { canvasSize } from '/v1/formats.mjs';
import { drawFrame } from './draw.mjs';
import { annotate } from './bounds.mjs';
import { createMeasure } from './text-style.mjs';
import { facesFor, loadFaces } from './fonts-shared.mjs';
import { hashString } from './rough.mjs';

const POST_PASS = '2d';
const UNIT_DIVISOR = 100; // ctx.unit: one percent of the canvas height, the design unit kinds size things in

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

async function loadAssets(count) {
  return Promise.all(Array.from({ length: count }, async (_, n) => {
    const res = await fetch(`/asset/${n}`);
    if (!res.ok) throw new Error(`/asset/${n}: ${res.status}`);
    return createImageBitmap(await res.blob());
  }));
}

// One shot, expanded once: its nodes, its camera function and the frames it owns.
function expandShot(film, timeline, index, env) {
  const shot = film.shots[index];
  const timing = timeline.shots[index];
  const kind = registries.kinds.get(shot.show);
  const ctx = {
    canvas: env.canvas,
    unit: env.canvas.h / UNIT_DIVISOR,
    timing,
    measure: env.measure,
    seed: (hashString(shot.id) ^ (film.seed ?? 0)) >>> 0,
    asset: (n) => {
      if (!env.assets[n]) throw new Error(`shot "${shot.id}": no asset ${n} (the film names ${env.assets.length})`);
      return env.assets[n];
    },
  };
  const out = kind.expand(shot, ctx);
  if (!out || !Array.isArray(out.nodes)) throw new Error(`kind "${shot.show}" must return { nodes: [...] } for shot "${shot.id}"`);
  return {
    startFrame: Math.round(timing.start * timeline.fps),
    nodes: out.nodes,
    cam: makeCamera({ tracks: out.camera ?? {}, canvas: env.canvas }),
    background: out.background ?? '#000000',
  };
}

async function init() {
  const { film, timeline, assetCount } = await fetchJson('/film.json');
  if (timeline.shots.length === 0) throw new Error('the film has no shots');
  const [w, h] = canvasSize(film);
  const canvas = { w, h };
  const element = document.getElementById('stage');
  element.width = w;
  element.height = h;
  const ctx = element.getContext('2d');
  await loadFaces(facesFor(film));
  const env = { canvas, measure: createMeasure(document.createElement('canvas').getContext('2d')), assets: await loadAssets(assetCount) };
  const shots = timeline.shots.map((_, i) => expandShot(film, timeline, i, env));
  const { fps, frameCount } = timeline;

  // The last shot also owns t === duration (frame frameCount).
  const shotAt = (i) => shots.findLast((s) => s.startFrame <= i);
  const frameState = (i) => {
    if (!Number.isInteger(i) || i < 0 || i > frameCount) throw new Error(`frame must be an integer in 0..${frameCount}, got ${i}`);
    const shot = shotAt(i);
    const t = (i - shot.startFrame) / fps;
    return { background: shot.background, sampled: applyCamera(sampleGraph(shot.nodes, t), shot.cam(t), canvas) };
  };

  window.__seek = (i) => {
    const { background, sampled } = frameState(i);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
    drawFrame(ctx, sampled, { assets: env.assets, canvas, fields: [] });
  };
  window.__measure = env.measure; // the layout measure, for tests
  window.__snapshot =(i) => annotate(frameState(i).sampled);
  window.__stateKey = (i) => stateKey(frameState(i));
  return { frameCount, fps, size: [w, h], post: POST_PASS };
}

window.__ready = init();

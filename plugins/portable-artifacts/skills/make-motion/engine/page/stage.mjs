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
import { unitOf } from '../units.mjs';
import { srcsOfShot } from '../assets.mjs';
import { drawFrame, resetContext } from './draw.mjs';
import { annotate } from './bounds.mjs';
import { createMeasure } from './text-style.mjs';
import { facesFor, loadFaces } from './fonts-shared.mjs';
import { hashString } from './rough.mjs';

const POST_PASS = '2d';
const TIME_DECIMALS = 1e9; // shot-local time is rounded to 1e-9 s, so float noise cannot change a sample

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

// Every src the film names, in the order the server numbered them (/asset/<n>).
const filmSrcs = (film) => film.shots.flatMap((shot) => srcsOfShot(shot, registries.kinds.get(shot.show).srcFields));

// src string -> loaded picture. The same string is the same file (a path in the film's folder), so a repeat keeps
// the first.
function imagesBySrc(film, bitmaps) {
  const srcs = filmSrcs(film);
  if (srcs.length !== bitmaps.length) throw new Error(`the film names ${srcs.length} srcs but the server offered ${bitmaps.length}`);
  const images = new Map();
  srcs.forEach((src, n) => { if (!images.has(src)) images.set(src, bitmaps[n]); });
  return images;
}

// ctx.asset(src) for a shot: the size of one of the srcs the shot declares; any other string is an error.
function shotAsset(shot, kind, images) {
  const declared = new Set(srcsOfShot(shot, kind.srcFields));
  return (src) => {
    if (!declared.has(src)) throw new Error(`shot "${shot.id}": "${src}" is not one of its srcs (it declares ${declared.size === 0 ? 'none' : [...declared].map((s) => `"${s}"`).join(', ')})`);
    const image = images.get(src);
    return { width: image.width, height: image.height };
  };
}

// One shot, expanded once: its nodes, its camera function and when it starts.
function expandShot(film, timeline, index, env) {
  const shot = film.shots[index];
  const timing = timeline.shots[index];
  const kind = registries.kinds.get(shot.show);
  const asset = shotAsset(shot, kind, env.assets);
  const ctx = {
    canvas: env.canvas,
    unit: unitOf(env.canvas),
    timing,
    measure: env.measure,
    seed: (hashString(shot.id) ^ (film.seed ?? 0)) >>> 0,
    asset,
  };
  const out = kind.expand(shot, ctx);
  if (!out || !Array.isArray(out.nodes)) throw new Error(`kind "${shot.show}" must return { nodes: [...] } for shot "${shot.id}"`);
  return {
    start: timing.start,
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
  const assets = imagesBySrc(film, await loadAssets(assetCount));
  const env = { canvas, measure: createMeasure(document.createElement('canvas').getContext('2d')), assets };
  const shots = timeline.shots.map((_, i) => expandShot(film, timeline, i, env));
  const { fps, frameCount } = timeline;

  // The shot whose [start, end) holds time; the last shot also owns t === duration (frame frameCount).
  const shotAt = (time) => shots.findLast((s) => s.start <= time + 1 / TIME_DECIMALS);
  const frameState = (i) => {
    if (!Number.isInteger(i) || i < 0 || i > frameCount) throw new Error(`frame must be an integer in 0..${frameCount}, got ${i}`);
    const time = i / fps;
    const shot = shotAt(time);
    const t = Math.round((time - shot.start) * TIME_DECIMALS) / TIME_DECIMALS + 0; // + 0 turns -0 into 0
    return { background: shot.background, sampled: applyCamera(sampleGraph(shot.nodes, t), shot.cam(t), canvas) };
  };

  window.__seek = (i) => {
    const { background, sampled } = frameState(i);
    resetContext(ctx); // a seek that threw halfway must not leave its clip, alpha or save stack to the next one
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
    drawFrame(ctx, sampled, { assets: env.assets, canvas, fields: [] });
  };
  window.__measure = env.measure; // the layout measure, for tests
  window.__snapshot = (i) => annotate(frameState(i).sampled);
  window.__stateKey = (i) => stateKey(frameState(i));
  return { frameCount, fps, size: [w, h], post: POST_PASS };
}

window.__ready = init();

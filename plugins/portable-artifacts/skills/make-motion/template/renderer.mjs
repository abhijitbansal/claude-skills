// Browser renderer: builds the stage DOM from the spec and exposes
// window.__motion for the preview UI and the Playwright frame loop.
import { buildTimeline, seekTo } from './timeline.mjs';
import { withDefaults } from './defaults.mjs';
import { resolveAudio } from './audio.mjs';
import { expressionInterpreter } from 'vega-interpreter';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MODE = document.querySelector('meta[name="motion-mode"]')?.content ?? 'preview';
const SCENE_END_EPSILON = 1e-9;

// Dark defaults for Vega-Lite charts; a spec's own `config` overrides these.
const INK = '#8b93a7';
const GRID = '#1f2635';
const VEGA_CONFIG = {
  background: null,
  view: { stroke: null },
  font: 'Inter',
  range: { category: ['#5eead4', '#7aa2ff', '#f6b26b', '#e879a8', '#a78bfa', '#9be564'] },
  mark: { color: '#5eead4' },
  line: { color: '#5eead4' },
  bar: { color: '#5eead4', cornerRadiusEnd: 6 },
  point: { filled: true, size: 120, color: '#5eead4' },
  axis: {
    domainColor: '#3a4256', tickColor: '#3a4256', gridColor: GRID, labelColor: INK, titleColor: '#c9cfdd',
    labelFont: 'Inter', titleFont: 'Inter', labelFontSize: 24, titleFontSize: 26, titleFontWeight: 500,
    labelPadding: 10, titlePadding: 18, tickSize: 8,
  },
  axisX: { labelAngle: 0, labelPadding: 14 },
  legend: { labelColor: INK, titleColor: '#c9cfdd', labelFont: 'Inter', labelFontSize: 22, titleFontSize: 22 },
  title: { color: '#f4f6fb', font: 'Inter', fontSize: 32 },
};

const px = (n) => `${n}px`;
const svgEl = (name, attrs = {}) => {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
};
const assetUrl = (src) => `/assets/${src.split('/').map(encodeURIComponent).join('/')}`;

function textStyle(node, el) {
  node.style.fontSize = px(el.fontSize ?? 48);
  node.style.fontWeight = String(el.fontWeight ?? 600);
  node.style.color = el.color ?? '#ffffff';
  node.style.textAlign = el.align ?? 'center';
  if (el.maxWidth) node.style.maxWidth = px(el.maxWidth);
  if (el.font === 'mono') node.classList.add('mono');
}

function makeShape(el) {
  const sw = el.strokeWidth ?? (el.shape === 'line' ? 4 : 0);
  const w = el.width ?? 100;
  const h = el.shape === 'line' ? sw : (el.height ?? 100);
  const svg = svgEl('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}` });
  const common = { pathLength: 1, 'stroke-dasharray': 1, 'stroke-dashoffset': 0 };
  let node;
  if (el.shape === 'line') {
    node = svgEl('line', { x1: 0, y1: h / 2, x2: w, y2: h / 2, stroke: el.stroke ?? el.fill ?? '#ffffff', 'stroke-width': sw, ...common });
  } else {
    const fill = el.fill ?? (el.stroke ? 'none' : '#ffffff');
    const inset = sw / 2;
    const attrs = { fill, stroke: el.stroke ?? 'none', 'stroke-width': sw, ...common };
    node = el.shape === 'ellipse'
      ? svgEl('ellipse', { cx: w / 2, cy: h / 2, rx: Math.max(0, w / 2 - inset), ry: Math.max(0, h / 2 - inset), ...attrs })
      : svgEl('rect', { x: inset, y: inset, width: Math.max(0, w - sw), height: Math.max(0, h - sw), rx: el.radius ?? 0, ...attrs });
  }
  svg.append(node);
  return { root: svg, drawNode: node, width: w, height: h };
}

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Spec config wins; objects are merged one level deep so `axis: {labelColor}` keeps the other axis defaults.
function mergeConfig(base, extra = {}) {
  const out = { ...base };
  for (const [key, value] of Object.entries(extra)) out[key] = isPlain(value) && isPlain(base[key]) ? { ...base[key], ...value } : value;
  return out;
}

async function renderChart(el) {
  const vl = el.vegaLite;
  const config = mergeConfig(VEGA_CONFIG, vl.config);
  const compiled = window.vegaLite.compile({
    ...vl, width: el.width, height: el.height, config, autosize: { type: 'fit', contains: 'padding' },
  }).spec;
  // The interpreter avoids eval, so the page's CSP needs no 'unsafe-eval'.
  const view = new window.vega.View(window.vega.parse(compiled, null, { ast: true }), { expr: expressionInterpreter, renderer: 'none' });
  const svgText = await view.toSVG();
  view.finalize();
  const holder = document.createElement('div');
  holder.innerHTML = svgText;
  return holder.firstElementChild;
}

function buildElement(el) {
  const node = document.createElement('div');
  node.className = `el ${el.type}`;
  node.dataset.id = el.id;
  const part = { node, el };
  switch (el.type) {
    case 'text':
      textStyle(node, el);
      node.textContent = el.text;
      break;
    case 'counter':
      textStyle(node, el);
      part.format = (v) => `${el.prefix ?? ''}${v.toFixed(el.decimals ?? 0)}${el.suffix ?? ''}`;
      break;
    case 'shape': {
      const s = makeShape(el);
      Object.assign(part, { drawNode: s.drawNode });
      node.style.width = px(s.width);
      node.style.height = px(s.height);
      node.append(s.root);
      break;
    }
    case 'image': {
      const img = document.createElement('img');
      img.src = assetUrl(el.src);
      img.style.width = px(el.width);
      img.style.height = px(el.height);
      img.style.objectFit = el.fit ?? 'contain';
      node.append(img);
      part.img = img;
      break;
    }
    case 'chart':
      node.style.width = px(el.width);
      node.style.height = px(el.height);
      break;
    default:
      throw new Error(`unknown element type "${el.type}" (element "${el.id}")`);
  }
  return part;
}

async function buildStage(spec) {
  const stage = document.createElement('div');
  stage.id = 'stage';
  stage.style.width = px(spec.size[0]);
  stage.style.height = px(spec.size[1]);
  stage.style.background = spec.background;
  const scenes = [];
  const parts = [];
  const pending = [];
  for (const scene of spec.scenes) {
    const layer = document.createElement('div');
    layer.className = 'scene';
    if (scene.background) layer.style.background = scene.background;
    for (const el of scene.elements) {
      const part = buildElement(el);
      parts.push(part);
      layer.append(part.node);
      if (el.type === 'chart') {
        pending.push(renderChart(el).then((svg) => part.node.append(svg)));
      }
      if (part.img) pending.push(part.img.decode().catch(() => { throw new Error(`image failed to load: ${el.src}`); }));
    }
    stage.append(layer);
    scenes.push({ scene, layer });
  }
  await Promise.all(pending);
  return { stage, scenes, parts };
}

function collectStrings(node, out = []) {
  if (typeof node === 'string') out.push(node);
  else if (node && typeof node === 'object') Object.values(node).forEach((v) => collectStrings(v, out));
  return out;
}

// [css font shorthand, sample text] per use, so only the subsets the spec needs are fetched.
function fontNeeds(spec) {
  const needs = [];
  const digits = '0123456789.,-+%$';
  for (const el of spec.scenes.flatMap((s) => s.elements)) {
    const family = el.font === 'mono' ? "'JetBrains Mono'" : 'Inter';
    const face = `${el.fontWeight ?? 600} ${el.fontSize ?? 48}px ${family}`;
    if (el.type === 'text') needs.push([face, el.text]);
    if (el.type === 'counter') needs.push([face, `${el.prefix ?? ''}${el.suffix ?? ''}${digits}`]);
    if (el.type === 'chart') {
      const sample = collectStrings(el.vegaLite).join(' ') + digits;
      for (const weight of [400, 500, 600, 700]) needs.push([`${weight} 24px Inter`, sample]);
    }
  }
  return needs;
}

async function loadFonts(spec) {
  await Promise.all(fontNeeds(spec).map(([font, text]) => document.fonts.load(font, text)));
  await document.fonts.ready;
}

function activeScene(starts, sec) {
  let idx = 0;
  for (let i = 0; i < starts.length; i++) if (sec >= starts[i] - SCENE_END_EPSILON) idx = i;
  return idx;
}

function makeApply({ scenes, parts }, built) {
  const { states, sceneStarts } = built;
  return (sec) => {
    const active = activeScene(sceneStarts, sec);
    scenes.forEach(({ scene, layer }, i) => {
      layer.style.display = i === active ? 'block' : 'none';
      layer.style.opacity = String(states.get(`scene:${scene.id}`).opacity);
    });
    for (const { node, el, drawNode, format } of parts) {
      const s = states.get(el.id);
      node.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -50%) scale(${s.scale}) rotate(${s.rotate}deg)`;
      node.style.opacity = String(s.opacity);
      if (drawNode) drawNode.setAttribute('stroke-dashoffset', String(1 - s.draw));
      if (el.type === 'chart') node.style.clipPath = `inset(0 ${(1 - s.reveal) * 100}% 0 0)`;
      if (format) node.textContent = format(s.value);
    }
  };
}

const viewportEl = document.getElementById('viewport');
const errorEl = document.getElementById('error');
let currentStage = null;

function fitStage(size) {
  const k = Math.min(viewportEl.clientWidth / size[0], viewportEl.clientHeight / size[1]);
  const left = (viewportEl.clientWidth - size[0] * k) / 2;
  const top = (viewportEl.clientHeight - size[1] * k) / 2;
  currentStage.style.transform = `translate(${left}px, ${top}px) scale(${k})`;
}

async function fetchSpec() {
  const response = await fetch('/spec.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`failed to load spec: HTTP ${response.status}`);
  return withDefaults(await response.json());
}

let currentAudio = null;

// Preview only: one idle <audio> per track in a hidden holder outside the scaled stage.
// Returns [{ el, start, end, volume, fadeIn, fadeOut }] for preview-ui to drive; nothing plays here.
function replaceAudio(spec) {
  currentAudio?.querySelectorAll('audio').forEach((el) => el.pause()); // a detached element keeps playing
  currentAudio?.remove();
  currentAudio = null;
  if (MODE !== 'preview') return [];
  const holder = document.createElement('div');
  holder.id = 'audio';
  holder.hidden = true;
  const tracks = resolveAudio(spec).map(({ src, ...timing }) => {
    const el = document.createElement('audio');
    el.preload = 'auto';
    el.src = assetUrl(src);
    holder.append(el);
    return { el, ...timing };
  });
  document.body.append(holder);
  currentAudio = holder;
  return tracks;
}

function makeMotion(spec, built, apply, audio) {
  return {
    duration: built.duration, fps: spec.fps, size: spec.size, sceneStarts: built.sceneStarts,
    sceneIds: spec.scenes.map((s) => s.id), audio,
    seek(sec) {
      const t = Math.min(Math.max(0, sec), built.duration);
      seekTo(built.timeline, t);
      apply(t);
    },
  };
}

let generation = 0;

// Builds a new stage and swaps it in. Returns null when a newer mount started meanwhile.
async function mount() {
  const mine = ++generation;
  const spec = await fetchSpec();
  await loadFonts(spec);
  const dom = await buildStage(spec);
  if (mine !== generation) return null;
  const built = buildTimeline(spec);
  const apply = makeApply(dom, built);
  currentStage?.remove();
  viewportEl.append(dom.stage);
  currentStage = dom.stage;
  if (MODE === 'render') document.documentElement.style.background = spec.background; // letterbox
  fitStage(spec.size);
  const motion = makeMotion(spec, built, apply, replaceAudio(spec));
  motion.seek(0);
  return motion;
}

function showError(e) {
  errorEl.textContent = String(e?.message ?? e);
  errorEl.style.display = 'block';
}

let resolveReady;
let rejectReady;
const ready = new Promise((res, rej) => { resolveReady = res; rejectReady = rej; });
ready.catch(() => {}); // callers see the rejection; no extra uncaught page error
window.__motion = { ready };

async function reload() {
  try {
    const next = await mount();
    if (!next) return;
    errorEl.style.display = 'none';
    window.__motion = Object.assign(next, { ready });
  } catch (e) { showError(e); }
}

async function start() {
  document.body.classList.add(MODE);
  const motion = await mount();
  window.__motion = Object.assign(motion, { ready });
  window.__reload = reload;
  window.__showError = showError;
  window.addEventListener('resize', () => fitStage(window.__motion.size));
  if (MODE === 'preview') (await import('./preview-ui.mjs')).initPreviewUI();
  resolveReady(true);
}

start().catch((e) => { showError(e); rejectReady(e); });

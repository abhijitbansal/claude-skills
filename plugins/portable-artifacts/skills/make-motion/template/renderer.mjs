// Browser renderer: builds the stage DOM from the spec and exposes
// window.__motion for the preview UI and the Playwright frame loop.
import { buildTimeline, seekTo } from './timeline.mjs';
import { withDefaults } from './defaults.mjs';
import { resolveAudio } from './audio.mjs';
import { expressionInterpreter } from 'vega-interpreter';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MODE = document.querySelector('meta[name="motion-mode"]')?.content ?? 'preview';
const SCENE_END_EPSILON = 1e-9;

// Vega-Lite sizes shared by every theme; themedLook adds the theme's fonts and colours. A spec's own
// `config` overrides both.
const VEGA_CONFIG = {
  background: null,
  view: { stroke: null },
  bar: { cornerRadiusEnd: 6 },
  point: { filled: true, size: 120 },
  axis: { labelFontSize: 24, titleFontSize: 26, titleFontWeight: 500, labelPadding: 10, titlePadding: 18, tickSize: 8 },
  axisX: { labelAngle: 0, labelPadding: 14 },
  legend: { labelFontSize: 22, titleFontSize: 22 },
  title: { fontSize: 32 },
};

const quote = (family) => `"${family}"`;

// The shipped weight closest to the one asked for (the lighter one on a tie): a theme font ships a few
// weights, and any other would be drawn as a synthetic bold.
function nearestWeight(asked, shipped) {
  let best = shipped[0];
  for (const w of shipped) if (Math.abs(w - asked) < Math.abs(best - asked)) best = w;
  return best;
}

// Which font role a text or counter draws with: `role: "title"` text uses the display font (even with
// `font: "mono"`), `font: "mono"` the mono font, everything else the body font.
const fontKind = (el) => (el.role === 'title' ? 'display' : el.font === 'mono' ? 'mono' : 'sans');
const shippedWeights = (font) => Object.keys(font.weights).map(Number).sort((a, b) => a - b);

// The spec's theme (dusk when it names none) as what the page draws with: its fonts and dark colours.
function themedLook(theme) {
  const c = theme.dark;
  const sans = quote(theme.fonts.body.family);
  const ink = c.text3;
  const axisTitle = c.text2;
  const shipped = { display: shippedWeights(theme.fonts.display), sans: shippedWeights(theme.fonts.body), mono: shippedWeights(theme.fonts.mono) };
  const weight = (kind, asked) => nearestWeight(asked, shipped[kind]);
  return {
    weight,
    text: c.text, shape: c.accent, background: c.page,
    fonts: { display: quote(theme.fonts.display.family), sans, mono: quote(theme.fonts.mono.family) },
    chartFace: sans,
    vega: {
      ...VEGA_CONFIG,
      font: sans,
      range: { category: [c.cat1, c.cat2, c.cat3, c.cat4, c.cat5, c.cat6] },
      mark: { color: c.accent },
      line: { color: c.accent },
      bar: { ...VEGA_CONFIG.bar, color: c.accent },
      point: { ...VEGA_CONFIG.point, color: c.accent },
      axis: { ...VEGA_CONFIG.axis, domainColor: c.line, tickColor: c.line, gridColor: c.grid, labelColor: ink, titleColor: axisTitle, labelFont: sans, titleFont: sans, labelFontWeight: weight('sans', 400), titleFontWeight: weight('sans', VEGA_CONFIG.axis.titleFontWeight) },
      legend: { ...VEGA_CONFIG.legend, labelColor: ink, titleColor: axisTitle, labelFont: sans, labelFontWeight: weight('sans', 400), titleFontWeight: weight('sans', 700) },
      title: { ...VEGA_CONFIG.title, color: c.text, font: sans, fontWeight: weight('sans', 700) },
    },
  };
}

const px = (n) => `${n}px`;
const svgEl = (name, attrs = {}) => {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
};
const assetUrl = (src) => `/assets/${src.split('/').map(encodeURIComponent).join('/')}`;

function textStyle(node, el, look) {
  node.style.fontSize = px(el.fontSize ?? 48);
  node.style.fontWeight = String(look.weight(fontKind(el), el.fontWeight ?? 600));
  node.style.color = el.color ?? look.text;
  node.style.textAlign = el.align ?? 'center';
  if (el.maxWidth) node.style.maxWidth = px(el.maxWidth);
  if (el.role === 'title') node.classList.add('title');
  else if (el.font === 'mono') node.classList.add('mono');
}

function makeShape(el, look) {
  const sw = el.strokeWidth ?? (el.shape === 'line' ? 4 : 0);
  const w = el.width ?? 100;
  const h = el.shape === 'line' ? sw : (el.height ?? 100);
  const svg = svgEl('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}` });
  const common = { pathLength: 1, 'stroke-dasharray': 1, 'stroke-dashoffset': 0 };
  let node;
  if (el.shape === 'line') {
    node = svgEl('line', { x1: 0, y1: h / 2, x2: w, y2: h / 2, stroke: el.stroke ?? el.fill ?? look.shape, 'stroke-width': sw, ...common });
  } else {
    const fill = el.fill ?? (el.stroke ? 'none' : look.shape);
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

async function renderChart(el, look) {
  const vl = el.vegaLite;
  const config = mergeConfig(look.vega, vl.config);
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

function buildElement(el, look) {
  const node = document.createElement('div');
  node.className = `el ${el.type}`;
  node.dataset.id = el.id;
  const part = { node, el };
  switch (el.type) {
    case 'text':
      textStyle(node, el, look);
      node.textContent = el.text;
      break;
    case 'counter':
      textStyle(node, el, look);
      part.format = (v) => `${el.prefix ?? ''}${v.toFixed(el.decimals ?? 0)}${el.suffix ?? ''}`;
      break;
    case 'shape': {
      const s = makeShape(el, look);
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

// A scene with `background: "art"`: the theme's seeded art (drawn by the server, see /art/ in
// server.mjs) under a scrim in the theme's page colour, so text on top stays legible.
function artLayer(scene) {
  const holder = document.createElement('div');
  holder.className = 'art';
  const img = document.createElement('img');
  img.alt = '';
  img.src = `/art/${encodeURIComponent(scene.id)}.svg`;
  const scrim = document.createElement('div');
  scrim.className = 'art-scrim';
  holder.append(img, scrim);
  return { holder, loaded: img.decode().catch(() => { throw new Error(`art failed to load for scene "${scene.id}"`); }) };
}

async function buildStage(spec, look) {
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
    if (scene.background === 'art') {
      const art = artLayer(scene);
      layer.append(art.holder);
      pending.push(art.loaded);
    } else if (scene.background) layer.style.background = scene.background;
    for (const el of scene.elements) {
      const part = buildElement(el, look);
      parts.push(part);
      layer.append(part.node);
      if (el.type === 'chart') {
        pending.push(renderChart(el, look).then((svg) => part.node.append(svg)));
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
function fontNeeds(spec, look) {
  const needs = [];
  const digits = '0123456789.,-+%$';
  for (const el of spec.scenes.flatMap((s) => s.elements)) {
    const kind = fontKind(el);
    const face = `${look.weight(kind, el.fontWeight ?? 600)} ${el.fontSize ?? 48}px ${look.fonts[kind]}`;
    if (el.type === 'text') needs.push([face, el.text]);
    if (el.type === 'counter') needs.push([face, `${el.prefix ?? ''}${el.suffix ?? ''}${digits}`]);
    if (el.type === 'chart') {
      const sample = collectStrings(el.vegaLite).join(' ') + digits;
      for (const weight of new Set([400, 500, 600, 700].map((w) => look.weight('sans', w)))) needs.push([`${weight} 24px ${look.chartFace}`, sample]);
    }
  }
  return needs;
}

async function loadFonts(spec, look) {
  await Promise.all(fontNeeds(spec, look).map(([font, text]) => document.fonts.load(font, text)));
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

// The stylesheet that offers the theme's fonts and colour tokens. One <link> (the server writes the
// first one into the page), swapped when the theme changes.
function useThemeStylesheet(name) {
  const href = `/theme/${encodeURIComponent(name)}.css`;
  let link = document.getElementById('theme-css');
  const failed = () => new Error(`failed to load the stylesheet of theme "${name}"`);
  if (link?.getAttribute('href') === href) {
    if (link.sheet) return Promise.resolve();
    return new Promise((resolve, reject) => {
      link.addEventListener('load', resolve, { once: true });
      link.addEventListener('error', () => reject(failed()), { once: true });
    });
  }
  if (!link) {
    link = document.createElement('link');
    link.id = 'theme-css';
    link.rel = 'stylesheet';
    document.head.append(link);
  }
  return new Promise((resolve, reject) => {
    link.onload = resolve;
    link.onerror = () => reject(failed());
    link.href = href;
  });
}

// The look of theme `name` (withDefaults has already turned a missing theme into dusk).
async function lookFor(name) {
  const response = await fetch(`/theme/${encodeURIComponent(name)}.json`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`failed to load theme "${name}": HTTP ${response.status}`);
  const theme = await response.json();
  await useThemeStylesheet(name);
  return themedLook(theme);
}

async function fetchSpec() {
  const response = await fetch('/spec.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`failed to load spec: HTTP ${response.status}`);
  const raw = await response.json();
  const spec = withDefaults(raw);
  const look = await lookFor(spec.theme);
  if (raw.background === undefined) spec.background = look.background;
  return { spec, look };
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
    el.src = `${assetUrl(src)}?v=${Date.now()}`; // a re-synthesised clip at the same path must not come from the media cache
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
  const { spec, look } = await fetchSpec();
  await loadFonts(spec, look);
  const dom = await buildStage(spec, look);
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

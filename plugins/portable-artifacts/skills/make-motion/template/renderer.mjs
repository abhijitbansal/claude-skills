// Browser renderer: builds the stage DOM from the spec and exposes
// window.__motion for the preview UI and the Playwright frame loop.
import { buildTimeline, seekTo } from './timeline.mjs';
import { withDefaults, resolveColor, graphemes, typingLength, ARROW_HEAD_LENGTH, DEFAULT_SHAPE_SIZE, DEFAULT_LINE_STROKE } from './defaults.mjs';
import { resolveAudio } from './audio.mjs';
import { expressionInterpreter } from 'vega-interpreter';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MODE = document.querySelector('meta[name="motion-mode"]')?.content ?? 'preview';
const SCENE_END_EPSILON = 1e-9;
const ELEVATED_HIGHLIGHT = 'rgba(255,255,255,.06)'; // the 1 px inset edge of an `elevated` rect
const ELEVATED_LIFT = 6; // percent of the text colour an elevated fill moves toward
const ARROW_HALF_WIDTH = 1.5; // an arrow head reaches this many stroke widths either side of the line (it is ARROW_HEAD_LENGTH long)
const ARROW_DRAW_SHOWN = 0.98; // the head appears once the line is drawn this far
const VIGNETTE = 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.55) 100%)'; // clear in the middle, 0.55 black at the corners
const GRAIN_GAIN = 4; // `texture.grain` times this is the noise's alpha (0.15 gives 0.6)
const GRAIN_FREQUENCY = 0.8; // feTurbulence base frequency of the film grain, in 1/px
const GRAIN_OCTAVES = 2;
const GRAIN_SEED_RANGE = 65536;
const CARET_BLINK_SECONDS = 0.5; // once a typing text is complete its caret blinks at this half-period
const TYPING_EPSILON = 1e-6; // a count of 4 reached exactly at t = 4 x 0.035 s must not read as 3.9999999
const REVEAL_EDGE = 8; // percent of a chart's width the reveal wipe fades over

// Vega-Lite sizes shared by every theme; themedLook adds the theme's fonts and colours. A spec's own
// `config` overrides both.
const VEGA_CONFIG = {
  background: null,
  view: { stroke: null },
  bar: { cornerRadiusEnd: 10 },
  line: { strokeWidth: 4, strokeCap: 'round', strokeJoin: 'round' },
  point: { filled: true, size: 120, strokeWidth: 3 },
  scale: { bandPaddingInner: 0.3 },
  axis: { labelFontSize: 24, titleFontSize: 26, titleFontWeight: 500, labelPadding: 10, titlePadding: 18, tickSize: 8 },
  axisX: { labelAngle: 0, labelPadding: 14, ticks: false, grid: false, tickCount: 5 },
  axisY: { tickCount: 5, domain: false, ticks: false },
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

// Which font role a text or counter draws with: `font: "mono"` the mono font (even on `role: "title"`),
// other `role: "title"` text the display font, everything else the body font.
const fontKind = (el) => (el.font === 'mono' ? 'mono' : el.role === 'title' ? 'display' : 'sans');
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
    weight, colors: c,
    text: c.text, shape: c.accent, background: c.page,
    fonts: { display: quote(theme.fonts.display.family), sans, mono: quote(theme.fonts.mono.family) },
    chartFace: sans,
    vega: {
      ...VEGA_CONFIG,
      font: sans,
      range: { category: [c.cat1, c.cat2, c.cat3, c.cat4, c.cat5, c.cat6] },
      mark: { color: c.accent },
      bar: { ...VEGA_CONFIG.bar, color: c.accent },
      line: { ...VEGA_CONFIG.line, color: c.accent },
      point: { ...VEGA_CONFIG.point, color: c.accent, stroke: c.page }, // the ring keeps dots apart where they meet
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
  node.style.color = resolveColor(el.color, look.colors) ?? look.text;
  node.style.textAlign = el.align ?? 'center';
  if (el.maxWidth) node.style.maxWidth = px(el.maxWidth);
  const kind = fontKind(el);
  if (kind === 'display') node.classList.add('title');
  else if (kind === 'mono') node.classList.add('mono');
}

function makeShape(el, look) {
  const sw = el.strokeWidth ?? (el.shape === 'line' ? DEFAULT_LINE_STROKE : 0);
  const w = el.width ?? DEFAULT_SHAPE_SIZE;
  const h = el.shape === 'line' ? sw : (el.height ?? DEFAULT_SHAPE_SIZE);
  const svg = svgEl('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}` });
  const common = { pathLength: 1, 'stroke-dasharray': 1, 'stroke-dashoffset': 0 };
  const paint = (value) => resolveColor(value, look.colors);
  const extras = [];
  let node;
  let arrowNode = null;
  let lineLength = 0; // a line's drawn length at draw 1, for the round-cap dot rule in makeApply
  let highlight = null;
  if (el.shape === 'line') {
    const colour = paint(el.stroke ?? el.fill) ?? look.shape;
    const head = el.arrow === 'end' ? Math.min(sw * ARROW_HEAD_LENGTH, w) : 0;
    const round = el.cap === 'round';
    const pad = round ? Math.min(sw / 2, w / 2) : 0; // a round cap overshoots its end by half the stroke width
    lineLength = Math.max(0, w - (head || pad) - pad);
    node = svgEl('line', { x1: pad, y1: h / 2, x2: w - (head || pad), y2: h / 2, stroke: colour, 'stroke-width': sw, ...(round && { 'stroke-linecap': 'round' }), ...common });
    if (head) {
      const half = sw * ARROW_HALF_WIDTH;
      arrowNode = svgEl('path', { d: `M${w - head} ${h / 2 - half}L${w} ${h / 2}L${w - head} ${h / 2 + half}Z`, fill: colour, opacity: 0 });
      extras.push(arrowNode);
    }
  } else {
    const base = paint(el.fill) ?? (el.stroke ? 'none' : look.shape);
    const fill = el.elevated && base !== 'none' ? `color-mix(in srgb, ${base}, ${look.colors.text} ${ELEVATED_LIFT}%)` : base;
    const inset = sw / 2;
    const attrs = { fill, stroke: paint(el.stroke) ?? 'none', 'stroke-width': sw, ...common };
    node = el.shape === 'ellipse'
      ? svgEl('ellipse', { cx: w / 2, cy: h / 2, rx: Math.max(0, w / 2 - inset), ry: Math.max(0, h / 2 - inset), ...attrs })
      : svgEl('rect', { x: inset, y: inset, width: Math.max(0, w - sw), height: Math.max(0, h - sw), rx: el.radius ?? 0, ...attrs });
    if (el.elevated && base !== 'none') {
      // A 1 px highlight just inside the edge, drawn after the rect and drawn in with it; a drop shadow would not show on
      // a dark page, and a stroke-only rect has no fill to lift, so it gets none.
      const edge = sw + 0.5;
      highlight = svgEl('rect', { x: edge, y: edge, width: Math.max(0, w - 2 * edge), height: Math.max(0, h - 2 * edge), rx: Math.max(0, (el.radius ?? 0) - edge), fill: 'none', stroke: ELEVATED_HIGHLIGHT, 'stroke-width': 1, ...common });
      extras.push(highlight);
    }
  }
  svg.append(node, ...extras);
  return { root: svg, drawNodes: highlight ? [node, highlight] : [node], arrowNode, lineLength, roundCap: el.cap === 'round', width: w, height: h };
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

// A `typing` text: the typed characters, a caret, then the untyped rest kept in the layout but not drawn, so the
// element's box is the full text at every moment and does not shift as it fills.
function typingParts(node, el) {
  const chars = graphemes(el.text);
  const typed = document.createElement('span');
  typed.className = 'typed';
  const caret = document.createElement('span');
  caret.className = 'caret';
  const rest = document.createElement('span');
  rest.className = 'rest';
  rest.style.visibility = 'hidden';
  node.append(typed, caret, rest);
  return { chars, total: typingLength(el.text), typed, caret, rest };
}

function setTyping({ chars, total, typed, caret, rest }, value, sec) {
  const n = Math.min(total, Math.max(0, Math.floor(value + TYPING_EPSILON)));
  typed.textContent = chars.slice(0, n).join('');
  rest.textContent = chars.slice(n).join('');
  const blinkOn = Math.floor(sec / CARET_BLINK_SECONDS) % 2 === 0;
  caret.style.visibility = n < total || blinkOn ? 'visible' : 'hidden';
}

function buildElement(el, look) {
  const node = document.createElement('div');
  node.className = `el ${el.type}`;
  node.dataset.id = el.id;
  const part = { node, el };
  switch (el.type) {
    case 'text':
      textStyle(node, el, look);
      if (el.typing) part.typing = typingParts(node, el);
      else node.textContent = el.text;
      break;
    case 'counter':
      textStyle(node, el, look);
      part.format = (v) => `${el.prefix ?? ''}${v.toFixed(el.decimals ?? 0)}${el.suffix ?? ''}`;
      break;
    case 'shape': {
      const s = makeShape(el, look);
      Object.assign(part, { drawNodes: s.drawNodes, arrowNode: s.arrowNode, roundCap: s.roundCap && { radius: (el.strokeWidth ?? DEFAULT_LINE_STROKE) / 2, length: s.lineLength } });
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
// server.mjs) under a light page-colour scrim; styles.css gives text on it a page-colour halo.
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

// One over-the-scenes layer: darkened corners.
function vignetteLayer() {
  const layer = document.createElement('div');
  layer.className = 'vignette';
  layer.style.cssText = 'position:absolute;inset:0;pointer-events:none';
  layer.style.background = VIGNETTE;
  return layer;
}

// FNV-1a of the scene id as a feTurbulence seed: the same id always draws the same noise (as the art does).
function sceneSeed(id) {
  let h = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(id)) h = Math.imul(h ^ byte, 0x01000193);
  return (h >>> 0) % GRAIN_SEED_RANGE;
}

// One static film-grain layer for a scene: monochrome fractal noise, stretched to three times its contrast around
// mid-grey, drawn with the `overlay` blend so it is luminance-neutral (mid-grey noise leaves the average colour of what is
// under it unchanged, dark or light; a plain alpha blend would wash dark themes milky). It is an SVG feTurbulence loaded
// as an image (filtered in sRGB: the default linear space would lift the mean of the noise), decoded once, seeded from the scene id and never changed (a seed change in the page does not repaint);
// its strength is the noise's alpha, `amount` x GRAIN_GAIN. The layer sits on the stage, over every scene, because
// a blend inside a scene layer (a group of its own) would see only that layer's elements, not what is beneath it.
// makeApply shows it with its scene and at that scene's opacity.
async function grainLayer(scene, size, amount) {
  const [w, h] = size;
  const seed = sceneSeed(scene.id);
  const markup = `<svg xmlns="${SVG_NS}" width="${w}" height="${h}"><filter id="g" x="0" y="0" width="${w}" height="${h}" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">`
    + `<feTurbulence type="fractalNoise" baseFrequency="${GRAIN_FREQUENCY}" numOctaves="${GRAIN_OCTAVES}" seed="${seed}" stitchTiles="stitch"/>`
    + `<feColorMatrix type="matrix" values="1 1 1 0 -1  1 1 1 0 -1  1 1 1 0 -1  0 0 0 0 ${Math.min(1, amount * GRAIN_GAIN)}"/></filter>`
    + `<rect width="${w}" height="${h}" filter="url(#g)"/></svg>`;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  await img.decode().catch(() => { throw new Error(`grain failed to draw for scene "${scene.id}"`); });
  img.className = 'grain';
  img.dataset.seed = String(seed);
  img.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px;pointer-events:none;mix-blend-mode:overlay;display:none`;
  return img;
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
  const grain = spec.texture?.grain ?? 0;
  for (const scene of spec.scenes) {
    const layer = document.createElement('div');
    layer.className = 'scene';
    if (scene.background === 'art') {
      const art = artLayer(scene);
      layer.classList.add('on-art');
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
    const entry = { scene, layer, grain: null };
    if (grain > 0) pending.push(grainLayer(scene, spec.size, grain).then((img) => { entry.grain = img; }));
    scenes.push(entry);
  }
  await Promise.all(pending);
  for (const { grain: img } of scenes) if (img) stage.append(img); // over the scenes, under the vignette
  if (spec.texture?.vignette) stage.append(vignetteLayer());
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

// The chart reveal as a left-to-right wipe whose front fades over REVEAL_EDGE percent instead of cutting hard.
function revealMask(reveal) {
  if (reveal >= 1) return 'none';
  const front = reveal * (100 + REVEAL_EDGE); // reveal 0 puts the whole edge left of the chart, 1 right of it
  return `linear-gradient(to right, #000 ${front - REVEAL_EDGE}%, transparent ${front}%)`;
}

function makeApply({ scenes, parts }, built) {
  const { states, sceneStarts, crossfades } = built;
  return (sec) => {
    const active = activeScene(sceneStarts, sec);
    // During a crossfade the previous scene's layer stays up beneath the active one.
    const outgoing = crossfades.find((c) => c.to === active && sec < c.end)?.from;
    scenes.forEach(({ scene, layer, grain }, i) => {
      layer.style.display = i === active || i === outgoing ? 'block' : 'none';
      layer.style.opacity = String(states.get(`scene:${scene.id}`).opacity);
      if (grain) {
        grain.style.display = layer.style.display;
        grain.style.opacity = layer.style.opacity;
      }
    });
    for (const { node, el, drawNodes, arrowNode, roundCap, format, typing } of parts) {
      const s = states.get(el.id);
      node.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -50%) scale(${s.scale}) rotate(${s.rotate}deg)`;
      node.style.opacity = String(s.opacity);
      for (const drawNode of drawNodes ?? []) drawNode.setAttribute('stroke-dashoffset', String(1 - s.draw));
      // A round cap draws a dot of the stroke's width the moment the dash has any length: keep the line hidden until
      // the drawn length is more than a cap radius, so the stroke grows from a stub instead of popping in as a dot. A
      // line shorter than that (the validator allows them) still shows once fully drawn.
      if (roundCap) drawNodes[0].style.visibility = s.draw >= 1 || s.draw * roundCap.length > roundCap.radius ? 'visible' : 'hidden';
      if (arrowNode) arrowNode.setAttribute('opacity', s.draw >= ARROW_DRAW_SHOWN ? '1' : '0');
      if (el.type === 'chart') {
        node.style.maskImage = revealMask(s.reveal);
        node.dataset.reveal = String(s.reveal); // check.mjs: a chart at reveal 0 is not on screen
      }
      if (format) node.textContent = format(s.value);
      if (typing) setTyping(typing, s.value, sec);
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

const STAMP_CSS = 'position:fixed;right:1.2vw;bottom:1.2vw;z-index:2147483647;padding:.3em .6em;border-radius:.3em;'
  + 'background:rgba(0,0,0,.72);color:#fff;font:600 max(11px,1.7vw)/1.2 ui-monospace,Menlo,monospace;pointer-events:none';

// A fixed `<scene-id> · 1.20s` label for contact sheets. Created lazily so other modes have no such element;
// an empty text removes it again.
function stampSheet(text) {
  let el = document.querySelector('[data-sheet-stamp]');
  if (!text) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.dataset.sheetStamp = '';
    el.style.cssText = STAMP_CSS;
    document.body.append(el);
  }
  el.textContent = text;
}

function makeMotion(spec, built, apply, audio) {
  return {
    duration: built.duration, fps: spec.fps, size: spec.size, sceneStarts: built.sceneStarts, crossfades: built.crossfades,
    sceneIds: spec.scenes.map((s) => s.id), audio,
    seek(sec) {
      const t = Math.min(Math.max(0, sec), built.duration);
      seekTo(built.timeline, t);
      apply(t);
    },
    // Contact-sheet mode only: render.mjs --contact-sheet calls this; a normal render or preview never does.
    stamp(text) { stampSheet(text); },
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

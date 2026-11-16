// Canvas 2D drawing of a sampled (and camera-applied) scene graph. drawFrame(ctx, sampled, env) paints the nodes in
// order, each child after its parent inside the parent's transform. Nothing here reads a clock or a random source:
// the same sampled tree draws the same pixels.
import { applyFont, WORD_IDENTITY } from './text-style.mjs';
import { measurePath, path2D } from './geometry.mjs';
import { roughShape } from './rough.mjs';
import { contentBox, localMatrix } from './bounds.mjs';
import { registries } from '../registry.mjs';
import '../fields/index.mjs';

const DEFAULT_TEXT_FILL = '#ffffff';
const DEFAULT_STROKE_WIDTH = 1;
const HALF = 2;
const HEX_RADIX = 16;

// Sampled values are not clamped (an overshoot ease can leave 0..1), so opacity, draw and reveal are clamped here.
const unit01 = (v) => Math.min(1, Math.max(0, v));

// ---- text ----

// A word's glyph glow: its own glyphs blurred (canvas shadow) in glow.color at `share` of glow.alpha, under the word,
// screened so it only lightens (over a dark field a source-over gold read as brown mud in the counters). The shadow is
// a blur of the glyph mask alone, so it hugs the letters and costs about what the word does.
function drawGlow(ctx, text, x, glow, share) {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  withGlow(ctx, glow, share, () => ctx.fillText(text, x, 0));
  ctx.restore();
}

// Runs paint() with a canvas shadow of glow.color at `share` of glow.alpha, glow.radius px of blur, then clears it.
function withGlow(ctx, glow, share, paint) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(glow.color.slice(i, i + HALF), HEX_RADIX));
  ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${glow.alpha * share})`;
  ctx.shadowBlur = glow.radius;
  paint();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
}

function drawWord(ctx, line, word, tracks, baseFill, glow) {
  const opacity = unit01(tracks.opacity);
  if (opacity <= 0) return;
  ctx.save();
  ctx.globalAlpha *= opacity;
  ctx.translate(line.x + word.x + word.width / HALF + tracks.x, line.y + tracks.y);
  ctx.scale(tracks.scale, tracks.scale);
  ctx.fillStyle = tracks.fill ?? baseFill;
  const share = unit01(tracks.glow ?? 0);
  if (glow && share > 0) drawGlow(ctx, word.text, -word.width / HALF, glow, share);
  ctx.fillText(word.text, -word.width / HALF, 0);
  ctx.restore();
}

function drawText(ctx, n) {
  const { layout, font, fill = DEFAULT_TEXT_FILL, glow } = n.props;
  if (!layout || !font) throw new Error(`text node "${n.id}" needs props.layout and props.font`);
  applyFont(ctx, font, { tracked: true });
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  for (const line of layout.lines) {
    // words has an entry only for each wordTracks entry; a word beyond them is untouched (opacity 1, no offset)
    for (const word of line.words) drawWord(ctx, line, word, { ...WORD_IDENTITY, ...n.words?.[word.index] }, fill, glow);
  }
}

// ---- paths ----

// The Path2D to paint and its length: the path as written, or its seeded rough copy.
function shapeOf(n) {
  const { d, rough } = n.props;
  if (typeof d !== 'string') throw new Error(`path node "${n.id}" needs props.d, an SVG path string`);
  if (rough > 0) return roughShape(n.id, d, rough);
  return { path: path2D(d), length: measurePath(d).length };
}

// `draw` < 1 trims the stroke to that fraction of the path's length with a dash; the fill waits for a finished path.
function strokeTrimmed(ctx, path, length, draw) {
  if (draw <= 0 || length <= 0) return;
  if (draw < 1) ctx.setLineDash([draw * length, length]);
  ctx.stroke(path);
  ctx.setLineDash([]);
}

// The glow of `path` alone, without its fill: the fill is drawn FAR_OFF user units away and its shadow offset back by
// the same distance in device pixels (canvas shadow offsets ignore the transform), so only the light lands.
const FAR_OFF = 100000;
function glowOnly(ctx, path, glow) {
  const m = ctx.getTransform();
  ctx.save();
  ctx.translate(FAR_OFF, 0);
  ctx.shadowOffsetX = -m.a * FAR_OFF;
  ctx.shadowOffsetY = -m.b * FAR_OFF;
  withGlow(ctx, glow, 1, () => ctx.fill(path));
  ctx.restore();
}

// props.glow ({ color, alpha, radius, only }) on a filled path: a soft light round its edge, the canvas shadow of its
// fill (a smooth blur, so no steps), drawn under the fill; with `only`, the light without the fill.
// props.radial ({ r, color, stops: [[at, alpha, stopColor?]...] }) on a path: it is filled with a radial gradient about
// the node's origin, each stop's colour (its own, else `color`) at its alpha out to r, instead of props.fill: a soft
// disc of light with no blur filter (a hot core, a limb and a bloom are stops of one gradient).
function radialFill(ctx, { r, color, stops }) {
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + HALF), HEX_RADIX)).join(', ');
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
  for (const [at, alpha, stopColor] of stops) gradient.addColorStop(at, `rgba(${rgb(stopColor ?? color)}, ${alpha})`);
  return gradient;
}

function drawPath(ctx, n) {
  const { stroke, strokeWidth = DEFAULT_STROKE_WIDTH, lineCap = 'round', glow, radial } = n.props;
  const fill = radial ? radialFill(ctx, radial) : n.props.fill;
  const { path, length } = shapeOf(n);
  const draw = unit01(n.draw);
  if (fill && draw >= 1) {
    ctx.fillStyle = fill;
    if (glow?.only) glowOnly(ctx, path, glow);
    else if (glow) withGlow(ctx, glow, 1, () => ctx.fill(path));
    else ctx.fill(path);
  }
  if (!stroke) return;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = lineCap;
  ctx.lineJoin = 'round';
  strokeTrimmed(ctx, path, length, draw);
}

// ---- images ----

// props.clip = [sx, sy, sw, sh] in the picture's own pixels draws only that part of it, stretched to w x h.
function drawImage(ctx, n, assets) {
  const { src, w, h, clip } = n.props;
  const image = assets.get(src);
  if (!image) throw new Error(`image node "${n.id}": no loaded picture for src "${src}"`);
  if (clip === undefined) return ctx.drawImage(image, 0, 0, w ?? image.width, h ?? image.height);
  const ok = Array.isArray(clip) && clip.length === 4 && clip.every(Number.isFinite) && clip[2] > 0 && clip[3] > 0;
  if (!ok) throw new Error(`image node "${n.id}": clip must be [sx, sy, sw, sh] in image pixels with sw, sh > 0, got ${JSON.stringify(clip)}`);
  return ctx.drawImage(image, ...clip, 0, 0, w ?? clip[2], h ?? clip[3]);
}

// ---- fields ----

// A field node's props carry everything its plan needs ({ field, params, w, h, unit, seed, palette }). The plan is
// built once per node id and props (shots share the field id but not the seed, so the props are part of the key)
// and painted inside the node's transform. A film has a bounded number of these, one or two per shot.
const fieldPlans = new Map();

function drawField(ctx, n, time = 0) {
  const { field, params, w, h, unit, seed, palette } = n.props;
  const def = registries.fields.get(field);
  const key = `${n.id}\n${JSON.stringify([field, params, w, h, unit, seed, palette])}`;
  if (!fieldPlans.has(key)) fieldPlans.set(key, def.plan({ w, h, unit, seed, params, palette }));
  def.paint(ctx, fieldPlans.get(key), time);
}

// ---- nodes ----

function drawBody(ctx, n, env) {
  if (n.type === 'text') return drawText(ctx, n);
  if (n.type === 'path') return drawPath(ctx, n);
  if (n.type === 'image') return drawImage(ctx, n, env.assets);
  if (n.type === 'field') return drawField(ctx, n, env.time);
  return undefined; // a group draws only its children
}

// `reveal` keeps the left fraction of the node's whole box: its own content and every descendant, so a group at 0.5
// shows the left half of its subtree. The clip stays on for the node's children.
function clipToReveal(ctx, n) {
  const reveal = unit01(n.reveal);
  const box = reveal < 1 ? contentBox(n) : null;
  if (!box) return;
  ctx.beginPath();
  ctx.rect(box[0], box[1], box[2] * reveal, box[3]);
  ctx.clip();
}

// props.blend on any node: how it and its children composite onto what is already drawn. Default source-over.
const BLEND_MODES = Object.freeze(['multiply', 'screen', 'overlay', 'lighter']);

function applyBlend(ctx, n) {
  const { blend } = n.props;
  if (blend === undefined) return;
  if (!BLEND_MODES.includes(blend)) throw new Error(`node "${n.id}": blend must be one of ${BLEND_MODES.join(', ')}, got ${JSON.stringify(blend)}`);
  ctx.globalCompositeOperation = blend;
}

// props.layer on a node: it and its children are drawn on a canvas of their own (cleared, the same size and transform
// as the one being drawn on) and that picture is composited once, at the node's opacity and blend. Without it, opacity
// multiplies into each child and overlapping children show through one another; a cut's smear sample (cuts/index.mjs)
// must be one picture for its running average to weigh every sample the same. One scratch canvas per nesting depth.
const layerCanvases = [];

function layerContext(ctx, depth) {
  const { width, height } = ctx.canvas;
  let canvas = layerCanvases[depth];
  if (!canvas || canvas.width !== width || canvas.height !== height) {
    canvas = new OffscreenCanvas(width, height);
    layerCanvases[depth] = canvas;
  }
  const layer = canvas.getContext('2d');
  // a draw that threw inside a layer leaves its saves and clip on this scratch context: reset() empties the save stack
  // and drops the clip (the lines after it set the rest, also where reset() is missing)
  if (typeof layer.reset === 'function') layer.reset();
  layer.setTransform(1, 0, 0, 1, 0, 0);
  layer.globalAlpha = 1;
  layer.globalCompositeOperation = 'source-over';
  layer.filter = 'none';
  layer.clearRect(0, 0, width, height);
  layer.setTransform(ctx.getTransform());
  return layer;
}

function drawLayer(ctx, n, env) {
  const depth = env.layerDepth ?? 0;
  const layer = layerContext(ctx, depth);
  const inner = { ...env, layerDepth: depth + 1 };
  drawBody(layer, n, inner);
  for (const child of n.children) drawNode(layer, child, inner);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(layer.canvas, 0, 0);
}

function drawNode(ctx, n, env) {
  const opacity = unit01(n.opacity);
  if (opacity <= 0) return; // also hides the children, as `visible` does
  ctx.save();
  ctx.transform(...localMatrix(n));
  ctx.globalAlpha *= opacity;
  applyBlend(ctx, n);
  if (n.blur > 0) ctx.filter = `blur(${n.blur}px)`; // a blurred parent blurs its children too
  clipToReveal(ctx, n);
  if (n.props.layer === true) drawLayer(ctx, n, env);
  else {
    drawBody(ctx, n, env);
    for (const child of n.children) drawNode(ctx, child, env);
  }
  ctx.restore();
}

/**
 * Put the context back to a known base: default transform, alpha, composite, filter and clip, an empty save stack,
 * and a cleared bitmap. A draw that threw halfway leaves its saves, clip and alpha behind; this undoes them.
 */
export function resetContext(ctx) {
  if (typeof ctx.reset === 'function') {
    ctx.reset();
    return;
  }
  ctx.canvas.width = ctx.canvas.width; // assigning the width resets the whole 2D state, on every browser
}

/**
 * Paint `sampled` onto ctx. The caller has already painted the background.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object[]} sampled sampleGraph output after applyCamera
 * @param {{ assets?: Map<string, ImageBitmap | HTMLImageElement>, canvas: { w: number, h: number }, time?: number }} env
 *   `time` is the film time in seconds, handed to a field's paint (a field may move with it).
 */
export function drawFrame(ctx, sampled, { assets = new Map(), canvas, time = 0 } = {}) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.filter = 'none';
  const env = { assets, canvas, time };
  for (const n of sampled) drawNode(ctx, n, env);
}

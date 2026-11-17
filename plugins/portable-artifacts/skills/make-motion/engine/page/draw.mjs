// Canvas 2D drawing of a sampled (and camera-applied) scene graph. drawFrame(ctx, sampled, env) paints the nodes in
// order, each child after its parent inside the parent's transform. Nothing here reads a clock or a random source:
// the same sampled tree draws the same pixels.
import { applyFont, createMeasure, WORD_IDENTITY } from './text-style.mjs';
import { drawnFont, reservedFont, reservedInset } from '../text/layout.mjs';
import { measurePath, path2D } from './geometry.mjs';
import { roughShape } from './rough.mjs';
import { contentBox, localMatrix } from './bounds.mjs';
import { registries } from '../registry.mjs';
import { GLOW_EDGE } from '../devices/glow.mjs';
import { createTreatCache } from './treat.mjs';
import { frameIndexOf } from '../kinds/media-clip.mjs';
import '../fields/index.mjs';

const DEFAULT_TEXT_FILL = '#ffffff';
const DEFAULT_STROKE_WIDTH = 1;
const HALF = 2;
const HEX_RADIX = 16;

// Sampled values are not clamped (an overshoot ease can leave 0..1), so opacity, draw and reveal are clamped here.
const unit01 = (v) => Math.min(1, Math.max(0, v));

// ---- text ----

// A word's glyph glow: its own glyphs stroked in stacked rings (stackGlow) in glow.color at `share` of glow.alpha, under
// the word, screened so it only lightens (over a dark field a source-over gold read as brown mud in the counters). The
// rings follow the glyph outlines, so the light hugs the letters.
function drawGlow(ctx, text, x, glow, share) {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  stackGlow(ctx, glow, share, () => ctx.strokeText(text, x, 0));
  ctx.restore();
}

// A glow with no blur filter (the plan forbids them; a canvas shadow blur is a full Gaussian pass per glowing shape,
// every frame): `rings` strokes of the shape (paint() strokes it at the context's line width), widest first, the rings
// packed toward the shape (widths rising as the GLOW_CURVE power of their rank), each at the alpha that stacks to
// GLOW_EDGE of glow.alpha * share at the shape's edge (where a blur's falloff stands at half) and falls to nothing
// glow.radius px out: bright at the edge and quickly gone, as light is (an even falloff left a wide half-tone band that
// read as a brown halo round white type). devices/shared.mjs softRoundedRect stacks rings the same way.
const GLOW_STEP = 3; // px between rings on average: too fine to see at glow alphas
const GLOW_RINGS = Object.freeze({ min: 4, max: 16 });
const GLOW_CURVE = 1.5;
function stackGlow(ctx, glow, share, paint) {
  const rings = Math.min(GLOW_RINGS.max, Math.max(GLOW_RINGS.min, Math.ceil(glow.radius / GLOW_STEP)));
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(glow.color.slice(i, i + HALF), HEX_RADIX));
  const alpha = 1 - (1 - Math.min(1, GLOW_EDGE * glow.alpha * share)) ** (1 / rings);
  ctx.save();
  ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (let i = rings; i >= 1; i--) {
    ctx.lineWidth = HALF * glow.radius * (i / rings) ** GLOW_CURVE;
    paint();
  }
  ctx.restore();
}

// A word with its own weight or width (its tracks), or in a text laid out at a reserved weight and width: set in the
// font it is drawn in, and how far right of its room's left edge it starts so it is centred in the room layout measured
// for it (text/layout.mjs reservedInset). Called inside drawWord's save, so the next word starts from the text's font.
function wordInset(ctx, word, tracks, font, reserve) {
  const drawn = drawnFont(font, tracks);
  if (drawn === font && reserve === undefined) return 0;
  const inset = reservedInset(createMeasure(ctx), reservedFont(font, reserve), drawn, word.text);
  applyFont(ctx, drawn, { tracked: true });
  return inset;
}

function drawWord(ctx, line, word, tracks, baseFill, glow, type) {
  const opacity = unit01(tracks.opacity);
  if (opacity <= 0) return;
  ctx.save();
  ctx.globalAlpha *= opacity;
  ctx.translate(line.x + word.x + word.width / HALF + tracks.x, line.y + tracks.y);
  ctx.scale(tracks.scale, tracks.scale);
  ctx.fillStyle = tracks.fill ?? baseFill;
  const left = -word.width / HALF + wordInset(ctx, word, tracks, type.font, type.reserve);
  const share = unit01(tracks.glow ?? 0);
  if (glow && share > 0) drawGlow(ctx, word.text, left, glow, share);
  ctx.fillText(word.text, left, 0);
  ctx.restore();
}

function drawText(ctx, n) {
  const { layout, font, fill = DEFAULT_TEXT_FILL, glow } = n.props;
  if (!layout || !font) throw new Error(`text node "${n.id}" needs props.layout and props.font`);
  applyFont(ctx, font, { tracked: true });
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const type = { font, reserve: layout.reserve };
  for (const line of layout.lines) {
    // words has an entry only for each wordTracks entry; a word beyond them is untouched (opacity 1, no offset)
    for (const word of line.words) drawWord(ctx, line, word, { ...WORD_IDENTITY, ...n.words?.[word.index] }, fill, glow, type);
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

// The light of `path` (stackGlow): each ring strokes the outline and fills the inside, so the inside holds the full
// glow and the edge falls off outward.
function pathGlow(ctx, path, glow) {
  stackGlow(ctx, glow, 1, () => {
    ctx.stroke(path);
    ctx.fill(path);
  });
}

// props.glow ({ color, alpha, radius, only }) on a filled path: a soft light round its edge (stacked rings, no blur),
// drawn under the fill; with `only`, the light without the fill.
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
    if (glow) pathGlow(ctx, path, glow);
    ctx.fillStyle = fill;
    if (!glow?.only) ctx.fill(path);
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
// props.video ({ count }) makes the picture a video clip's decoded frame: the one the node's `frame` value names
// (engine/kinds/media-clip.mjs frameIndexOf), which the stage loaded before the draw (env.frames).
function drawImage(ctx, n, assets, frames) {
  const { src, w, h, clip } = n.props;
  const image = n.props.video ? frames(src, frameIndexOf(n.frame ?? 0, n.props.video.count)) : assets.get(src);
  if (!image) throw new Error(`image node "${n.id}": no loaded picture for src "${src}"`);
  if (n.props.silhouette) return drawSilhouette(ctx, image, n.props);
  if (clip === undefined) return ctx.drawImage(image, 0, 0, w ?? image.width, h ?? image.height);
  const ok = Array.isArray(clip) && clip.length === 4 && clip.every(Number.isFinite) && clip[2] > 0 && clip[3] > 0;
  if (!ok) throw new Error(`image node "${n.id}": clip must be [sx, sy, sw, sh] in image pixels with sw, sh > 0, got ${JSON.stringify(clip)}`);
  return ctx.drawImage(image, ...clip, 0, 0, w ?? clip[2], h ?? clip[3]);
}

// props.silhouette ({ color, spread }) on an image: the picture's own shape in flat `color` (its alpha kept, its colours
// dropped), dilated by `spread` px (copies at RING_STEPS points round circles of spread and half of it, then filled
// through source-in): a cut-out's keyline and shadow that follow the edge of a picture with transparency
// (engine/devices/cutout.mjs). One scratch canvas, reused.
const RING_STEPS = 16;
const RING_RADII = Object.freeze([1, 0.5]);
const silhouetteScratch = { canvas: null };

function drawSilhouette(ctx, image, { w, h, clip, silhouette }) {
  const width = w ?? clip?.[2] ?? image.width, height = h ?? clip?.[3] ?? image.height;
  const spread = silhouette.spread ?? 0;
  const cw = Math.ceil(width + HALF * spread), ch = Math.ceil(height + HALF * spread);
  if (!silhouetteScratch.canvas || silhouetteScratch.canvas.width < cw || silhouetteScratch.canvas.height < ch) silhouetteScratch.canvas = new OffscreenCanvas(cw, ch);
  const c = silhouetteScratch.canvas.getContext('2d');
  resetContext(c);
  const place = (dx, dy) => (clip ? c.drawImage(image, ...clip, spread + dx, spread + dy, width, height) : c.drawImage(image, spread + dx, spread + dy, width, height));
  if (spread > 0) {
    for (const r of RING_RADII) {
      for (let k = 0; k < RING_STEPS; k++) place(spread * r * Math.cos((2 * Math.PI * k) / RING_STEPS), spread * r * Math.sin((2 * Math.PI * k) / RING_STEPS));
    }
  }
  place(0, 0);
  c.globalCompositeOperation = 'source-in';
  c.fillStyle = silhouette.color;
  c.fillRect(0, 0, cw, ch);
  ctx.drawImage(silhouetteScratch.canvas, 0, 0, cw, ch, -spread, -spread, cw, ch);
}

// props.treatment ({ type: 'duotone' | 'halftone', dark, light, cell? }, engine/devices/treatments.mjs) on an image: the
// picture (through its clip) treated once at its drawn size (treat.mjs) and that bitmap drawn instead, every frame.
const treated = createTreatCache((width, height) => new OffscreenCanvas(width, height));

function drawTreated(ctx, n, assets) {
  const { src, clip, treatment } = n.props;
  const image = assets.get(src);
  if (!image) throw new Error(`image node "${n.id}": no loaded picture for src "${src}"`);
  const w = n.props.w ?? clip?.[2] ?? image.width, h = n.props.h ?? clip?.[3] ?? image.height;
  return ctx.drawImage(treated.get(image, treatment, w, h, clip), 0, 0, w, h);
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
  if (n.type === 'image') return n.props.treatment && !n.props.silhouette ? drawTreated(ctx, n, env.assets) : drawImage(ctx, n, env.assets, env.frames);
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
// multiplies into each child and overlapping children show through one another. (A cut's motion blur no longer uses
// layers: engine/page/accumulate.mjs sums its samples.) One scratch canvas per nesting depth.
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

// Without a frame source a clip cannot be drawn: an error that names it, never a blank picture.
const noFrames = (src, n) => { throw new Error(`clip "${src}": frame ${n} was not loaded before the draw`); };

/**
 * Paint `sampled` onto ctx. The caller has already painted the background. env.frames(src, n) gives a clip's decoded
 * frame n (the stage loads them before it draws).
 * @param {CanvasRenderingContext2D} ctx
 * @param {object[]} sampled sampleGraph output after applyCamera
 * @param {{ assets?: Map<string, ImageBitmap | HTMLImageElement>, canvas: { w: number, h: number }, time?: number }} env
 *   `time` is the film time in seconds, handed to a field's paint (a field may move with it).
 */
export function drawFrame(ctx, sampled, { assets = new Map(), canvas, time = 0, frames = noFrames } = {}) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.filter = 'none';
  const env = { assets, canvas, time, frames };
  for (const n of sampled) drawNode(ctx, n, env);
}

// Canvas 2D drawing of a sampled (and camera-applied) scene graph. drawFrame(ctx, sampled, env) paints the nodes in
// order, each child after its parent inside the parent's transform. Nothing here reads a clock or a random source:
// the same sampled tree draws the same pixels.
import { applyFont } from './text-style.mjs';
import { measurePath, path2D } from './geometry.mjs';
import { roughShape } from './rough.mjs';
import { localBounds, localMatrix } from './bounds.mjs';

const DEFAULT_TEXT_FILL = '#ffffff';
const DEFAULT_STROKE_WIDTH = 1;
const WORD_IDENTITY = Object.freeze({ opacity: 1, x: 0, y: 0, scale: 1 });
const HALF = 2;

// Sampled values are not clamped (an overshoot ease can leave 0..1), so opacity, draw and reveal are clamped here.
const unit01 = (v) => Math.min(1, Math.max(0, v));

// ---- text ----

function drawWord(ctx, line, word, tracks, baseFill) {
  const opacity = unit01(tracks.opacity);
  if (opacity <= 0) return;
  ctx.save();
  ctx.globalAlpha *= opacity;
  ctx.translate(line.x + word.x + word.width / HALF + tracks.x, line.y + tracks.y);
  ctx.scale(tracks.scale, tracks.scale);
  ctx.fillStyle = tracks.fill ?? baseFill;
  ctx.fillText(word.text, -word.width / HALF, 0);
  ctx.restore();
}

function drawText(ctx, n) {
  const { layout, font, fill = DEFAULT_TEXT_FILL } = n.props;
  if (!layout || !font) throw new Error(`text node "${n.id}" needs props.layout and props.font`);
  applyFont(ctx, font, { tracked: true });
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  for (const line of layout.lines) {
    // words has an entry only for each wordTracks entry; a word beyond them is untouched (opacity 1, no offset)
    for (const word of line.words) drawWord(ctx, line, word, { ...WORD_IDENTITY, ...n.words?.[word.index] }, fill);
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

function drawPath(ctx, n) {
  const { fill, stroke, strokeWidth = DEFAULT_STROKE_WIDTH, lineCap = 'round' } = n.props;
  const { path, length } = shapeOf(n);
  const draw = unit01(n.draw);
  if (fill && draw >= 1) {
    ctx.fillStyle = fill;
    ctx.fill(path);
  }
  if (!stroke) return;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = lineCap;
  ctx.lineJoin = 'round';
  strokeTrimmed(ctx, path, length, draw);
}

// ---- images ----

function drawImage(ctx, n, assets) {
  const { asset, w, h } = n.props;
  const image = assets[asset];
  if (!image) throw new Error(`image node "${n.id}": no asset ${asset} (the film names ${assets.length})`);
  ctx.drawImage(image, 0, 0, w ?? image.width, h ?? image.height);
}

// ---- nodes ----

function drawBody(ctx, n, env) {
  if (n.type === 'text') return drawText(ctx, n);
  if (n.type === 'path') return drawPath(ctx, n);
  if (n.type === 'image') return drawImage(ctx, n, env.assets);
  if (n.type === 'field') throw new Error(`field node "${n.id}": fields are drawn by a later stage`);
  return undefined; // a group draws only its children
}

// `reveal` keeps the left fraction of the node's own content box.
function drawRevealed(ctx, n, env) {
  ctx.save();
  const reveal = unit01(n.reveal);
  if (reveal < 1) {
    const box = localBounds(n);
    if (box) {
      ctx.beginPath();
      ctx.rect(box[0], box[1], box[2] * reveal, box[3]);
      ctx.clip();
    }
  }
  drawBody(ctx, n, env);
  ctx.restore();
}

function drawNode(ctx, n, env) {
  const opacity = unit01(n.opacity);
  if (opacity <= 0) return; // also hides the children, as `visible` does
  ctx.save();
  ctx.transform(...localMatrix(n));
  ctx.globalAlpha *= opacity;
  if (n.blur > 0) ctx.filter = `blur(${n.blur}px)`; // a blurred parent blurs its children too
  drawRevealed(ctx, n, env);
  for (const child of n.children) drawNode(ctx, child, env);
  ctx.restore();
}

/**
 * Paint `sampled` onto ctx. The caller has already painted the background.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object[]} sampled sampleGraph output after applyCamera
 * @param {{ assets?: (ImageBitmap | HTMLImageElement)[], canvas: { w: number, h: number }, fields?: object[] }} env
 *   `canvas` and `fields` are for field nodes, which a later task draws.
 */
export function drawFrame(ctx, sampled, { assets = [], canvas, fields = [] } = {}) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.filter = 'none';
  const env = { assets, canvas, fields };
  for (const n of sampled) drawNode(ctx, n, env);
}

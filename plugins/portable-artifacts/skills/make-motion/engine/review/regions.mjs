// Region marks and close-ups at the frame's edge (looks-four Task 4b, controller ruling 4). Two mechanical rules, run by
// frame.mjs auditFrame on each sampled frame, camera applied:
//
// region-off-frame: a mark drawn on a region (the device of an `on` event aimed at `region:<name>`: a highlight frame, a
// circle, an underline, a bracket, an arrow, a label; ctx.regionMarks names their ids, regionMarkIds) whose drawn box
// lies partly outside the frame. The box is the union of the mark's drawn paths (marks.mjs pathBox: points grown by half
// the stroke) and its texts' boxes. A path whose box covers the whole frame is a scrim over the rest of the picture (a
// focus, a region highlight's paper scrim), not a box round the region, and is left out, as is any `.scrim` path.
//
// frame-edge: while a close-up is on screen (a locked look's close-up picture, close-ups.mjs, or a picture the camera
// pushes in on, standing at PUSHED_ZOOM of its size or more), a text whose ink is partly inside and partly outside the
// frame: the frame edge slices it. Landed texts only (frame.mjs Landed): a text a push carries out of the frame is
// moving, and the desk push's paper mask covers it once it rests (captions-browser, the desk screen example).
//
// What escapes: text inside a picture (a screenshot's own words cut by a region's window) is pixels, not a text node, so
// no rule here sees it; and what falls between two sampled frames. Pure and DOM-free.
import { unitOf } from '../units.mjs';
import { unionBox as union } from '../kinds/shared.mjs';
import { pathBox, showsItself, walkPlaced } from './marks.mjs';
import { CLOSE_UP_PHOTO_RE } from '../kinds/close-ups.mjs';

const REGION_PREFIX = 'region:';
const EDGE_TOLERANCE_UNITS = 1; // a box may reach this far past the edge (path coordinates are rounded to 0.01)
const PUSHED_ZOOM = 1.2; // the smallest push (kinds/camera.mjs PUSH.min): a picture at this scale is being pushed in on
const MECHANICAL = 'mechanical';
const UNITS_DECIMALS = 1;
const EDGES = Object.freeze(['left', 'top', 'right', 'bottom']);

const isBox = (box) => Array.isArray(box) && box.length === 4 && box.every(Number.isFinite);
const scaleOf = (n) => (n.scale ?? 1) * Math.sqrt((n.scaleX ?? 1) * (n.scaleY ?? 1));

/** The ids of the devices a shot's `on` events draw on its regions: `<shot id>.on<j>` for each event aimed at a region,
 *  j its place in the shot's `on` as the engine builds it (after emphasis-fallback.mjs has moved events out). */
export function regionMarkIds(shot) {
  return (shot?.on ?? []).flatMap((item, j) => (typeof item?.target === 'string' && item.target.startsWith(REGION_PREFIX) ? [`${shot.id}.on${j}`] : []));
}

// How far a box reaches past each edge of the canvas, in px (positive: outside).
const overhang = ([x, y, w, h], canvas) => ({ left: -x, top: -y, right: x + w - canvas.w, bottom: y + h - canvas.h });

const coversFrame = ([x, y, w, h], canvas, slack) => x <= slack && y <= slack && x + w >= canvas.w - slack && y + h >= canvas.h - slack;

// Each region mark on screen as { id, box }: the union of its drawn paths' boxes (scrims left out) and its texts' boxes.
function regionMarkBoxes(sampled, ids, canvas, slack) {
  const wanted = new Set(ids), owner = new Map(), found = new Map();
  walkPlaced(sampled, (n, m, parent) => {
    const mark = wanted.has(n.id) ? n.id : owner.get(parent) ?? null;
    if (mark === null) return;
    owner.set(n, mark);
    if (!showsItself(n)) return;
    const box = n.type === 'path' ? pathBox(n, m) : n.type === 'text' && isBox(n.bbox) ? n.bbox : null;
    if (box === null || n.id.endsWith('.scrim') || (n.type === 'path' && coversFrame(box, canvas, slack))) return;
    found.set(mark, [...(found.get(mark) ?? []), box]);
  });
  return [...found].map(([id, boxes]) => ({ id, box: union(boxes) }));
}

function offFrameRules(sampled, ctx, finding, unit) {
  const slack = EDGE_TOLERANCE_UNITS * unit;
  return regionMarkBoxes(sampled, ctx.regionMarks ?? [], ctx.canvas, slack).flatMap(({ id, box }) => {
    const past = overhang(box, ctx.canvas);
    const edges = EDGES.filter((edge) => past[edge] > slack);
    if (edges.length === 0) return [];
    const by = Math.max(...edges.map((edge) => past[edge])) / unit;
    return [finding(MECHANICAL, 'region-off-frame', id, `the mark "${id}" on a region runs past the frame's ${edges.join(' and ')} edge${edges.length > 1 ? 's' : ''} by ${by.toFixed(UNITS_DECIMALS)} units; give the region more room in the close-up or mark a smaller region`)];
  });
}

// Is a close-up on screen: a close-up picture (close-ups.mjs) or a picture pushed in on (PUSHED_ZOOM)?
function showsCloseUp(sampled) {
  let found = false;
  const walk = (n, opacity, scale) => {
    const o = opacity * (n.opacity ?? 1), s = scale * scaleOf(n);
    if (found || o <= 0) return;
    if (n.type === 'image' && (CLOSE_UP_PHOTO_RE.test(n.id) || s >= PUSHED_ZOOM)) found = true;
    (n.children ?? []).forEach((child) => walk(child, o, s));
  };
  (Array.isArray(sampled) ? sampled : []).forEach((n) => walk(n, 1, 1));
  return found;
}

// The edges a box crosses: partly inside the canvas and partly outside it, by more than `slack`.
function crossedEdges(box, canvas, slack) {
  const past = overhang(box, canvas);
  const [x, y, w, h] = box;
  const inside = x + w > 0 && y + h > 0 && x < canvas.w && y < canvas.h;
  return inside ? EDGES.filter((edge) => past[edge] > slack) : [];
}

function slicedRules(texts, sampled, ctx, finding, unit) {
  if (!showsCloseUp(sampled)) return [];
  const slack = EDGE_TOLERANCE_UNITS * unit;
  return texts.filter((t) => t.landed).flatMap(({ node, ink, role }) => {
    const edges = crossedEdges(ink, ctx.canvas, slack);
    if (edges.length === 0) return [];
    return [finding(MECHANICAL, 'frame-edge', node.id, `text "${node.id}" is sliced by the frame's ${edges.join(' and ')} edge during a close-up; keep it inside the frame or off the close-up`, role)];
  });
}

/**
 * The two rules on one frame. `texts`: the frame's measured texts as frame.mjs has them ({ node, ink, role }); `finding`
 * makes a finding (kind, rule, node, message, role) with the frame's path.
 */
export function regionFindings(sampled, texts, ctx, finding) {
  const unit = unitOf(ctx.canvas);
  return [...offFrameRules(sampled, ctx, finding, unit), ...slicedRules(texts, sampled, ctx, finding, unit)];
}

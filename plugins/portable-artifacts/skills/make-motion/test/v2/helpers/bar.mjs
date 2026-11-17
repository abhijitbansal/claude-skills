// The look bar for the second-wave kinds (plan 2026-11-16-pa2-shot-kinds-b, Global Constraints): six patterns the look
// reviews rejected, each a check on one shot's expansion. assertBar(kind, shot, { look, format }) runs all six on the
// shot as buildFilm expands it (and, for a narrated kind that does not show its words, again with captions on). Each
// check is a pure function of a small input ({ nodes, duration, canvas, look, ... }) so it can be proven on a hand-built
// node list (bar.test.mjs). Boxes are computed here from the nodes themselves, never from the kind's own `boxes`.
import assert from 'node:assert/strict';
import { registries } from '../../../engine/registry.mjs';
import { sampleGraph } from '../../../engine/graph/sample.mjs';
import { sample } from '../../../engine/time/track.mjs';
import { localMatrix } from '../../../engine/page/bounds.mjs';
import { auditFrame } from '../../../engine/review/frame.mjs';
import { safeRectFor } from '../../../scripts/v2/review.mjs';
import { resolveAnchor } from '../../../engine/script/anchors.mjs';
import { showsWordsOf } from '../../../engine/captions/index.mjs';
import { prepareFilm } from '../../../scripts/v2/prepare/index.mjs';
import { expandIn, filmOf, filmFor, canvasOf, platformOf, modeOf, IMAGES } from './kinds.mjs';
import { multiply, apply, corners, pathBox } from './boxes.mjs';

export const TALL_SPAN = 0.7; // pattern 2: the content spans at least this share of the safe height...
export const TALL_GAP = 0.25; // ...with no empty band taller than this share of it
export const LANDED_BEFORE_END = 0.6; // pattern 6: every reveal lands this many seconds before the shot ends
const GROUND_SHARE = 0.9; // a path covering this share of the canvas is ground (a scrim, a plate), not content
const SAMPLE_STEP = 0.05; // s between the samples that look for a change after frame 0
const AUDIT_STEP = 0.5; // s between the frames the hero rule and the size floor judge
const EPS = 1e-6;
const REVEAL_TRACKS = Object.freeze(['opacity', 'draw', 'reveal']);
const MOTION_TRACKS = Object.freeze(['x', 'y', 'scale', 'scaleX', 'scaleY']);
const AUDIT_RULES = Object.freeze(['hero', 'sizes']);

// ---- boxes ----

function boxOfPoints(points) {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
}

// A sampled node's own box in its local space: a text's words (scaled by their tracks), a path's coordinate pairs
// (half a stroke wider), an image's rectangle; null for a group or a field.
function ownBox(n) {
  if (n.type === 'image') return [0, 0, n.props.w, n.props.h];
  if (n.type === 'path' && typeof n.props.d === 'string' && /\d/.test(n.props.d)) {
    const [x, y, w, h] = pathBox(n.props.d);
    const grow = n.props.stroke ? (n.props.strokeWidth ?? 1) / 2 : 0;
    return [x - grow, y - grow, w + 2 * grow, h + 2 * grow];
  }
  if (n.type !== 'text' || !n.props.layout?.lines?.length) return null;
  const { layout } = n.props;
  const ascent = layout.lines[0].y, descent = layout.height - layout.lines.at(-1).y;
  const boxes = layout.lines.flatMap((line) => line.words.map((word) => {
    const t = n.words?.[word.index] ?? { x: 0, y: 0, scale: 1 };
    const half = (word.width / 2) * Math.abs(t.scale ?? 1);
    const centre = line.x + word.x + word.width / 2 + (t.x ?? 0);
    return [centre - half, line.y + (t.y ?? 0) - ascent, 2 * half, ascent + descent];
  }));
  return boxes.length ? boxOfPoints(boxes.flatMap(corners)) : null;
}

const isCaption = (n) => n.props?.caption !== undefined;
const isField = (n) => n.type === 'field';

/** Every drawn leaf of a sampled tree on screen: { node, box (canvas px), opacity (accumulated), scale, parent }. */
export function drawnLeaves(sampled, parent = [1, 0, 0, 1, 0, 0], alpha = 1, scale = 1, up = null) {
  return sampled.flatMap((n) => {
    const m = multiply(parent, localMatrix(n));
    const a = alpha * (n.opacity ?? 1);
    const s = scale * (n.scale ?? 1) * Math.sqrt((n.scaleX ?? 1) * (n.scaleY ?? 1));
    if (a <= 0 || isCaption(n) || isField(n)) return [];
    const own = ownBox(n);
    const mine = own ? [{ node: n, box: boxOfPoints(corners(own).map((p) => apply(m, p))), opacity: a, scale: s, parent: up }] : [];
    return [...mine, ...drawnLeaves(n.children, m, a, s, n)];
  });
}

// Content: drawn leaves that are not ground (a path covering most of the canvas).
const contentOf = (leaves, canvas) => leaves.filter((l) => !(l.node.type === 'path' && l.box[2] * l.box[3] >= GROUND_SHARE * canvas.w * canvas.h));

const allNodes = (nodes) => nodes.flatMap((n) => [n, ...allNodes(n.children)]);

// ---- 1. no stretched fit-to-width stack ----

/** Pattern 1: no text scaled on one axis, and within a block of one-line texts (siblings in one group, one role) every
 *  line has one size except a line marked props.emphasised. -> violations. */
export function stretchViolations({ nodes }) {
  const out = [];
  for (const n of allNodes(nodes)) {
    const sx = n.tracks.scaleX ?? null, sy = n.tracks.scaleY ?? null;
    const uneven = (n.props.scaleX ?? 1) !== (n.props.scaleY ?? 1) || sx !== null || sy !== null;
    if (uneven && allNodes([n]).some((d) => d.type === 'text')) out.push(`${n.id}: text scaled on one axis`);
    const lines = n.children.filter((c) => c.type === 'text' && c.props.layout?.lines?.length === 1 && c.props.emphasised !== true);
    const byRole = Map.groupBy(lines, (c) => c.props.role ?? 'body');
    for (const [role, block] of byRole) {
      const sizes = new Set(block.map((c) => c.props.layout.size.toFixed(3)));
      if (block.length > 1 && sizes.size > 1) out.push(`${n.id}: a block of ${role} lines set at ${sizes.size} sizes`);
    }
  }
  return out;
}

// ---- 2. no empty lower half on a tall frame ----

// The largest empty band (px) between the top and bottom of the boxes' vertical span.
function largestGap(boxes, top, bottom) {
  const spans = boxes.map((b) => [Math.max(top, b[1]), Math.min(bottom, b[1] + b[3])]).filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  let reach = top, gap = 0;
  for (const [a, b] of spans) {
    gap = Math.max(gap, a - reach);
    reach = Math.max(reach, b);
  }
  return Math.max(gap, bottom - reach);
}

/** Pattern 2: at the last frame the content spans >= 70% of the safe height [top, bottom] and leaves no empty band
 *  taller than 25% of it. Only for a tall canvas. -> violations. */
export function tallViolations({ nodes, duration, canvas, safe }) {
  if (canvas.h <= canvas.w) return [];
  const boxes = contentOf(drawnLeaves(sampleGraph(nodes, duration)), canvas).map((l) => l.box);
  const height = safe.bottom - safe.top;
  if (boxes.length === 0) return ['nothing drawn at the last frame'];
  const top = Math.max(safe.top, Math.min(...boxes.map((b) => b[1])));
  const bottom = Math.min(safe.bottom, Math.max(...boxes.map((b) => b[1] + b[3])));
  const out = [];
  if (bottom - top < TALL_SPAN * height - EPS) out.push(`the content spans ${((100 * (bottom - top)) / height).toFixed(0)}% of the safe height (at least ${TALL_SPAN * 100}%)`);
  const gap = largestGap(boxes, top, bottom);
  if (gap > TALL_GAP * height + EPS) out.push(`an empty band of ${((100 * gap) / height).toFixed(0)}% of the safe height inside the content (at most ${TALL_GAP * 100}%)`);
  return out;
}

// ---- 3. no exemption from the 3x hero rule ----

// The sampled tree as a snapshot (window.__snapshot's shape): every node with a canvas bbox, texts with their layout.
function snapshotOf(sampled, parent = [1, 0, 0, 1, 0, 0]) {
  return sampled.map((n) => {
    const m = multiply(parent, localMatrix(n));
    const children = snapshotOf(n.children, m);
    const own = ownBox(n);
    const boxes = [...(own ? [boxOfPoints(corners(own).map((p) => apply(m, p)))] : []), ...children.map((c) => c.bbox)];
    const bbox = boxes.length ? boxOfPoints(boxes.flatMap(corners)) : [m[4], m[5], 0, 0];
    return { ...n, children, bbox, spread: 0, ...(n.type === 'text' ? { layout: n.props.layout } : {}) };
  });
}

// A tag text is a real tag device's (its group holds a `.plate`); an affix is a numeral's unit (`.unit`).
function roleViolations(nodes) {
  const out = [];
  const walk = (list, parent) => list.forEach((n) => {
    if (n.type === 'text' && n.props.furniture === true) out.push(`${n.id}: sets props.furniture`);
    if (n.type === 'text' && n.props.role === 'tag' && !parent?.children.some((c) => c.id.endsWith('.plate'))) out.push(`${n.id}: role tag outside a tag device`);
    if (n.type === 'text' && n.props.role === 'affix' && !n.id.endsWith('.unit')) out.push(`${n.id}: role affix on a text that is not a numeral's unit`);
    walk(n.children, n);
  });
  walk(nodes, null);
  return out;
}

const timesOf = (duration, step) => [...Array.from({ length: Math.floor(duration / step) + 1 }, (_, i) => i * step), duration];

/** Pattern 3: no furniture or borrowed role, and the frame review's hero and sizes rules on frames every 0.5 s. */
export function heroViolations({ nodes, duration, canvas, look, mode }) {
  const ctx = { look, canvas, mode, shotId: 'bar', shotIndex: 0, safe: safeRectFor(canvas, look) };
  const audits = timesOf(duration, AUDIT_STEP).flatMap((t) => auditFrame(snapshotOf(sampleGraph(nodes, t)), { ...ctx, t })
    .filter((f) => AUDIT_RULES.includes(f.rule)).map((f) => `at ${t.toFixed(2)} s: ${f.rule}: ${f.message}`));
  return [...roleViolations(nodes), ...new Set(audits)];
}

// ---- 4. readable at phone size ----

/** Pattern 4: every text whose nodeField is one of the shot's fields is at least `floor` units on every frame it shows. */
export function readableViolations({ nodes, duration, unit, floor, nodeField }) {
  const out = new Set();
  for (const t of timesOf(duration, AUDIT_STEP)) {
    for (const leaf of drawnLeaves(sampleGraph(nodes, t))) {
      if (leaf.node.type !== 'text' || typeof nodeField(leaf.node.id) !== 'string') continue;
      const size = (leaf.node.props.layout.size * leaf.scale) / unit;
      if (size < floor - EPS) out.add(`${leaf.node.id} (${nodeField(leaf.node.id)}) is ${size.toFixed(1)} units; the floor is ${floor}`);
    }
  }
  return [...out];
}

// ---- 5. no silently dropped field ----

const coversField = (path, field) => path === field || path.startsWith(`${field}.`) || path.startsWith(`${field}[`);

/** Pattern 5: each of `fields` is shown by a node (nodeField), named by a finding's path, or named in a node's
 *  props.dropped (the frame review's "left out its ..." finding, engine/review/frame.mjs). */
export function droppedViolations({ nodes, fields, nodeField, findings }) {
  const shown = new Set(allNodes(nodes).map((n) => nodeField(n.id)).filter((f) => typeof f === 'string'));
  const dropped = new Set(allNodes(nodes).flatMap((n) => (Array.isArray(n.props.dropped) ? n.props.dropped : [])));
  return fields.filter((f) => !shown.has(f) && !dropped.has(f) && !findings.some((x) => coversField(String(x.path), f)))
    .map((f) => `field "${f}" is neither drawn nor named by a finding`);
}

// ---- 6. frame 0 whole, and the shot is not a still ----

// Is v strictly between a and b?
const between = (v, a, b) => typeof v === 'number' && v > Math.min(a, b) + EPS && v < Math.max(a, b) - EPS;

// The nodes on screen at frame 0 (their accumulated opacity above 0), with the tracks that make them mid-entrance.
function midEntrances(nodes, alpha = 1) {
  return nodes.flatMap((n) => {
    const at0 = (name) => sample(n.tracks[name], 0, n.step);
    const opacity = n.tracks.opacity ? at0('opacity') : (n.props.opacity ?? 1);
    const a = alpha * opacity;
    if (a <= 0) return [];
    const mine = [];
    // an opacity track part-way between its least and greatest value is an entrance under way; a static opacity (a
    // shadow's alpha) is the design
    const values = n.tracks.opacity?.points.map((p) => p.v) ?? [];
    if (values.length > 0 && between(opacity, Math.min(...values), Math.max(...values))) mine.push(`${n.id}: opacity ${opacity.toFixed(2)} at frame 0`);
    for (const name of MOTION_TRACKS.filter((k) => n.tracks[k])) {
      const { points } = n.tracks[name];
      if (between(at0(name), points[0].v, points.at(-1).v)) mine.push(`${n.id}: ${name} part-way at frame 0`);
    }
    n.wordTracks.forEach((w, i) => { if (w.opacity && between(sample(w.opacity, 0, n.step), 0, 1)) mine.push(`${n.id} word ${i}: opacity part-way at frame 0`); });
    return [...mine, ...midEntrances(n.children, a)];
  });
}

// When a track last changes: the earliest time from which it holds its final value.
function settlesAt(tr, duration, step) {
  const end = sample(tr, duration, step);
  const keys = tr.points.filter((p) => p.t <= duration);
  let t = 0;
  for (let i = keys.length - 1; i >= 0; i--) {
    if (sample(tr, keys[i].t, step) !== end || (i > 0 && sample(tr, keys[i - 1].t, step) !== end)) { t = keys[i].t; break; }
  }
  return { end, t };
}

// Does any node's own track (or word track) change after frame 0?
function changesAfterZero(nodes, duration) {
  return allNodes(nodes).some((n) => [...Object.values(n.tracks), ...n.wordTracks.flatMap((w) => Object.values(w))]
    .some((tr) => timesOf(duration, SAMPLE_STEP).some((t) => JSON.stringify(sample(tr, t, n.step)) !== JSON.stringify(sample(tr, 0, n.step)))));
}

// The reveal tracks (opacity, draw, reveal, word opacity) that end shown but land later than LANDED_BEFORE_END before the end.
function lateReveals(nodes, duration) {
  return allNodes(nodes).flatMap((n) => {
    const tracks = [...REVEAL_TRACKS.filter((k) => n.tracks[k]).map((k) => [k, n.tracks[k]]), ...n.wordTracks.flatMap((w, i) => (w.opacity ? [[`word ${i} opacity`, w.opacity]] : []))];
    return tracks.flatMap(([name, tr]) => {
      const { end, t } = settlesAt(tr, duration, n.step);
      return end > 0 && t > duration - LANDED_BEFORE_END + EPS ? [`${n.id}: ${name} lands at ${t.toFixed(2)} s, under ${LANDED_BEFORE_END} s before the end (${duration.toFixed(2)} s)`] : [];
    });
  });
}

/** Pattern 6: nothing part-way through an entrance at frame 0, frame 0 not empty, something changes after frame 0
 *  through a node's own track (not the camera), and every reveal lands 0.6 s before the end. */
export function frameZeroViolations({ nodes, duration, canvas }) {
  const out = midEntrances(nodes);
  if (contentOf(drawnLeaves(sampleGraph(nodes, 0)), canvas).length === 0) out.push('frame 0 is empty');
  if (!changesAfterZero(nodes, duration)) out.push('nothing changes after frame 0: the shot is a still');
  return [...out, ...lateReveals(nodes, duration)];
}

// ---- the shot as expanded ----

const safeOf = (canvas, look, mode) => {
  if (mode === 'viral' && canvas.h > canvas.w) {
    const zone = platformOf(canvas);
    return { top: zone.top, bottom: canvas.h - zone.bottom };
  }
  const unit = Math.min(canvas.w, canvas.h) / 1080;
  return { top: look.grid.margin * unit, bottom: canvas.h - look.grid.margin * unit };
};

// The schema fields a shot sets, less the ones the kind says steer how others are drawn (kind.steeringFields) and `hero`.
const fieldsOf = (kind, shot) => Object.keys(kind.schema?.properties ?? {})
  .filter((f) => shot[f] !== undefined && f !== 'hero' && !(kind.steeringFields ?? []).includes(f));

// The kind's own advice on the shot (review) and its rules (validate), as findings with paths.
function kindFindings(kind, shot, { look, timing, canvas }) {
  const at = (ref) => resolveAnchor(ref, timing);
  const asset = (src) => IMAGES.get(src); // as the page reports the loaded pictures (scripts/v2/review.mjs)
  const review = typeof kind.review === 'function' ? kind.review(shot, { look, timing, at, canvas, asset, viralInsets: platformOf(canvas) }) : [];
  const rules = typeof kind.validate === 'function' ? kind.validate(shot, { look, at }) : [];
  return [...review, ...rules];
}

// The film's prepared data (scripts/v2/prepare) when `prepare`, for a kind that declares `prepared: true`.
const preparedFor = (film, prepare) => (prepare ? prepareFilm(film, { filmDir: '.' }).prepared : {});

/** The input every check takes, for `shot` of `kindName` in `look` at `format` (`prepare`: run the prepare step). */
export function barInput(kindName, shot, { look, format, prepare = false }) {
  const kind = registries.kinds.get(kindName);
  const film = filmOf([shot], look, format);
  const out = expandIn(film, 0, { prepared: preparedFor(film, prepare) });
  const lookDef = registries.looks.get(look);
  const canvas = canvasOf(format), unit = Math.min(canvas.w, canvas.h) / 1080;
  const tall = canvas.h > canvas.w;
  return {
    nodes: out.nodes, duration: out.timing.duration, canvas, unit, look: lookDef, mode: modeOf(look),
    safe: safeOf(canvas, lookDef, modeOf(look)), floor: lookDef.scale[tall ? 1 : 0],
    nodeField: (id) => (typeof kind.nodeField === 'function' ? kind.nodeField(shot, id) : undefined),
    fields: fieldsOf(kind, shot), findings: kindFindings(kind, shot, { look: lookDef, timing: out.timing, canvas }),
  };
}

// With captions on, the room above the caption zone: the frame's captions as buildFilm draws them.
function captionedSafe(shot, look, format, safe, prepare) {
  const built = filmFor([shot], look, format, { captions: true }, { prepared: preparedFor(filmOf([shot], look, format), prepare) });
  const zones = allNodes(built.sampleShot(0, built.duration)).filter(isCaption).map((n) => n.props.caption.zone).filter(Array.isArray);
  return zones.length === 0 ? safe : { ...safe, bottom: Math.min(safe.bottom, ...zones.map((z) => z[1])) };
}

/**
 * Runs the six checks on `shot` of `kindName` in `look` at `format`; throws one AssertionError listing every violation.
 * `floor` (units) replaces pattern 4's floor (the code kind's own arithmetic). A narrated shot of a kind that does not show
 * its words is judged for pattern 2 with captions off and on.
 */
export function assertBar(kindName, shot, { look, format, floor, prepare = false } = {}) {
  const input = barInput(kindName, shot, { look, format, prepare });
  const kind = registries.kinds.get(kindName);
  const captioned = typeof shot.say === 'string' && !showsWordsOf(kind, shot) && input.canvas.h > input.canvas.w;
  const violations = [
    ...stretchViolations(input).map((v) => `1 stretch: ${v}`),
    ...tallViolations(input).map((v) => `2 tall: ${v}`),
    ...(captioned ? tallViolations({ ...input, safe: captionedSafe(shot, look, format, input.safe, prepare) }).map((v) => `2 tall (captions on): ${v}`) : []),
    ...heroViolations(input).map((v) => `3 hero: ${v}`),
    ...readableViolations({ ...input, floor: floor ?? input.floor }).map((v) => `4 readable: ${v}`),
    ...droppedViolations(input).map((v) => `5 dropped: ${v}`),
    ...frameZeroViolations(input).map((v) => `6 frame 0: ${v}`),
  ];
  assert.deepEqual(violations, [], `${kindName} "${shot.id}" in ${look} at ${format} breaks the bar`);
}

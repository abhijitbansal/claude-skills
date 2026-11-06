// Browser-safe and DOM-free: the stroke plan of a hand-drawn scene. `planScene` turns an expanded scene (blocks already
// groups) into strokes, polylines in canvas px with a start and an end time, plus a box and a time window for every element.
// Validation, the audits and the renderer all read it, so it runs identically in Node and the page. Icons come in through
// `ctx.icons` (the page and Node load them differently); text widths come from Caveat's metrics, with no kerning.
import metrics from './caveat-metrics.mjs';
import { PALETTE, SCRIBBLE_FILL } from './style.mjs';
import { childrenOf, isGroup } from '../groups.mjs';
import { unit, isPoint, hashSeed, makeRng, makeStroke, wobble, bowedLine, boxOutline, ellipseOutline, boxHatch, ellipseHatch, arrowBarbs } from './geometry.mjs';
import { schedule, assignWindows, naturalSeconds, HAND_EXIT } from './timing.mjs';

export { pointAt } from './geometry.mjs';

const DEFAULT_SEED = 1;
const DEFAULT_SHAPE_SIZE = 100; // a shape without width or height, as on a standard shape
const DEFAULT_FONT_SIZE = 72; // px at 1080; a standard text defaults to 48, a handwriting reads smaller for its size
const MAX_WIDTH_SHARE = 0.8; // of the canvas width: a text without maxWidth wraps here
const BOX_RADIUS = 14; // px at 1080 on a box's corners (an element's own radius wins)
const FIT_EPSILON = 1e-9;
const NESTED_DRAW_AT = 'drawAt on an element inside a group does not apply in a scene with narration (the group draws during one stretch of the narration and its parts share it); put drawAt on the group';

// The spike's values, px at 1080 (multiplied by the canvas's unit when used). wobble: amp, wave, step (step defaults to 7).
const BOX = { amp: 2.6, wave: 110, width: 5.5, over: 16 };
const ARROW = { amp: 1.3, wave: 60, width: 5.5, head: 30, spread: 2.55, bow: 26, bowShare: 0.17, barb: { amp: 0.8, wave: 30 } };
const ICON = { amp: 1.1, wave: 45, step: 5, width: 4.5 };
const FILL = { gap: 34, width: 20, opacity: 0.17, amp: 3, wave: 60, step: 12 };
// Writing: the text shows through a mask the pen follows, zig-zagging over each glyph. Shares of the font size.
const WRITE = { width: 0.42, top: 0.62, bottom: 0.14, sweeps: 3 };

// A sketch scene has one palette: the theme tokens of a standard scene (defaults.mjs COLOR_TOKENS, repeated here because that
// file imports the blocks; a test fails if the lists drift) are accent, the board (surface) or ink. Anything else is a CSS colour.
export const THEME_TOKENS = Object.freeze(['surface', 'line', 'accent', 'accentSoft', 'good', 'bad', 'warn', 'text', 'text2', 'text3', 'cat1', 'cat2', 'cat3', 'cat4', 'cat5', 'cat6']);
export function colourOf(value) {
  if (value === undefined) return PALETTE.ink;
  if (value === 'accent') return PALETTE.accent;
  if (value === 'surface') return PALETTE.board;
  return THEME_TOKENS.includes(value) ? PALETTE.ink : value;
}
const { unitsPerEm, ascent, descent, advance } = metrics;
const LINE_EM = (ascent - descent) / unitsPerEm; // a line is as tall as the font's ascent plus its descent below the baseline (descent is negative)
const widthOf = (str, fs, missing) => {
  let units = 0;
  for (const ch of str) {
    if (Object.hasOwn(advance, ch)) units += advance[ch];
    else { missing.add(ch); units += advance[' ']; }
  }
  return (units * fs) / unitsPerEm;
};

// ---- text ----------------------------------------------------------------------------------------------------------------

// The lines of `par` at font size `fs`, wrapped at spaces and tabs (not at a no-break space) so no line is wider than
// `maxWidth` unless one word is.
function wrap(par, fs, maxWidth, missing) {
  const space = widthOf(' ', fs, missing);
  const lines = [];
  let line = '';
  let used = 0;
  for (const word of par.split(/[ \t]+/).filter(Boolean)) {
    const w = widthOf(word, fs, missing);
    if (line === '') { line = word; used = w; }
    else if (used + space + w <= maxWidth + FIT_EPSILON) { line += ` ${word}`; used += space + w; }
    else { lines.push(line); line = word; used = w; }
  }
  lines.push(line);
  return lines;
}

// The pen's path for one line: three sweeps up and down over each glyph, joined end to end (the spike's writeFont).
function penPath(glyphs, baseline, fontSize) {
  const [top, bottom] = [baseline - WRITE.top * fontSize, baseline + WRITE.bottom * fontSize];
  const points = [];
  for (const g of glyphs) {
    for (let j = 0; j < WRITE.sweeps; j++) {
      const x = g.x + (g.width * (j + 0.5)) / WRITE.sweeps;
      points.push([x, j % 2 ? bottom : top], [x, j % 2 ? top : bottom]);
    }
  }
  return points;
}

function planText(el, at, style, run, path) {
  const fs = el.fontSize ?? DEFAULT_FONT_SIZE * run.u;
  const maxWidth = el.maxWidth ?? MAX_WIDTH_SHARE * run.size[0];
  const missing = new Set();
  const lines = String(el.text ?? '').normalize('NFC').split('\n').flatMap((par) => wrap(par, fs, maxWidth, missing));
  const widths = lines.map((line) => widthOf(line, fs, missing));
  const width = Math.max(0, ...widths);
  const height = lines.length * fs * LINE_EM;
  const left = el.anchor === 'left' ? at[0] : el.anchor === 'right' ? at[0] - width : at[0] - width / 2;
  const box = { x: left, y: at[1] - height / 2, width, height };
  if (widths.some((w) => w > maxWidth + FIT_EPSILON)) run.problems.push({ path, message: `a word is wider than maxWidth ${maxWidth}; use a smaller fontSize or a larger maxWidth` });
  if (missing.size) run.problems.push({ path, message: `${[...missing].map((ch) => JSON.stringify(ch)).join(', ')} not in the handwriting font` });
  const slack = { left: 0, center: 0.5, right: 1 }[el.align ?? 'center'];
  const toBaseline = ((ascent + descent) / 2 / unitsPerEm) * fs; // the font's middle sits on the line's middle
  const glyphs = [];
  const drafts = [];
  lines.forEach((line, i) => {
    const baseline = box.y + (i + 0.5) * fs * LINE_EM + toBaseline;
    let pen = box.x + (width - widths[i]) * slack;
    const row = [];
    for (const ch of line) {
      const w = widthOf(ch, fs, new Set());
      if (!/\s/.test(ch) && !missing.has(ch)) row.push({ char: ch, x: pen, y: baseline, width: w });
      pen += w;
    }
    glyphs.push(...row.map(({ char, x, y }) => ({ char, x, y })));
    if (row.length) drafts.push(makeStroke(penPath(row, baseline, fs), { path, kind: 'write', chars: [...line].length, color: colourOf(el.color), width: WRITE.width * fs, opacity: style.opacity, layer: 'ink' }));
  });
  return { box, drafts, glyphs, fontSize: fs };
}

// ---- shapes and icons ---------------------------------------------------------------------------------------------------

// A stroke before it is timed. `speed` says how fast the pencil moves (timing.mjs); a writing stroke has `chars` instead.
const inkLine = (points, path, width, color, opacity, speed = 'line') => makeStroke(points, { path, kind: 'line', speed, color, width, opacity, layer: 'ink' });

// A line's two ends in canvas px: from x, y to `to` (in the element's own frame, so `origin` + to), else a horizontal line of
// `width` centred on x, y. null when `to` is there but is not a point.
function lineEnds(el, at, origin) {
  if (el.to !== undefined) return isPoint(el.to) ? [at, [origin[0] + el.to.x, origin[1] + el.to.y]] : null;
  const half = (el.width ?? DEFAULT_SHAPE_SIZE) / 2;
  return [[at[0] - half, at[1]], [at[0] + half, at[1]]];
}

const boundsOf = (drafts, pad) => {
  const pts = drafts.flatMap((d) => d.points);
  const [xs, ys] = [pts.map((p) => p[0]), pts.map((p) => p[1])];
  const [x0, y0] = [Math.min(...xs) - pad, Math.min(...ys) - pad];
  return { x: x0, y: y0, width: Math.max(...xs) + pad - x0, height: Math.max(...ys) + pad - y0 };
};

function planLine(el, at, style, run, path, rng) {
  const { u } = run;
  const stroke = el.strokeWidth ?? ARROW.width * u;
  const ends = lineEnds(el, at, style.origin);
  if (!ends) {
    run.problems.push({ path, message: 'to must be a point, { "x": number, "y": number }' });
    return { box: { x: at[0], y: at[1], width: 0, height: 0 }, drafts: [] };
  }
  const [from, to] = ends;
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const colour = colourOf(el.stroke);
  const arrow = el.arrow === 'end';
  const bow = Number.isFinite(el.bow) ? el.bow * u : arrow ? Math.min(ARROW.bow * u, ARROW.bowShare * length) : 0;
  const points = wobble(bow ? bowedLine(from, to, bow) : [from, to], rng, { amp: ARROW.amp, wave: ARROW.wave, u });
  const drafts = [inkLine(points, path, stroke, colour, style.opacity)];
  if (arrow) {
    const tip = points.at(-1);
    const behind = points.at(-Math.min(5, points.length));
    for (const barb of arrowBarbs(tip, behind, ARROW.head * u, ARROW.spread)) {
      drafts.push(inkLine(wobble(barb, rng, { ...ARROW.barb, u }), path, stroke, colour, style.opacity, 'head'));
    }
  }
  return { box: boundsOf(drafts, stroke / 2), drafts };
}

function planBox(el, at, style, run, path, rng) {
  const { u } = run;
  const [w, h] = [el.width ?? DEFAULT_SHAPE_SIZE, el.height ?? DEFAULT_SHAPE_SIZE];
  const round = el.shape === 'ellipse';
  const drafts = [];
  if (el.fill === SCRIBBLE_FILL) {
    const hatch = round ? ellipseHatch(at[0], at[1], w / 2, h / 2, FILL.gap * u, u) : boxHatch(at[0], at[1], w, h, FILL.gap * u, u);
    const fillRng = makeRng(hashSeed(run.seed, `${el.id}#fill`)); // its own stream: a fill never moves the outline's wobble
    if (hatch.length >= 2) drafts.push(makeStroke(wobble(hatch, fillRng, { amp: FILL.amp, wave: FILL.wave, step: FILL.step, u }), { path, kind: 'fill', speed: 'fill', color: PALETTE.accent, width: FILL.width * u, opacity: FILL.opacity * style.opacity, layer: 'under' }));
  }
  const stroke = el.strokeWidth ?? BOX.width * u;
  if (stroke > 0) {
    const outline = round ? ellipseOutline(at[0], at[1], w / 2, h / 2, BOX.over * u) : boxOutline(at[0], at[1], w, h, el.radius ?? BOX_RADIUS * u, BOX.over * u);
    drafts.push(inkLine(wobble(outline, rng, { amp: BOX.amp, wave: BOX.wave, u }), path, stroke, colourOf(el.stroke), style.opacity));
  }
  return { box: { x: at[0] - w / 2, y: at[1] - h / 2, width: w, height: h }, drafts };
}

function planIcon(el, at, style, run, path, rng) {
  const { u } = run;
  const lines = run.icons && Object.hasOwn(run.icons, el.name) ? run.icons[el.name] : null;
  const box = { x: at[0] - el.size / 2, y: at[1] - el.size / 2, width: el.size, height: el.size };
  if (!lines) {
    run.problems.push({ path, message: `unknown icon ${JSON.stringify(el.name)}` });
    return { box, drafts: [] };
  }
  const k = el.size / 24; // Lucide's icons are drawn in a 24-unit box
  const drafts = lines.map((line) => {
    const base = line.map(([x, y]) => [box.x + x * k, box.y + y * k]);
    return inkLine(wobble(base, rng, { amp: ICON.amp, wave: ICON.wave, step: ICON.step, u }), path, ICON.width * u, colourOf(el.color), style.opacity, 'icon');
  });
  return { box, drafts };
}

const SHAPES = { rect: planBox, ellipse: planBox, line: planLine };
const LEAVES = {
  text: planText,
  shape: (el, at, style, run, path, rng) => (SHAPES[el.shape] ?? planBox)(el, at, style, run, path, rng),
  icon: planIcon,
};

// ---- the scene ----------------------------------------------------------------------------------------------------------

const union = (boxes, fallback) => {
  if (!boxes.length) return { x: fallback[0], y: fallback[1], width: 0, height: 0 };
  const [x0, y0] = [Math.min(...boxes.map((b) => b.x)), Math.min(...boxes.map((b) => b.y))];
  const [x1, y1] = [Math.max(...boxes.map((b) => b.x + b.width)), Math.max(...boxes.map((b) => b.y + b.height))];
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
};

// The tree of `el` with its drafts and boxes in canvas coordinates. `parent`: { at, opacity, drawAt } of the group around it.
function collect(el, path, parent, run, leaves) {
  const at = [parent.at[0] + (el.x ?? 0), parent.at[1] + (el.y ?? 0)];
  const style = { opacity: parent.opacity * (el.opacity ?? 1), origin: parent.at }; // origin: the frame a line's `to` is in
  const drawAt = typeof el.drawAt === 'number' ? Math.max(el.drawAt, parent.drawAt ?? 0) : parent.drawAt; // a sentence pin ({ sentence }) is read from the top element (planWindows)
  if (run.voiced && !parent.top && el.drawAt !== undefined) run.problems.push({ path, message: NESTED_DRAW_AT });
  const node = { path, children: [], drafts: [], box: null, extra: {} };
  if (isGroup(el)) {
    const down = { at, opacity: style.opacity, drawAt };
    node.children = childrenOf(el).map((child, i) => collect(child, `${path}.children[${i}]`, down, run, leaves)).filter(Boolean);
    node.box = union(node.children.map((c) => c.box), at);
    return node;
  }
  const plan = LEAVES[el.type];
  if (!plan) {
    run.problems.push({ path, message: `${el.type} is not drawn in a sketch scene` });
    return null;
  }
  const { drafts: planned, box, ...extra } = plan(el, at, style, run, path, makeRng(hashSeed(run.seed, el.id)));
  const drafts = planned.filter((d) => d.points.length > 1 && d.points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));
  if (drafts.length < planned.length) run.problems.push({ path, message: `a ${el.type} whose size or place is not a number cannot be drawn` });
  Object.assign(node, { drafts, box, extra });
  leaves.push({ node, drawAt });
  return node;
}

// Timed strokes of `node` in document order, and a plan for it and each element below it in `elements`.
function finish(node, state, strokes, elements) {
  const first = strokes.length;
  node.drafts.forEach((d, i) => {
    const { t0, t1 } = node.times[i];
    strokes.push({ path: d.path, kind: d.kind, points: d.points, lengths: d.lengths, total: d.total, color: d.color, width: d.width, opacity: d.opacity, t0, t1, layer: d.layer });
    state.last = t1;
  });
  elements.set(node.path, null); // reserves the key's place, so a group comes before the elements below it
  node.children.forEach((child) => finish(child, state, strokes, elements));
  const own = strokes.slice(first);
  const [t0, t1] = own.length ? [own[0].t0, Math.max(...own.map((s) => s.t1))] : [state.last, state.last];
  elements.set(node.path, { box: node.box, t0, t1, ...node.extra });
}

// The items a scene with narration schedules: one per top-level element (a group or a block draws all its parts in its one
// window), each with the sentence window assignWindows gives it. `run`: { u, pace } as naturalSeconds reads them.
function planWindows(tops, narration, run) {
  const strokesOf = (top) => top.leaves.flatMap(({ node }) => node.drafts);
  const weighed = tops.map((top) => {
    const sentence = top.el.drawAt?.sentence;
    return { weight: strokesOf(top).reduce((sum, draft) => sum + naturalSeconds(draft, run), 0), sentence: Number.isInteger(sentence) ? sentence : undefined };
  });
  const windows = assignWindows(weighed, narration);
  return tops.map((top, i) => ({ drawAt: typeof top.el.drawAt === 'number' ? top.el.drawAt : undefined, slot: windows[i], strokes: strokesOf(top) }));
}

// What the schedule could not fit in a sentence window, as findings at the elements. A voiced scene that cannot fit its
// drawing still renders and is reported by check.mjs, so these are not `problems` (which validation refuses and the page throws).
function overrunsOf(tooShort, tops) {
  return tooShort.map(({ item, needed, available }) => {
    const { el, node } = tops[item];
    const seconds = Math.ceil((needed - FIT_EPSILON) * 10) / 10;
    const lasts = Math.round(available * 100) / 100;
    return { path: node.path, message: `${el.type} "${el.id}" cannot be drawn during the narration it is matched to, even at twice the pace: that lasts ${lasts}s and the drawing needs ${seconds}s; use a longer sentence, share the sentences differently, or draw less` };
  });
}

/**
 * The stroke plan of `scene` (an expanded scene: blocks are groups). `ctx`: { size: [w, h], seed (the film's sketch.seed),
 * pace (sketch.pace), icons ({ name: polylines in a 24-unit box }), sceneIndex (paths read scenes[i].elements[k]),
 * startAfter (seconds a transition reserves before anything is drawn), erase (that transition is the erase sweep) }; planContext
 * (plan-context.mjs) makes it from a spec. A scene with `narration` ([{ start, end }] in scene
 * seconds, set from the voice sidecar by scripts/lib/sketch-voice.mjs) draws each top-level element during its sentences, none
 * of them before startAfter plus the hand's lead.
 * -> { size, unit, strokes, elements: Map<path, { box (top left, canvas px), t0, t1, glyphs?, fontSize? }>, drawEnd, moves,
 * needs, problems, overruns, sweep }. `unit` is the canvas's px per px at 1080. `moves` is the hand's journey (timing.mjs schedule).
 * `sweep` is the seconds the hand sweeps across the board at the start of the scene (an erase), else 0.
 * `needs` is the scene length the drawing takes, the hand's way out included (startAfter alone when there is nothing to
 * draw). `overruns` are the elements whose sentences are too short for them at twice pace ([{ path, message }]; none
 * without narration).
 */
export function planScene(scene, ctx) {
  if (!Array.isArray(ctx?.size)) throw new TypeError('planScene needs ctx.size, [width, height]');
  const { size, seed = DEFAULT_SEED, pace = 1, icons, sceneIndex, startAfter = 0, erase = false } = ctx;
  const voiced = Array.isArray(scene.narration) && scene.narration.length > 0;
  const run = { size, seed, icons, pace, voiced, u: unit(size), problems: [] };
  const prefix = Number.isInteger(sceneIndex) ? `scenes[${sceneIndex}].` : '';
  const root = { at: [0, 0], opacity: 1, drawAt: undefined, top: true };
  const tops = [];
  (scene.elements ?? []).forEach((el, i) => {
    const leaves = [];
    const node = collect(el, `${prefix}elements[${i}]`, root, run, leaves);
    if (node) tops.push({ el, node, leaves });
  });
  const leaves = tops.flatMap((top) => top.leaves);
  const items = voiced ? planWindows(tops, scene.narration, run) : leaves.map(({ node, drawAt }) => ({ drawAt, strokes: node.drafts }));
  const { times, drawEnd, moves, tooShort } = schedule(items, { size, u: run.u, pace, startAfter });
  if (voiced) tops.forEach((top, i) => takeTimes(top.leaves, times[i]));
  else leaves.forEach(({ node }, i) => { node.times = times[i]; });
  const strokes = [];
  const elements = new Map();
  const state = { last: startAfter };
  tops.forEach(({ node }) => finish(node, state, strokes, elements));
  return { size, unit: run.u, strokes, elements, drawEnd, moves, needs: strokes.length ? drawEnd + HAND_EXIT : startAfter, problems: run.problems, overruns: overrunsOf(tooShort, tops), sweep: erase ? startAfter : 0 };
}

// The times of one item's strokes handed back to the leaves it was made of, in order.
function takeTimes(leaves, times) {
  let next = 0;
  for (const { node } of leaves) {
    node.times = times.slice(next, next + node.drafts.length);
    next += node.drafts.length;
  }
}

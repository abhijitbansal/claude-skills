// Browser-safe (no imports): how much a Lottie file asks lottie-web to build and redraw. A file can be tiny and still
// ask for a great deal: a repeater with 200,000 copies in 792 bytes blocks the page's main thread for minutes, and no
// timer in the page can fire while it does. lottie-guard.mjs runs these checks inside lottieProblems: countProblems on
// every object its walk visits, budgetProblems once the walk is done. Nothing here recurses.
//
//   a count on one shape item   repeater copies (rp.c), zig-zag ridges per segment (zz.r), star points (sr.pt) and
//                               gradient stops (gf/gs g.p) each drive a loop lottie-web runs, capped one by one. A keyed
//                               count is capped at the largest value it takes, which a bezier ease can carry far past
//                               both of its keys (easedMax solves for it)
//   a text document             at most MAX_TEXT_CHARACTERS characters (lottie-web runs out of stack on very long text)
//   the whole file              every layer and drawn shape item, with each repeater's copies multiplied in, each
//                               precomp counted once per layer that uses it, and the largest glyph counted once per
//                               character of the longest text of a layer that draws glyphs, capped together
//   precomp references          a layer's refId must name an asset, and no precomp may contain itself

export const MAX_REPEATER_COPIES = 1000;
export const MAX_ZIGZAG_RIDGES = 1000;
export const MAX_STAR_POINTS = 1000;
export const MAX_GRADIENT_STOPS = 256;
export const MAX_LOTTIE_ELEMENTS = 10000;
export const MAX_TEXT_CHARACTERS = 20000;

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (obj, key) => Object.hasOwn(obj, key);
const ownValue = (obj, key) => (isPlain(obj) && own(obj, key) ? obj[key] : undefined);
const join = (at, key) => (typeof key === 'number' ? `${at}[${key}]` : at ? `${at}.${key}` : key);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

// The counts capped on one shape item, by its `ty`: the key holding the count, the cap and the noun for the message.
const COUNTS = Object.freeze(Object.assign(Object.create(null), {
  rp: { key: 'c', max: MAX_REPEATER_COPIES, noun: 'repeater copies' },
  zz: { key: 'r', max: MAX_ZIGZAG_RIDGES, noun: 'zig-zag ridges' },
  sr: { key: 'pt', max: MAX_STAR_POINTS, noun: 'star points' },
}));
const GRADIENTS = new Set(['gf', 'gs']);
const NOT_DRAWN = new Set(['tr']); // a group's transform: not an element of its own
const TEXT_LAYER = 5;

// A property as lottie-web reads it: a slot (`sid`) merges its own `p` over it.
function resolved(prop, slots) {
  const sid = ownValue(prop, 'sid');
  const slot = typeof sid === 'string' && isPlain(slots) && own(slots, sid) ? ownValue(slots[sid], 'p') : undefined;
  return isPlain(slot) ? { ...prop, ...slot } : prop;
}

const first = (v) => (Array.isArray(v) ? v[0] : v);
const list = (v) => (Array.isArray(v) ? v : [v]);

// The extremes over t in [0, 1] of the cubic bezier ease's y, B(t) = 3(1-t)^2 t y1 + 3(1-t) t^2 y2 + t^3 (its ends are 0
// and 1). B'(t) / 3 = y1 + (2 y2 - 4 y1) t + (3 y1 - 3 y2 + 1) t^2: its roots inside (0, 1) are the only other candidates.
// lottie-web solves the ease's x for t inside [0, 1], so the value never leaves this range whatever the x control points.
function easeRange(y1, y2) {
  const B = (t) => 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t ** 2 * y2 + t ** 3;
  const a = 3 * y1 - 3 * y2 + 1;
  const b = 2 * y2 - 4 * y1;
  const c = y1;
  const roots = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) roots.push(-c / b);
  } else {
    const d = b * b - 4 * a * c;
    if (d >= 0) roots.push((-b + Math.sqrt(d)) / (2 * a), (-b - Math.sqrt(d)) / (2 * a));
  }
  const ys = [0, 1, ...roots.filter((t) => t > 0 && t < 1).map(B)];
  return [Math.min(...ys), Math.max(...ys)];
}

/**
 * The largest value an animatable number property takes (its first dimension): a static k or [k], or for keyframes
 * the largest over every segment, from its key to the next (or its own `e`) along its bezier ease, solved exactly. A hold
 * keyframe (h 1) jumps, so its ease is never used. NaN when any value or ease is not a finite number.
 */
export function easedMax(prop, slots) {
  const k = ownValue(resolved(prop, slots), 'k');
  if (!(Array.isArray(k) && k.some(isPlain))) return finite(first(k)) ? first(k) : NaN;
  let max = -Infinity;
  for (let i = 0; i < k.length; i++) {
    const kf = k[i];
    if (!isPlain(kf)) return NaN;
    const from = own(kf, 's') ? first(kf.s) : undefined;
    const to = own(kf, 'e') ? first(kf.e) : (isPlain(k[i + 1]) && own(k[i + 1], 's') ? first(k[i + 1].s) : undefined);
    if (from === undefined) continue; // the closing key of the old format carries only t
    if (!finite(from) || (to !== undefined && !finite(to))) return NaN;
    max = Math.max(max, from);
    if (to === undefined || ownValue(kf, 'h') === 1) continue;
    max = Math.max(max, to);
    const y1s = list(ownValue(ownValue(kf, 'o'), 'y') ?? 0);
    const y2s = list(ownValue(ownValue(kf, 'i'), 'y') ?? 1);
    for (const y1 of y1s) {
      for (const y2 of y2s) {
        if (!finite(y1) || !finite(y2)) return NaN;
        for (const y of easeRange(y1, y2)) max = Math.max(max, from + (to - from) * y);
      }
    }
  }
  return max === -Infinity ? NaN : max;
}

/**
 * The count caps of one object the guard's walk visits, at `at`: a shape item's count (rp, zz, sr), a gradient's stops
 * and a text document's length. Pushes onto `problems`; -> true when it pushed one.
 */
export function countProblems(value, at, slots, problems) {
  const before = problems.length;
  const ty = ownValue(value, 'ty');
  if (GRADIENTS.has(ty)) {
    const stops = ownValue(ownValue(value, 'g'), 'p');
    if (!finite(stops)) problems.push({ path: join(join(at, 'g'), 'p'), message: 'must be a number' });
    else if (stops > MAX_GRADIENT_STOPS) problems.push({ path: join(join(at, 'g'), 'p'), message: `${stops} gradient stops; at most ${MAX_GRADIENT_STOPS}` });
  }
  const count = typeof ty === 'string' ? COUNTS[ty] : undefined;
  if (count) {
    const max = easedMax(ownValue(value, count.key), slots);
    if (Number.isNaN(max)) problems.push({ path: join(at, count.key), message: 'must be a number' });
    else if (max > count.max) problems.push({ path: join(at, count.key), message: `${Math.round(max)} ${count.noun}; at most ${count.max}` });
  }
  const text = ownValue(value, 't');
  if (typeof text === 'string' && typeof ownValue(value, 'f') === 'string' && text.length > MAX_TEXT_CHARACTERS) {
    problems.push({ path: join(at, 't'), message: `${text.length} characters; at most ${MAX_TEXT_CHARACTERS}` });
  }
  return problems.length > before;
}

// The repeater copies a shape item stands for in the element count (1 for anything else).
function copiesOf(item, slots) {
  if (ownValue(item, 'ty') !== 'rp') return 1;
  const max = easedMax(ownValue(item, 'c'), slots);
  return Number.isFinite(max) ? Math.max(1, Math.ceil(max)) : 1;
}

// The longest text of a text layer's document keyframes.
function longestText(layer) {
  let longest = 0;
  for (const kf of list(ownValue(ownValue(ownValue(layer, 't'), 'd'), 'k') ?? [])) {
    const text = ownValue(ownValue(kf, 's'), 't');
    if (typeof text === 'string') longest = Math.max(longest, text.length);
  }
  return longest;
}

// The lists a list's cost needs first: a shapes list needs its groups' `it` lists; a layers list needs each layer's
// shapes and the layers of the precomp its refId names.
function childLists(entry, ctx) {
  const out = [];
  entry.list.forEach((item, i) => {
    if (!isPlain(item)) return;
    const here = join(entry.at, i);
    if (entry.kind === 'shapes') {
      if (Array.isArray(ownValue(item, 'it'))) out.push({ list: item.it, kind: 'shapes', at: join(here, 'it') });
      return;
    }
    if (Array.isArray(ownValue(item, 'shapes'))) out.push({ list: item.shapes, kind: 'shapes', at: join(here, 'shapes') });
    const target = ctx.precompOf(ownValue(item, 'refId'));
    if (target) out.push({ list: target.asset.layers, kind: 'layers', at: `assets[${target.index}].layers`, asset: target });
  });
  return out;
}

// One list's cost, once every list it needs is costed (a list in a cycle counts 0: the cycle is reported). Shapes: each
// drawn item is one, a group is one plus its items, and a repeater multiplies everything before it in the same list.
// Layers: each is one plus its shapes, plus its precomp's layers, plus (a text layer, when the file has glyphs) the
// largest glyph times its longest text; a refId that names no asset is reported here.
function listCost(entry, ctx) {
  const costOf = (list) => ctx.costs.get(list) ?? 0;
  let cost = 0;
  entry.list.forEach((item, i) => {
    if (!isPlain(item)) return;
    if (entry.kind === 'shapes') {
      const ty = ownValue(item, 'ty');
      if (ty === 'rp') cost *= copiesOf(item, ctx.slots);
      else if (!NOT_DRAWN.has(ty)) cost += 1 + (Array.isArray(ownValue(item, 'it')) ? costOf(item.it) : 0);
      return;
    }
    cost += 1 + (Array.isArray(ownValue(item, 'shapes')) ? costOf(item.shapes) : 0);
    const refId = ownValue(item, 'refId');
    if (refId !== undefined && !ctx.precompOf(refId) && !ctx.fileAsset(refId)) {
      ctx.problems.push({ path: join(join(entry.at, i), 'refId'), message: `no asset has the id ${JSON.stringify(String(refId))}` });
    }
    const target = ctx.precompOf(refId);
    if (target) cost += costOf(target.asset.layers);
    if (ownValue(item, 'ty') === TEXT_LAYER) cost += ctx.glyphMax * longestText(item);
  });
  return cost;
}

// Costs every list reachable from `roots`, post-order, with an explicit stack; remembers each in ctx.costs. A precomp
// met again while its own cost is open contains itself: reported once, at the asset.
function costLists(roots, ctx) {
  const stack = roots.filter((r) => Array.isArray(r.list)).map((r) => ({ ...r, exit: false }));
  const open = new Set();
  while (stack.length) {
    const entry = stack.pop();
    if (entry.exit) {
      ctx.costs.set(entry.list, listCost(entry, ctx));
      open.delete(entry.list);
      continue;
    }
    if (ctx.costs.has(entry.list) || open.has(entry.list)) continue;
    open.add(entry.list);
    stack.push({ ...entry, exit: true });
    for (const child of childLists(entry, ctx)) {
      if (ctx.costs.has(child.list)) continue;
      if (open.has(child.list)) {
        const id = ownValue(child.asset?.asset, 'id');
        if (child.asset && !ctx.cycles.has(id)) {
          ctx.problems.push({ path: `assets[${child.asset.index}]`, message: `precomp ${JSON.stringify(id)} contains itself (through a layer refId)` });
          ctx.cycles.add(id);
        }
        continue;
      }
      stack.push({ ...child, exit: false });
    }
  }
}

/**
 * Pushes onto `problems` what `json` (a structurally valid Lottie file that passed the depth check) asks lottie-web to
 * build too much of in total, and its refId problems. `capped`: whether a per-object count cap already fired (the total
 * is then not reported: the cap names the cause).
 */
export function budgetProblems(json, problems, capped = false) {
  const assets = new Map();
  (ownValue(json, 'assets') ?? []).forEach((asset, index) => {
    const id = ownValue(asset, 'id');
    if (typeof id === 'string' && !assets.has(id)) assets.set(id, { asset, index }); // lottie-web takes the first
  });
  const lookup = (id) => (typeof id === 'string' ? assets.get(id) : undefined);
  const ctx = {
    slots: ownValue(json, 'slots'), problems, costs: new Map(), cycles: new Set(), glyphMax: 0,
    precompOf: (id) => { const a = lookup(id); return a && Array.isArray(ownValue(a.asset, 'layers')) ? a : undefined; },
    fileAsset: (id) => lookup(id) !== undefined,
  };
  const before = problems.length;
  const chars = ownValue(json, 'chars');
  const glyphs = Array.isArray(chars) ? chars.map((ch, i) => ({ list: ownValue(ownValue(ch, 'data'), 'shapes'), kind: 'shapes', at: `chars[${i}].data.shapes` })) : [];
  costLists(glyphs, ctx);
  for (const g of glyphs) if (Array.isArray(g.list)) ctx.glyphMax = Math.max(ctx.glyphMax, ctx.costs.get(g.list) ?? 0);
  costLists([{ list: json.layers, kind: 'layers', at: 'layers' }], ctx);
  const total = ctx.costs.get(json.layers) ?? 0;
  // a precomp no layer uses is still checked
  costLists([...assets.values()].filter((a) => Array.isArray(ownValue(a.asset, 'layers'))).map((a) => ({ list: a.asset.layers, kind: 'layers', at: `assets[${a.index}].layers`, asset: a })), ctx);
  if (!capped && problems.length === before && total > MAX_LOTTIE_ELEMENTS) {
    problems.push({ path: '(root)', message: `lottie-web would build about ${total} shapes and layers (repeaters, precomps and glyphs multiplied out); at most ${MAX_LOTTIE_ELEMENTS}` });
  }
}

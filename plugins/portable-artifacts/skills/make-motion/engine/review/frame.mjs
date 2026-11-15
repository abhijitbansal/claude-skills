// Frame review: the checks that need no eyes, run on one frame's __snapshot output (a sampled tree with canvas-pixel
// bounding boxes and, on text nodes, the layout with its sizes in pixels). auditFrame returns findings, each
// { kind: 'mechanical' | 'creative', path, message, rule, node }: mechanical ones are defects (text off the safe
// area, text too small, text on text), creative ones are judgment calls for the author. `rule` and `node` let the
// film review keep one finding per (shot, rule, node). Pure and DOM-free; the safe area is the one the kinds compose
// in (compositionRect, so pop on 9:16 gets the platform zone) and sizes are units (engine/units.mjs).
import { unitOf } from '../units.mjs';
import { compositionRect, CAP_HEIGHT, WORD_DESCENT } from '../kinds/shared.mjs';
import { safeInsets, VIRAL_SAFE_ZONE } from '../../template/formats.mjs';

export const MIN_TEXT_UNITS = 28;
export const MAX_TEXT_SIZES = 3;
export const MIN_HERO_RATIO = 3;
export const OVERLAP_UNITS = 4;
export const PRO_MAX_LINE_WORDS = 12;
export const VIRAL_MAX_FIRST_WORDS = 7;
// Two sizes within this ratio of each other (a camera drift scales every text a little) count as one size.
const SAME_SIZE_RATIO = 1.1;
const EPSILON = 1e-6;
const MECHANICAL = 'mechanical';
const CREATIVE = 'creative';

/** The rectangle text must stay inside, as { left, top, right, bottom } in canvas pixels. */
export function safeRect(canvas, look) {
  const size = [canvas.w, canvas.h];
  const rect = compositionRect({ canvas, look, viralInsets: safeInsets(size, VIRAL_SAFE_ZONE) });
  if (rect.safe) return { left: rect.left, top: rect.top, right: rect.left + rect.w, bottom: rect.top + rect.h };
  const margin = safeInsets(size);
  return { left: margin.left, top: margin.top, right: canvas.w - margin.right, bottom: canvas.h - margin.bottom };
}

// The accumulated scale of a node: its own scale (the camera's zoom is folded into the top-level nodes) times its
// non-uniform scale, which counts as the geometric mean of the two axes.
const scaleOf = (n) => (n.scale ?? 1) * Math.sqrt((n.scaleX ?? 1) * (n.scaleY ?? 1));

const wordsOf = (layout) => layout.lines.flatMap((line) => line.words);
const isLanded = (n) => !Array.isArray(n.words) || n.words.every((w) => w.opacity >= 1);
const hasVisibleWord = (n) => !Array.isArray(n.words) || n.words.length === 0 || n.words.some((w) => w.opacity > 0);

// A glyph that reaches below the baseline; a last line without one (figures, capitals) ends at the baseline.
const DESCENDER_RE = /[gjpqyQ,;()[\]{}|@]/;

// The text node's box as the kinds measure it: from the cap line to just under the baseline when the last line has a
// descender, else to the baseline. Its bbox is the font's whole ascent-to-descent box (taller than the ink), so a
// label set a designed distance below a figure, or a kicker above a headline, would overlap it.
function inkBox(n, scale) {
  const { layout, bbox: [x, y, w, h] } = n;
  const ascent = layout.lines[0].y, descent = layout.height - layout.lines.at(-1).y;
  const reach = layout.lines.at(-1).words.some((word) => DESCENDER_RE.test(word.text)) ? WORD_DESCENT * layout.size : 0;
  const above = Math.max(0, ascent - CAP_HEIGHT * layout.size) * scale;
  const below = Math.max(0, descent - reach) * scale;
  return [x, y + above, w, Math.max(0, h - above - below)];
}

// Every visible text in the tree: { node, size (units), ink (box), landed }. A text inside a group inherits the group's
// opacity and scale.
function visibleTexts(sampled, unit) {
  const found = [];
  const walk = (n, opacity, scale) => {
    const o = opacity * (n.opacity ?? 1), s = scale * scaleOf(n);
    if (n.type === 'text' && n.layout && o > 0 && hasVisibleWord(n)) {
      found.push({ node: n, size: (n.layout.size * s) / unit, ink: inkBox(n, s), landed: isLanded(n) });
    }
    for (const child of n.children ?? []) walk(child, o, s);
  };
  sampled.forEach((n) => walk(n, 1, 1));
  return found;
}

const finding = (ctx, kind, rule, node, message) => ({ kind, path: `shots[${ctx.shotId}]`, message, rule, node });
const units = (n) => Number(n.toFixed(1));

function textRules(texts, ctx, safe) {
  return texts.flatMap(({ node, size, ink, landed }) => {
    const out = [];
    if (node.layout.overflow) out.push(finding(ctx, CREATIVE, 'overflow', node.id, `text "${node.id}" does not fit at the ${MIN_TEXT_UNITS}-unit floor; cut words`));
    if (size < MIN_TEXT_UNITS - EPSILON) out.push(finding(ctx, MECHANICAL, 'min-size', node.id, `text "${node.id}" is ${units(size)} units tall; the floor is ${MIN_TEXT_UNITS}`));
    if (landed && outsideSafe(ink, safe)) out.push(finding(ctx, MECHANICAL, 'safe-area', node.id, `text "${node.id}" is outside the safe area; move it in or cut words`));
    return out;
  });
}

function outsideSafe([x, y, w, h], safe) {
  return x < safe.left - EPSILON || y < safe.top - EPSILON || x + w > safe.right + EPSILON || y + h > safe.bottom + EPSILON;
}

function overlapRules(texts, ctx, unit) {
  const limit = OVERLAP_UNITS * unit + EPSILON;
  const out = [];
  texts.forEach((a, i) => texts.slice(i + 1).forEach((b) => {
    const [ax, ay, aw, ah] = a.ink, [bx, by, bw, bh] = b.ink;
    const across = Math.min(ax + aw, bx + bw) - Math.max(ax, bx);
    const down = Math.min(ay + ah, by + bh) - Math.max(ay, by);
    if (across <= limit || down <= limit) return;
    const ids = [a.node.id, b.node.id].sort();
    out.push(finding(ctx, MECHANICAL, 'overlap', ids.join('|'), `texts "${ids[0]}" and "${ids[1]}" overlap by ${units(Math.min(across, down) / unit)} units`));
  }));
  return out;
}

// Sizes in ascending order grouped into runs where each is within SAME_SIZE_RATIO of the one below it.
function sizeClusters(texts) {
  const sizes = texts.map((t) => t.size).sort((a, b) => a - b);
  return sizes.reduce((groups, size) => {
    const last = groups.at(-1);
    if (last && size / last.at(-1) <= SAME_SIZE_RATIO) return [...groups.slice(0, -1), [...last, size]];
    return [...groups, [size]];
  }, []);
}

function hierarchyRules(texts, ctx) {
  const clusters = sizeClusters(texts);
  const out = [];
  if (clusters.length > MAX_TEXT_SIZES) {
    const sizes = clusters.map((c) => Math.round(c[0])).join(', ');
    out.push(finding(ctx, CREATIVE, 'sizes', '', `${clusters.length} distinct text sizes are on screen (${sizes} units); use at most ${MAX_TEXT_SIZES}; drop an optional part such as a label or a delta`));
  }
  if (clusters.length >= 2) {
    const ratio = clusters.at(-1).at(-1) / clusters[0][0];
    if (ratio < MIN_HERO_RATIO - EPSILON) out.push(finding(ctx, CREATIVE, 'hero', '', `the hero text is only ${ratio.toFixed(1)} times the smallest; make it at least ${MIN_HERO_RATIO} times larger`));
  }
  return out;
}

// The words of a line a viewer can see: a word at opacity 0 is not there (the number kind keeps every step of a count
// as a word and shows one at a time).
const shownWords = (node, words) => words.filter((word) => (node.words?.[word.index]?.opacity ?? 1) > 0);

function wordRules(texts, ctx) {
  const modeName = typeof ctx.mode === 'string' ? ctx.mode : ctx.mode?.name;
  const out = [];
  if (modeName === 'pro') {
    for (const { node } of texts) {
      if (node.layout.lines.some((line) => shownWords(node, line.words).length > PRO_MAX_LINE_WORDS)) {
        out.push(finding(ctx, CREATIVE, 'line-words', node.id, `text "${node.id}" has a line of more than ${PRO_MAX_LINE_WORDS} words; shorten it`));
      }
    }
  }
  if (modeName === 'viral' && ctx.isFirstShot && texts.length > 0) {
    const hero = texts.reduce((best, t) => (t.size > best.size ? t : best));
    const count = shownWords(hero.node, wordsOf(hero.node.layout)).length;
    if (count > VIRAL_MAX_FIRST_WORDS) out.push(finding(ctx, CREATIVE, 'hook-words', hero.node.id, `the opening statement has ${count} words; a viral hook takes at most ${VIRAL_MAX_FIRST_WORDS}`));
  }
  return out;
}

/**
 * @param {object[]} sampled the tree the page's __snapshot(i) returns for one frame
 * @param {{ look: object, canvas: { w: number, h: number }, mode: string | { name: string }, shotId: string, t: number, isFirstShot?: boolean }} ctx
 *   isFirstShot: the frame belongs to the first shot of the film (the viral hook rule)
 * @returns {{ kind: 'mechanical' | 'creative', path: string, message: string, rule: string, node: string }[]}
 */
export function auditFrame(sampled, ctx) {
  const unit = unitOf(ctx.canvas);
  const texts = visibleTexts(sampled, unit);
  if (texts.length === 0) return [];
  return [
    ...textRules(texts, ctx, safeRect(ctx.canvas, ctx.look)),
    ...overlapRules(texts, ctx, unit),
    ...hierarchyRules(texts, ctx),
    ...wordRules(texts, ctx),
  ];
}

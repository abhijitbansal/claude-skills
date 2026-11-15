// Frame review: the checks that need no eyes, run on one frame's __snapshot output (a sampled tree with canvas-pixel
// bounding boxes and, on text nodes, the layout with its sizes in pixels). auditFrame returns findings, each
// { kind: 'mechanical' | 'creative', path, message, rule, node }: mechanical ones are defects (text off the safe
// area, text too small, text on text), creative ones are judgment calls for the author. `rule` and `node` let the
// film review keep one finding per (shot, rule, node). Pure and DOM-free; sizes are units (engine/units.mjs).
//
// Boxes. The safe-area and overlap checks use the measured ink of a text, not its snapshot bbox (the font's whole
// ascent-to-descent box): from the cap line (CAP_HEIGHT) to the baseline of the last line, plus WORD_DESCENT below it when
// a word there has a descender. A label set a designed distance under a figure, or a kicker over a headline, would
// otherwise overlap it.
//
// Landed. A word at opacity 0 on its shot's last frame is permanently hidden (the number kind stacks every step of its
// count as a word and shows one at a time). A text has landed when every word that is not permanently hidden is at
// opacity 1 and scale 1 (not mid-pulse), the text itself (with the groups it sits in) is at opacity 1 (a text still
// fading in is still arriving) and it is settled: at the scale it has on its shot's last frame (not mid-spring,
// mid-pulse or mid-push). The safe-area and overlap checks apply to a landed text, using only its words that are not hidden. The
// caller passes the hidden words in ctx.hiddenWords (node id -> Set of word indices).
//
// Roles. A text node's props.role (set by the kinds: hero, affix, label, kicker, caption, tag, body; none means body)
// says what the text is for. An `affix` (prefix, suffix, unit) and a `tag` are small by design: the scale-contrast rule
// leaves them out, and the distinct-sizes rule leaves out affixes.
import { unitOf } from '../units.mjs';
import { CAP_HEIGHT, WORD_DESCENT } from '../kinds/shared.mjs';

export const MIN_TEXT_UNITS = 28;
export const MAX_TEXT_SIZES = 3;
export const MIN_HERO_RATIO = 3;
export const OVERLAP_UNITS = 4;
export const PRO_MAX_LINE_WORDS = 12;
export const VIRAL_MAX_FIRST_WORDS = 7;
// Two sizes within this ratio of each other (a camera drift scales every text a little) count as one size.
const SAME_SIZE_RATIO = 1.1;
const SETTLE_TOLERANCE = 0.02;
const EPSILON = 1e-6;
const MECHANICAL = 'mechanical';
const CREATIVE = 'creative';
const HALF = 2;
const MIN_SIZES_TO_COMPARE = 2; // a hero needs another size to be compared with
const NO_WORDS = new Set();
// A glyph that reaches below the baseline; a last line without one (figures, capitals) ends at the baseline.
const DESCENDER_RE = /[gjpqyQ,;()[\]{}|@]/;
const WORD_IDENTITY = Object.freeze({ opacity: 1, x: 0, y: 0, scale: 1 });

// The accumulated scale of a node: its own scale (the camera's zoom is folded into the top-level nodes) times its
// non-uniform scale, which counts as the geometric mean of the two axes.
const scaleOf = (n) => (n.scale ?? 1) * Math.sqrt((n.scaleX ?? 1) * (n.scaleY ?? 1));
const roleOf = (n) => n.props?.role ?? 'body';
const wordsOf = (layout) => layout.lines.flatMap((line) => line.words);

// One word's box in the text node's own space, as engine/page/bounds.mjs puts it: scaled about its centre on the baseline.
function wordBox(line, word, track, { ascent, descent }) {
  const t = { ...WORD_IDENTITY, ...track };
  const scale = Math.abs(t.scale), half = (word.width / HALF) * scale;
  const centre = line.x + word.x + word.width / HALF + t.x;
  return [centre - half, line.y + t.y - ascent * scale, HALF * half, (ascent + descent) * scale];
}

function union(boxes) {
  const left = Math.min(...boxes.map((b) => b[0])), top = Math.min(...boxes.map((b) => b[1]));
  const right = Math.max(...boxes.map((b) => b[0] + b[2])), bottom = Math.max(...boxes.map((b) => b[1] + b[3]));
  return [left, top, right - left, bottom - top];
}

// The ink box of a text in canvas pixels, from the words that are not hidden (all of them when none is shown).
function inkBox(n, scale, hidden) {
  const { layout, bbox } = n;
  const metrics = { ascent: layout.lines[0].y, descent: layout.height - layout.lines.at(-1).y };
  const boxesOf = (keep) => layout.lines.flatMap((line) => line.words.filter(keep).map((word) => wordBox(line, word, n.words?.[word.index], metrics)));
  const all = boxesOf(() => true);
  if (all.length === 0) return bbox;
  const whole = union(all), shown = boxesOf((word) => !hidden.has(word.index));
  const part = shown.length > 0 ? union(shown) : whole;
  const sx = whole[2] > 0 ? bbox[2] / whole[2] : 1, sy = whole[3] > 0 ? bbox[3] / whole[3] : 1;
  const reach = layout.lines.at(-1).words.some((word) => DESCENDER_RE.test(word.text)) ? WORD_DESCENT * layout.size : 0;
  const above = Math.max(0, metrics.ascent - CAP_HEIGHT * layout.size) * scale;
  const below = Math.max(0, metrics.descent - reach) * scale;
  const top = bbox[1] + (part[1] - whole[1]) * sy + above;
  return [bbox[0] + (part[0] - whole[0]) * sx, top, part[2] * sx, Math.max(0, part[3] * sy - above - below)];
}

// Words that count for a text: those not permanently hidden. A text whose every word is hidden is judged by all of them.
function hiddenOf(n, hiddenWords) {
  const hidden = hiddenWords?.get(n.id) ?? NO_WORDS;
  return hidden.size >= wordsOf(n.layout).length ? NO_WORDS : hidden;
}

const hasVisibleWord = (n) => !Array.isArray(n.words) || n.words.length === 0 || n.words.some((w) => w.opacity > 0);

/** text node id -> its accumulated scale (its own, its groups' and the camera's) in a sampled tree: how big it stands. */
export function textScalesIn(sampled) {
  const scales = new Map();
  const walk = (n, scale) => {
    const s = scale * scaleOf(n);
    if (n.type === 'text') scales.set(n.id, s);
    (n.children ?? []).forEach((child) => walk(child, s));
  };
  sampled.forEach((n) => walk(n, 1));
  return scales;
}

// A word has arrived when it is at opacity 1, and is at rest when it is also at its own scale of 1 (an emphasis pulse
// scales a word up and back).
const isWordAtRest = (word) => (word?.opacity ?? 1) >= 1 && Math.abs((word?.scale ?? 1) - 1) <= SETTLE_TOLERANCE;

// A text is settled when it stands within SETTLE_TOLERANCE of the scale it has on its shot's last frame: an entrance
// spring, an emphasis pulse or a camera push passes through other scales on its way and is not judged on them.
const isSettled = (id, scale, resting) => !resting?.has(id) || Math.abs(scale / resting.get(id) - 1) <= SETTLE_TOLERANCE;

// Every visible text in the tree: { node, size (units), role, ink (box), landed }. A text inside a group inherits the
// group's opacity and scale.
function visibleTexts(sampled, unit, ctx) {
  const found = [];
  const walk = (n, opacity, scale) => {
    const o = opacity * (n.opacity ?? 1), s = scale * scaleOf(n);
    if (n.type === 'text' && n.layout && o > 0 && hasVisibleWord(n)) {
      const hidden = hiddenOf(n, ctx.hiddenWords);
      const wordsIn = !Array.isArray(n.words) || wordsOf(n.layout).every((w) => hidden.has(w.index) || isWordAtRest(n.words[w.index]));
      const landed = wordsIn && o >= 1 && isSettled(n.id, s, ctx.restScales);
      found.push({ node: n, size: (n.layout.size * s) / unit, role: roleOf(n), ink: inkBox(n, s, hidden), landed });
    }
    for (const child of n.children ?? []) walk(child, o, s);
  };
  sampled.forEach((n) => walk(n, 1, 1));
  return found;
}

const finding = (ctx, kind, rule, node, message) => ({ kind, path: `shots[${ctx.shotId}]`, message, rule, node });
const units = (n) => Number(n.toFixed(1));

function outsideSafe([x, y, w, h], safe) {
  return x < safe.left - EPSILON || y < safe.top - EPSILON || x + w > safe.right + EPSILON || y + h > safe.bottom + EPSILON;
}

function textRules(texts, ctx) {
  return texts.flatMap(({ node, size, ink, landed }) => {
    const out = [];
    if (node.layout.overflow) out.push(finding(ctx, CREATIVE, 'overflow', node.id, `text "${node.id}" does not fit at the ${MIN_TEXT_UNITS}-unit floor; cut words`));
    if (size < MIN_TEXT_UNITS - EPSILON) out.push(finding(ctx, MECHANICAL, 'min-size', node.id, `text "${node.id}" is ${units(size)} units tall; the floor is ${MIN_TEXT_UNITS}`));
    if (landed && outsideSafe(ink, ctx.safe)) out.push(finding(ctx, MECHANICAL, 'safe-area', node.id, `text "${node.id}" is outside the safe area; move it in or cut words`));
    return out;
  });
}

function overlapRules(texts, ctx, unit) {
  const limit = OVERLAP_UNITS * unit + EPSILON;
  const landed = texts.filter((t) => t.landed);
  const out = [];
  landed.forEach((a, i) => landed.slice(i + 1).forEach((b) => {
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
  const out = [];
  const sized = sizeClusters(texts.filter((t) => t.role !== 'affix'));
  if (sized.length > MAX_TEXT_SIZES) {
    const sizes = sized.map((c) => Math.round(c[0])).join(', ');
    out.push(finding(ctx, CREATIVE, 'sizes', '', `${sized.length} distinct text sizes are on screen (${sizes} units); use at most ${MAX_TEXT_SIZES}; drop an optional part such as a label or a delta`));
  }
  const contrast = sizeClusters(texts.filter((t) => t.role !== 'affix' && t.role !== 'tag'));
  if (contrast.length >= MIN_SIZES_TO_COMPARE) {
    const ratio = contrast.at(-1).at(-1) / contrast[0][0];
    if (ratio < MIN_HERO_RATIO - EPSILON) out.push(finding(ctx, CREATIVE, 'hero', '', `the hero text is only ${ratio.toFixed(1)} times the smallest; make it at least ${MIN_HERO_RATIO} times larger`));
  }
  return out;
}

// The words of a line a viewer can see: a word at opacity 0 is not there.
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
 * @param {{ look: object, canvas: { w: number, h: number }, mode: string | { name: string }, shotId: string, t: number,
 *   safe: { left: number, top: number, right: number, bottom: number }, isFirstShot?: boolean,
 *   hiddenWords?: Map<string, Set<number>>, restScales?: Map<string, number> }} ctx
 *   safe: the rectangle text must stay inside (scripts/v2/review.mjs safeRectFor). isFirstShot: the frame belongs to
 *   the first shot of the film (the viral hook rule). hiddenWords: node id -> indices of the words permanently hidden
 *   in this shot. restScales: node id -> accumulated scale on the shot's last frame (textScalesIn); a text is judged for
 *   the safe area and overlap only while it stands within 2% of it.
 * @returns {{ kind: 'mechanical' | 'creative', path: string, message: string, rule: string, node: string }[]}
 */
export function auditFrame(sampled, ctx) {
  if (!ctx.safe) throw new Error('auditFrame needs ctx.safe, the rectangle text must stay inside');
  const unit = unitOf(ctx.canvas);
  const texts = visibleTexts(sampled, unit, ctx);
  if (texts.length === 0) return [];
  return [...textRules(texts, ctx), ...overlapRules(texts, ctx, unit), ...hierarchyRules(texts, ctx), ...wordRules(texts, ctx)];
}

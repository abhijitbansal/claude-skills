// Frame review on hand-built snapshots (the shape window.__snapshot returns), the still-frame pacing rule, and the
// sheet plan. All pure: no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/looks/index.mjs';
import '../../engine/modes/index.mjs';
import { auditFrame } from '../../engine/review/frame.mjs';
import { stillStretches } from '../../engine/review/pacing.mjs';
import { planSheets, auditMoments } from '../../scripts/v2/plan.mjs';
import { dedupeFindings, safeRectFor, sessionFindings, auditPlan, hookFindings, restingByShot } from '../../scripts/v2/review.mjs';
import { layoutSheet, shotColumns, CUT_COLUMNS } from '../../scripts/v2/layout.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { buildFilm } from '../../engine/graph/film.mjs';
import { FPS, measure, IMAGES, canvasOf, viralOf, filmOf } from './helpers/kinds.mjs';

const CANVAS = { w: 1920, h: 1080 };
const ctx = (extra = {}) => {
  const base = { look: registries.looks.get('desk'), canvas: CANVAS, mode: 'pro', shotId: 'hero', shotIndex: 0, t: 1.2, ...extra };
  return { safe: safeRectFor(base.canvas, base.look), ...base };
};

// A text node as annotate() reports it: layout sizes in pixels, a canvas-pixel bbox (the font's whole ascent box, as
// annotate measures it), one entry per word in `words`. The font: ascent 0.9 em, descent 0.25 em, line height 1.3 em.
const ASCENT = 0.9, DESCENT = 0.25, LINE_HEIGHT = 1.3;
const INK_ABOVE = ASCENT - 0.7; // the cap line is 0.7 em above the baseline, the kinds' CAP_HEIGHT
const WORD_DESCENT = 0.12; // the kinds' WORD_DESCENT: ink below the baseline when a word has a descender
function textNode({ id = 't', size = 44, x = 200, y = 300, words = 3, perLine = words, overflow = false, opacity = 1, wordOpacity = 1, scale = 1, word = 'word', role, children = [] } = {}) {
  const lines = [];
  for (let from = 0; from < words; from += perLine) {
    const count = Math.min(perLine, words - from);
    const baseline = size * (ASCENT + lines.length * LINE_HEIGHT);
    lines.push({ x: 0, y: baseline, width: count * size * 2, words: Array.from({ length: count }, (_, k) => ({ text: word, index: from + k, x: k * size * 2, width: size * 2 })) });
  }
  const width = Math.min(words, perLine) * size * 2;
  const height = lines.at(-1).y + size * DESCENT;
  return {
    type: 'text', id, depth: 0, props: role === undefined ? {} : { role }, x, y, scale, scaleX: 1, scaleY: 1, rotate: 0, opacity, visible: opacity > 0, children,
    words: Array.from({ length: words }, () => ({ opacity: wordOpacity, x: 0, y: 0, scale: 1 })),
    layout: { size, width, height, overflow, lines },
    bbox: [x, y, width * scale, height * scale], spread: 0,
  };
}
// Where the ink of a node ends (the baseline of its last line, or WORD_DESCENT below it when a word there has a
// descender), and where a node must start for its ink to start at `top`.
const inkBottom = (n) => n.bbox[1] + n.layout.lines.at(-1).y + (n.layout.lines.at(-1).words.some((w) => /[gjpqy]/.test(w.text)) ? n.layout.size * WORD_DESCENT : 0);
const yForInkTop = (top, size) => top - size * INK_ABOVE;
const kinds = (findings) => findings.map((f) => f.kind);

// ---- the brief's three ----

test('overflow is a creative finding that names the shot', () => {
  const f = auditFrame([textNode({ overflow: true })], ctx());
  assert.deepEqual(kinds(f), ['creative']);
  assert.match(f[0].message, /cut words/);
  assert.equal(f[0].path, 'shots[0]');
});

test('text outside the safe area is mechanical', () => {
  const f = auditFrame([textNode({ size: 132, x: 10 })], ctx());
  assert.deepEqual(kinds(f), ['mechanical']);
  assert.match(f[0].message, /safe/);
});

test('a clean frame has no findings', () => {
  assert.deepEqual(auditFrame([textNode({ id: 'a', size: 132 }), textNode({ id: 'b', size: 44, y: 700 })], ctx()), []);
});

// ---- the other rules ----

test('text still arriving is not checked against the safe area', () => {
  assert.deepEqual(auditFrame([textNode({ size: 132, x: 10, wordOpacity: 0.5 })], ctx()), []);
});

test('the audit never throws: a text with no lines or no words is skipped, an empty frame has no findings', () => {
  const bare = (layout) => ({ ...textNode({ id: 'bare' }), layout });
  assert.deepEqual(auditFrame([bare({ size: 44, width: 0, height: 0, overflow: false, lines: [] })], ctx()), []);
  assert.deepEqual(auditFrame([bare({ size: 44, width: 0, height: 0, overflow: false, lines: [{ x: 0, y: 40, width: 0, words: [] }] })], ctx()), []);
  assert.deepEqual(auditFrame([bare(undefined)], ctx()), []);
  assert.deepEqual(auditFrame([], ctx()), []);
  assert.deepEqual(auditFrame([{ type: 'group', id: 'g', children: [], bbox: [0, 0, 0, 0] }], ctx()), [], 'a shot with no text');
});

test('a text whose box is not a finite number is left out of every rule and reported once as unmeasurable', () => {
  const broken = { ...textNode({ id: 'broken', size: 20, x: 10 }), bbox: [Number.NaN, 300, 100, 50] };
  const sound = textNode({ id: 'sound', size: 132, y: 600 });
  const found = auditFrame([broken, sound], ctx());
  assert.deepEqual(found.map((f) => [f.kind, f.rule, f.message]), [['mechanical', 'measure', 'broken: could not be measured']]);
  const infinite = { ...textNode({ id: 'inf' }), layout: { ...textNode({}).layout, size: Number.POSITIVE_INFINITY } };
  assert.deepEqual(auditFrame([infinite], ctx()).map((f) => f.message), ['inf: could not be measured']);
});

test('the size floor is judged only for a landed text: a text still arriving at a small scale is not a defect', () => {
  const arriving = textNode({ id: 'arriving', size: 20, wordOpacity: 0.5 });
  assert.deepEqual(auditFrame([arriving], ctx()), []);
  assert.deepEqual(kinds(auditFrame([textNode({ id: 'landed', size: 20 })], ctx())), ['mechanical']);
});

test('the ink reaches accents and descenders: a measured line, an accented capital and the glyphs of other scripts', () => {
  const SAFE_TOP = 60;
  // 132 px, baseline at 160: the cap line is at 68, inside the safe top (60); an accent reaches 35
  const hero = (word, extra = {}) => ({ ...textNode({ id: 'hero', size: 132, x: 300, y: 160 - 0.9 * 132, words: 1, word }), ...extra });
  assert.ok(160 - 0.7 * 132 >= SAFE_TOP);
  assert.deepEqual(auditFrame([hero('ECOLE')], ctx()), [], 'capitals stay under the safe edge');
  assert.deepEqual(kinds(auditFrame([hero('ÉCOLE')], ctx())), ['mechanical'], 'an accented capital crosses it (no measurement: from the font ascent)');
  assert.deepEqual(kinds(auditFrame([hero('ECOLE', { lineInk: [{ ascent: 0.95 * 132, descent: 0 }] })], ctx())), ['mechanical'], 'a measured line whose glyphs reach 125 px above the baseline');
  assert.deepEqual(auditFrame([hero('ECOLE', { lineInk: [{ ascent: 0.65 * 132, descent: 0 }] })], ctx()), [], 'a measured line lower than the cap line leaves room');
  const upper = (word) => textNode({ id: 'upper', size: 132, x: 200, y: 300, word, words: 1 });
  const lowerAt = (inkTop) => textNode({ id: 'lower', size: 44, x: 200, y: yForInkTop(inkTop, 44), words: 1 });
  for (const word of ['gypsy', 'ça', 'ура']) {
    assert.deepEqual(kinds(auditFrame([upper(word), lowerAt(inkBottom(upper(word)) - 132 * WORD_DESCENT)], ctx())), ['mechanical'], `${word} has a descender that reaches into the line below`);
  }
  assert.deepEqual(kinds(auditFrame([upper('ABC'), lowerAt(inkBottom(upper('ABC')) + 5)], ctx())), [], 'capitals end at the baseline: a line starting just under it is clear');
  const measured = { ...upper('ABC'), lineInk: [{ ascent: 0.7 * 132, descent: 0.25 * 132 }] };
  assert.deepEqual(kinds(auditFrame([measured, lowerAt(measured.bbox[1] + 0.9 * 132 + 0.1 * 132)], ctx())), ['mechanical'], 'a measured descent of 0.25 em reaches the label below');
});

test('text that is not visible is ignored by every rule', () => {
  assert.deepEqual(auditFrame([textNode({ size: 10, x: 10, overflow: true, opacity: 0 })], ctx()), []);
  const hidden = textNode({ id: 'inner', size: 10 });
  const group = { type: 'group', id: 'g', opacity: 0, visible: false, children: [hidden], bbox: hidden.bbox };
  assert.deepEqual(auditFrame([group], ctx()), [], 'a text inside a group at opacity 0');
});

test('a text smaller than 28 units is mechanical, measured after the node scale', () => {
  assert.deepEqual(kinds(auditFrame([textNode({ size: 20 })], ctx())), ['mechanical']);
  assert.deepEqual(kinds(auditFrame([textNode({ size: 20, scale: 1.5 })], ctx())), [], '20 px at scale 1.5 is 30 units');
  assert.deepEqual(kinds(auditFrame([textNode({ size: 56 })], ctx({ canvas: { w: 3840, h: 2160 } }))), [], '56 px is 28 units on a 2160 canvas');
  assert.deepEqual(kinds(auditFrame([textNode({ size: 54 })], ctx({ canvas: { w: 3840, h: 2160 } }))), ['mechanical'], '54 px is 27 units');
});

test('the 28-unit floor itself passes', () => {
  assert.deepEqual(kinds(auditFrame([textNode({ size: 28 })], ctx())), []);
  assert.deepEqual(kinds(auditFrame([textNode({ size: 27.9 })], ctx())), ['mechanical']);
});

test('two texts overlapping by more than 4 units are mechanical; touching or 4 units is not', () => {
  const a = textNode({ id: 'a', size: 44, x: 200, y: 300 });
  const over = (dy) => textNode({ id: 'b', size: 44, x: 200, y: yForInkTop(inkBottom(a) - dy, 44) });
  assert.deepEqual(kinds(auditFrame([a, over(10)], ctx())), ['mechanical']);
  assert.deepEqual(kinds(auditFrame([a, over(4)], ctx())), []);
  assert.deepEqual(kinds(auditFrame([a, over(0)], ctx())), []);
});

test('overlap and the safe area use the ink, not the font ascent box: a kicker set above a headline is not on it', () => {
  const headline = textNode({ id: 'headline', size: 132, x: 200, y: 400, words: 2 });
  // the kicker's ink ends 28 units above the headline's cap line, yet the two ascent boxes overlap by a few units
  const inkHeight = 44 * 0.7; // cap line to baseline: no descender in 'word'
  const kickerTop = headline.bbox[1] + 132 * INK_ABOVE - 28 - inkHeight;
  const kicker = textNode({ id: 'kicker', size: 44, x: 200, y: yForInkTop(kickerTop, 44), words: 2 });
  assert.ok(kicker.bbox[1] + kicker.bbox[3] > headline.bbox[1] + 4, 'the ascent boxes overlap by more than 4 units');
  assert.deepEqual(auditFrame([headline, kicker], ctx()), []);
});

test('a descender reaches below the baseline: a word with one overlaps what sits right under it', () => {
  const upper = textNode({ id: 'upper', size: 132, x: 200, y: 300, word: 'gypsy', words: 1 });
  const lowerAt = (inkTop) => textNode({ id: 'lower', size: 44, x: 200, y: yForInkTop(inkTop, 44), words: 1 });
  const reach = 132 * WORD_DESCENT;
  assert.deepEqual(kinds(auditFrame([upper, lowerAt(inkBottom(upper))], ctx())), [], 'ink just touching: no overlap');
  assert.deepEqual(kinds(auditFrame([upper, lowerAt(inkBottom(upper) - reach)], ctx())), ['mechanical'], 'the descender reaches into it');
  const figures = textNode({ id: 'upper', size: 132, x: 200, y: 300, word: '459', words: 1 });
  assert.deepEqual(kinds(auditFrame([figures, lowerAt(inkBottom(upper) - reach)], ctx())), [], 'figures end at the baseline, so the same spot is clear');
});

test('more than 3 distinct visible text sizes is creative', () => {
  const sizes = [44, 72, 132, 220];
  const f = auditFrame(sizes.map((size, i) => textNode({ id: `t${i}`, size, y: 100 + i * 200, words: 1 })), ctx());
  assert.ok(kinds(f).includes('creative'));
  assert.ok(f.some((x) => /sizes/.test(x.message)));
  assert.equal(auditFrame(sizes.slice(0, 3).map((size, i) => textNode({ id: `t${i}`, size, y: 100 + i * 250, words: 1 })), ctx()).filter((x) => /sizes/.test(x.message)).length, 0);
});

test('sizes within 10 percent of each other are one size', () => {
  const f = auditFrame([132, 133, 134, 135, 136].map((size, i) => textNode({ id: `t${i}`, size, y: 60 + i * 190, words: 1 })), ctx());
  assert.deepEqual(f, []);
});

test('a hero under 3 times the smallest text is creative; exactly 3 times is fine', () => {
  const weak = auditFrame([textNode({ id: 'a', size: 72 }), textNode({ id: 'b', size: 44, y: 700 })], ctx());
  assert.deepEqual(kinds(weak), ['creative']);
  assert.match(weak[0].message, /hero/);
  assert.deepEqual(auditFrame([textNode({ id: 'a', size: 132 }), textNode({ id: 'b', size: 44, y: 700 })], ctx()), []);
});

test('an affix is left out of the contrast and the size count; a tag is left out of the contrast', () => {
  const figure = textNode({ id: 'digits', size: 427, x: 200, y: 100, words: 1, word: '459', role: 'hero' });
  const suffix = textNode({ id: 'suffix', size: 192, x: 1100, y: 100, words: 1, word: 'rows', role: 'affix' });
  const label = textNode({ id: 'label', size: 72, x: 200, y: 700, words: 1, role: 'label' });
  assert.deepEqual(auditFrame([figure, suffix, label], ctx()), [], 'hero 427 against label 72; the suffix at 192 is an affix');
  assert.deepEqual(auditFrame([figure, suffix], ctx()), [], 'the only other text is an affix: nothing to contrast with');
  const bigTag = textNode({ id: 'tag', size: 200, x: 1100, y: 100, words: 1, role: 'tag' });
  assert.deepEqual(auditFrame([textNode({ id: 'h', size: 300, x: 200, y: 100, words: 1, role: 'hero' }), bigTag], ctx()), [], 'nor is a tag a size to contrast with');
  const bodySuffix = { ...suffix, props: {} };
  const onlyHeroAndBody = auditFrame([figure, bodySuffix], ctx());
  assert.deepEqual(onlyHeroAndBody.map((f) => f.rule), ['hero'], 'with no role the suffix is body, and 427 against 192 is weak contrast');
  const delta = textNode({ id: 'delta', size: 44, x: 700, y: 700, words: 1, role: 'tag' });
  assert.deepEqual(auditFrame([figure, label, delta], ctx()).filter((f) => f.rule === 'hero'), [], 'a tag is not the smallest text');
  const smallBody = textNode({ id: 'small', size: 200, x: 900, y: 750, words: 1 });
  assert.equal(auditFrame([textNode({ id: 'h', size: 300, x: 200, y: 100, words: 1, role: 'hero' }), smallBody], ctx()).filter((f) => f.rule === 'hero').length, 1, 'a body text 200 against a hero of 300 is weak contrast');
});

test('four sizes of which one is an affix are three sizes; four non-affix sizes are four', () => {
  const at = (id, size, y, role) => textNode({ id, size, x: 200, y, words: 1, role });
  const three = [at('a', 427, 40, 'hero'), at('b', 192, 400, 'affix'), at('c', 72, 700), at('d', 44, 820, 'label')];
  assert.deepEqual(auditFrame(three, ctx()).filter((f) => f.rule === 'sizes'), []);
  const four = [at('a', 427, 40, 'hero'), at('b', 192, 400, 'body'), at('c', 72, 700), at('d', 44, 820, 'label')];
  assert.equal(auditFrame(four, ctx()).filter((f) => f.rule === 'sizes').length, 1);
});

test('hidden words: the safe-area and overlap checks use the words on screen on the frame, and only once those have landed', () => {
  // Alpha Bravo Omega, 96 px: Alpha and Bravo (steps of a count) are at opacity 0 on this frame, Omega is shown
  const count = (x, { last = 1, id = 'count' } = {}) => {
    const node = textNode({ id, size: 96, x, y: 400, words: 3, word: 'Omega' });
    return { ...node, words: [{ ...node.words[0], opacity: 0 }, { ...node.words[1], opacity: 0 }, { ...node.words[2], opacity: last }] };
  };
  const run = (node) => auditFrame([node], ctx());
  assert.deepEqual(run(count(10)).filter((f) => f.rule === 'safe-area'), [], 'the shown word is inside although the hidden ones start outside');
  assert.deepEqual(run(count(1400)).map((f) => f.rule), ['safe-area'], 'the shown word is outside');
  assert.deepEqual(run(count(1400, { last: 0.5 })).filter((f) => f.rule === 'safe-area'), [], 'an intermediate value (not landed) is not audited');
  assert.deepEqual(run({ ...count(1400, { id: 'other' }), id: 'other' }).map((f) => f.rule), ['safe-area'], 'no list of hidden words is needed: the frame says');
});

test('a text is judged only once it has settled: not mid-spring, mid-pulse or while still fading in', () => {
  const out = textNode({ id: 'out', size: 132, x: 10, words: 1 }); // outside the safe area at rest
  const rule = (node, extra = {}) => auditFrame([node], ctx(extra)).filter((f) => f.rule === 'safe-area').length;
  assert.equal(rule(out, { restScales: new Map([['out', 1]]) }), 1, 'at its resting scale it is judged');
  assert.equal(rule({ ...out, scale: 1.1 }, { restScales: new Map([['out', 1]]) }), 0, 'a spring or a push passing through another scale is not');
  assert.equal(rule({ ...out, scale: 1.001 }, { restScales: new Map([['out', 1]]) }), 1, 'within 0.2 percent counts as settled');
  assert.equal(rule({ ...out, scale: 1.01 }, { restScales: new Map([['out', 1]]) }), 0, 'a camera punch 1 percent from home is still returning: not judged');
  const pulsing = { ...out, words: [{ opacity: 1, x: 0, y: 0, scale: 1.12 }] };
  assert.equal(rule(pulsing), 0, 'a word in the middle of an emphasis pulse');
  const group = { type: 'group', id: 'g', opacity: 0.9, visible: true, scale: 1, scaleX: 1, scaleY: 1, children: [out], bbox: out.bbox };
  assert.equal(auditFrame([group], ctx()).filter((f) => f.rule === 'safe-area').length, 0, 'inside a group still fading in');
});

test('a text with every word at opacity 0 is not on screen and is not judged; with its words shown it is judged by all of them', () => {
  const node = textNode({ id: 'count', size: 96, x: 10, y: 400, words: 2, word: 'Omega' });
  assert.deepEqual(auditFrame([{ ...node, words: node.words.map((w) => ({ ...w, opacity: 0 })) }], ctx()), []);
  assert.deepEqual(auditFrame([node], ctx()).map((x) => x.rule), ['safe-area']);
});

test('a lone text, or texts of one size, have no hero to compare', () => {
  assert.deepEqual(auditFrame([textNode({ size: 44 })], ctx()), []);
  assert.deepEqual(auditFrame([textNode({ id: 'a', size: 44 }), textNode({ id: 'b', size: 44, y: 700 })], ctx()), []);
});

test('a line of more than 12 words in pro is creative; 12 is fine; viral has no such rule', () => {
  assert.deepEqual(kinds(auditFrame([textNode({ size: 44, words: 13, perLine: 13 })], ctx())), ['creative']);
  assert.deepEqual(kinds(auditFrame([textNode({ size: 44, words: 24, perLine: 12 })], ctx())), []);
  const pop = registries.looks.get('pop');
  assert.deepEqual(auditFrame([textNode({ size: 44, x: 200, words: 13, perLine: 13 })], ctx({ mode: 'viral', look: pop, canvas: { w: 1080, h: 1920 } })).filter((f) => f.rule === 'line-words'), []);
});

test('only the words a viewer can see count: 14 words on a line of which 8 are shown is fine', () => {
  const crowded = textNode({ size: 44, words: 14, perLine: 14 });
  const shown = { ...crowded, words: crowded.words.map((w, i) => ({ ...w, opacity: i < 8 ? 1 : 0 })) };
  assert.deepEqual(kinds(auditFrame([crowded], ctx())), ['creative']);
  assert.deepEqual(auditFrame([shown], ctx()).filter((f) => f.rule === 'line-words'), []);
});

test('a statement of more than 7 words in the first shot of viral is creative', () => {
  const viral = (extra) => ctx({ mode: 'viral', look: registries.looks.get('pop'), canvas: { w: 1080, h: 1920 }, ...extra });
  const eight = [textNode({ size: 100, x: 200, y: 700, words: 8, perLine: 2 })];
  assert.deepEqual(kinds(auditFrame(eight, viral({ isFirstShot: true }))), ['creative']);
  assert.deepEqual(kinds(auditFrame(eight, viral({ isFirstShot: false }))), []);
  assert.deepEqual(kinds(auditFrame([textNode({ size: 100, x: 200, y: 700, words: 7, perLine: 2 })], viral({ isFirstShot: true }))), []);
});

test('pop on 9:16 composes in the platform safe zone, so a title in the top band is outside it', () => {
  const pop = registries.looks.get('pop');
  const viral = (y) => ctx({ mode: 'viral', look: pop, canvas: { w: 1080, h: 1920 } });
  assert.deepEqual(kinds(auditFrame([textNode({ size: 100, x: 200, y: 100, words: 1 })], viral())), ['mechanical'], 'y 100 is inside the 290 px account bar');
  assert.deepEqual(kinds(auditFrame([textNode({ size: 100, x: 200, y: 400, words: 1 })], viral())), []);
});

test('a finding carries its rule and node so the film review can deduplicate', () => {
  const [f] = auditFrame([textNode({ id: 'headline', size: 20 })], ctx());
  assert.equal(f.rule, 'min-size'); assert.equal(f.node, 'headline');
});

test('dedupeFindings keeps the first time a (shot, rule, node) occurs and puts the time in the message', () => {
  const at = (t, node = 'a') => ({ shot: 'hero', t, finding: { kind: 'mechanical', path: 'shots[hero]', message: 'text is outside the safe area', rule: 'safe-area', node } });
  const out = dedupeFindings([at(2), at(1), at(3), at(1.5, 'b')]);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((f) => [f.node ?? null, f.t]), [['a', 1], ['b', 1.5]]);
  assert.match(out[0].message, /at 1\.00 s/);
  assert.equal(out[0].shot, 'hero'); assert.equal(out[0].kind, 'mechanical');
});

// ---- pacing ----

const heldRun = (n, held = true) => Array.from({ length: n }, () => held);

test('a still stretch longer than the mode allows is found; one exactly as long is not', () => {
  const FPS = 30;
  // frame 0 differs, then frames 1..200 equal their predecessor: frames 0..200 are one picture, 201 frames = 6.7 s
  const held = [false, ...heldRun(200)];
  const timeline = buildTimeline({ shots: [{ id: 'a', hold: 4 }, { id: 'b', hold: 4 }, { id: 'last', hold: 1 }] }, { fps: FPS });
  const found = stillStretches({ held: [...held, ...Array(timeline.frameCount - held.length).fill(false)], timeline, maxStillSeconds: 6 });
  assert.equal(found.length, 1);
  assert.equal(found[0].shot, 'a');
  assert.ok(found[0].seconds > 6);
  const exact = [false, ...heldRun(179), ...Array(timeline.frameCount - 180).fill(false)]; // 180 frames = exactly 6 s
  assert.deepEqual(stillStretches({ held: exact, timeline, maxStillSeconds: 6 }), []);
});

test('the film final shot may hold still', () => {
  const timeline = buildTimeline({ shots: [{ id: 'a', hold: 1 }, { id: 'last', hold: 10 }] }, { fps: 30 });
  const held = Array.from({ length: timeline.frameCount }, (_, i) => i >= 31);
  assert.deepEqual(stillStretches({ held, timeline, maxStillSeconds: 3 }), []);
});

test('a still stretch is reported against the shot it starts in, with its start and length', () => {
  const timeline = buildTimeline({ shots: [{ id: 'a', hold: 1 }, { id: 'b', hold: 8 }, { id: 'last', hold: 1 }] }, { fps: 30 });
  const held = Array.from({ length: timeline.frameCount }, (_, i) => i > 31 && i < 31 + 200);
  const [only] = stillStretches({ held, timeline, maxStillSeconds: 3 });
  assert.equal(only.shot, 'b');
  assert.ok(Math.abs(only.start - 31 / 30) < 1e-9, `start ${only.start}`);
});

test('a still stretch that runs on into the final shot is counted only up to where the final shot starts', () => {
  const held = (timeline) => Array.from({ length: timeline.frameCount }, (_, i) => i > 0);
  const short = buildTimeline({ shots: [{ id: 'a', hold: 1 }, { id: 'last', hold: 8 }] }, { fps: 30 });
  assert.deepEqual(stillStretches({ held: held(short), timeline: short, maxStillSeconds: 3 }), [], 'one second of it is outside the final shot');
  const long = buildTimeline({ shots: [{ id: 'a', hold: 4 }, { id: 'last', hold: 1 }] }, { fps: 30 });
  const [found] = stillStretches({ held: held(long), timeline: long, maxStillSeconds: 3 });
  assert.equal(found.seconds, 4);
});

// ---- the sheet layout ----

test('a sheet is at most 2400 px wide, tiles keep the film shape and never exceed the frame, the phone tile is 360 wide', () => {
  const tiles = [...Array.from({ length: 5 }, (_, i) => ({ frame: i, label: `a ${i}` })), { frame: 4, label: 'phone', width: 360 }];
  for (const canvas of [{ w: 1920, h: 1080 }, { w: 1080, h: 1920 }, { w: 1080, h: 1080 }, { w: 3840, h: 2160 }]) {
    const { width, height, placements } = layoutSheet({ tiles, canvas, columns: shotColumns(canvas) });
    assert.ok(width <= 2400, `${canvas.w}x${canvas.h}: ${width}`);
    assert.equal(placements.at(-1).w, 360);
    for (const p of placements) {
      assert.ok(p.w <= canvas.w && Math.abs(p.h - p.w * (canvas.h / canvas.w)) <= 1, 'film shape');
      assert.ok(p.x >= 0 && p.y >= 0 && p.x + p.w <= width && p.y + p.h <= height, 'inside the sheet');
    }
    placements.forEach((a, i) => placements.slice(i + 1).forEach((b) => {
      assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, 'tiles do not overlap');
    }));
  }
});

test('a cut strip puts its 5 frames in one row', () => {
  const tiles = Array.from({ length: 5 }, (_, i) => ({ frame: i, label: `c ${i}` }));
  const { placements, width } = layoutSheet({ tiles, canvas: { w: 1920, h: 1080 }, columns: CUT_COLUMNS });
  assert.equal(new Set(placements.map((p) => p.y)).size, 1);
  assert.ok(width <= 2400);
});

// ---- the sheet plan ----

const film = (shots) => ({ mode: 'pro', look: 'desk', fps: 30, shots });

test('a shot sheet tiles start+0.1, a frame every 1.2 s after it, the middle, 85% and each on event landing+0.05, then the phone tile', () => {
  const f = film([
    { id: 'a', hold: 4, show: 'free' },
    { id: 'b', hold: 4, show: 'free', on: [{ at: 1, do: 'circle' }, { at: 'end', do: 'underline' }] },
  ]);
  const timeline = buildTimeline(f, { fps: 30 });
  const sheets = planSheets(f, timeline);
  const shot = sheets.find((s) => s.name === 'b.png');
  // b runs 4 s to 8 s: start + 0.1 = 123, landing 1 s + 0.05 = 152, steps 5.3 s = 159, 6.5 s = 195, 7.7 s = 231,
  // middle = 180, 85% = 222, 'end' + 0.05 clamps to 239
  assert.deepEqual(shot.tiles.map((x) => [x.role, x.frame]), [
    ['frame', 123], ['landing', 152], ['frame', 159], ['frame', 180], ['frame', 195], ['frame', 222], ['frame', 231], ['landing', 239], ['phone', 222],
  ]);
  assert.ok(shot.tiles.every((x) => Math.abs(x.t - x.frame / 30) < 1e-9), 'a tile is stamped with the time of the frame it shows');
  const phone = shot.tiles.at(-1);
  assert.equal(phone.width, 360);
  assert.ok(shot.tiles.every((x) => x.label.startsWith('b · ') && x.label.endsWith('s')));
  assert.equal(phone.label, 'b · 7.40s');
});

test('tiles at the same frame are listed once, and a landing past the shot end clamps to its last frame', () => {
  const f = film([{ id: 'a', hold: 1, show: 'free', on: [{ at: 0.05, do: 'circle' }, { at: 'end', do: 'circle' }] }]);
  const sheet = planSheets(f, buildTimeline(f, { fps: 30 })).find((s) => s.name === 'a.png');
  const frames = sheet.tiles.filter((x) => x.role !== 'phone').map((x) => x.frame);
  assert.equal(new Set(frames).size, frames.length);
  assert.deepEqual(frames, [3, 15, 26, 29], 'start + 0.1 = landing 0.05 + 0.05, so one tile');
});

test('no two tiles of a shot sheet are more than 1.2 s apart, and the last is within 1.2 s of the shot end', () => {
  const f = film([{ id: 'a', hold: 7, show: 'free' }]);
  const timeline = buildTimeline(f, { fps: 30 });
  const sheet = planSheets(f, timeline).find((s) => s.name === 'a.png');
  const times = sheet.tiles.filter((x) => x.role !== 'phone').map((x) => x.t);
  assert.ok(times[0] <= 0.1 + 1e-9, 'starts at start + 0.1 s');
  times.slice(1).forEach((t, k) => assert.ok(t - times[k] <= 1.2 + 1e-9, `${times[k]} to ${t}`));
  assert.ok(7 - times.at(-1) <= 1.2, `last tile ${times.at(-1)}`);
});

test('each cut gets a strip of every frame of its window plus two frames each side, named cut-<from>-<to>.png', () => {
  const f = film([{ id: 'a', hold: 2, show: 'free' }, { id: 'b', hold: 2, show: 'free', cut: 'slide' }, { id: 'c', hold: 2, show: 'free' }]);
  const timeline = buildTimeline(f, { fps: 30 });
  const sheets = planSheets(f, timeline);
  const strip = sheets.find((s) => s.name === 'cut-a-b.png');
  // b starts on frame 60; the slide's window is 0.4 s, frames 60 to 71; two frames each side
  assert.deepEqual(strip.tiles.map((x) => x.frame), Array.from({ length: 16 }, (_, k) => 58 + k));
  assert.deepEqual(strip.tiles.map((x) => x.label.split(' ')[0]), ['a', 'a', ...Array(14).fill('b')]);
  // a hard cut's window is its first frame: frames 118 to 122
  assert.deepEqual(sheets.find((s) => s.name === 'cut-b-c.png').tiles.map((x) => x.frame), [118, 119, 120, 121, 122]);
  assert.ok(sheets.some((s) => s.name === 'cut-b-c.png'));
  assert.equal(sheets.filter((s) => s.name.startsWith('cut-')).length, 2);
  assert.deepEqual(sheets.map((s) => s.name).sort(), ['a.png', 'b.png', 'c.png', 'cut-a-b.png', 'cut-b-c.png']);
});

test('the audit moments are the sheet frames, one frame every 0.25 s and each shot last frame, without duplicates, in order', () => {
  const f = film([{ id: 'a', hold: 3, show: 'free' }, { id: 'b', hold: 2, show: 'free', cut: 'slide' }]);
  const timeline = buildTimeline(f, { fps: 30 });
  const moments = auditMoments(f, timeline);
  assert.deepEqual(moments, [...new Set(moments)].sort((p, q) => p - q));
  for (let quarter = 0; quarter < 20; quarter++) assert.ok(moments.includes(Math.round(quarter * 0.25 * 30)), `${quarter * 0.25}s`);
  assert.ok(moments.includes(Math.round(0.1 * 30)), 'start + 0.1 s from the sheet');
  assert.ok(moments.includes(89) && moments.includes(149), 'the last frame of each shot');
  assert.ok(moments.includes(0) && moments.includes(90), 'the first frame of each shot');
  assert.ok(moments.every((m) => Number.isInteger(m) && m >= 0 && m < timeline.frameCount));
});

test('every on landing + 0.05 s is audited, also inside a cut window, and a shot shorter than its cut is audited at its last frame', () => {
  const f = film([
    { id: 'a', hold: 2, show: 'free' },
    { id: 'b', hold: 1, show: 'free', cut: 'slide', on: [{ at: 0.1, do: 'circle' }] }, // slide takes 0.4 s: 0.15 s is inside it
  ]);
  const timeline = buildTimeline(f, { fps: 30 });
  const moments = auditMoments(f, timeline);
  assert.ok(moments.includes(Math.round((2 + 0.15) * 30)), 'the landing at 0.15 s into b');
  assert.ok(moments.includes(Math.round(3 * 30) - 1), 'the last frame of b');
});

test('sheet names stay unique, also when a renamed strip would land on another shot name', () => {
  const f = film([
    { id: 'a', hold: 1, show: 'free' }, { id: 'b', hold: 1, show: 'free' },
    { id: 'cut-a-b', hold: 1, show: 'free' }, { id: 'cut-a-b-2', hold: 1, show: 'free' },
  ]);
  const names = planSheets(f, buildTimeline(f, { fps: 30 })).map((s) => s.name);
  assert.equal(new Set(names).size, names.length, names.join(', '));
  assert.ok(names.includes('cut-a-b.png') && names.includes('cut-a-b-2.png'), 'the shots keep their own names');
});

// ---- the audit plan, session findings, finding paths ----

import { describeError, reportOf } from '../../scripts/v2/report.mjs';

test('a frame inside a cut window is audited for the incoming shot alone; a frame outside it for the whole picture', () => {
  const f = film([{ id: 'a', hold: 2, show: 'free' }, { id: 'b', hold: 1, show: 'free', cut: 'slide' }]);
  const timeline = buildTimeline(f, { fps: 30 });
  const plan = new Map(auditPlan(f, timeline).map(([shot, frame]) => [frame, shot]));
  assert.equal(plan.get(60), 1, 'the first frame of b, on the slide cut');
  assert.equal(plan.get(68), 1, 'the quarter-second frame inside the 0.4 s window');
  assert.equal(plan.get(75), -1, 'after the window');
  assert.equal(plan.get(30), -1, 'inside a');
  assert.equal(plan.get(89), -1, 'the last frame of b, long after the window');
  const hard = film([{ id: 'a', hold: 2, show: 'free' }, { id: 'b', hold: 1, show: 'free' }]);
  assert.ok([...new Map(auditPlan(hard, buildTimeline(hard, { fps: 30 }))).keys()].every((shot) => shot === -1), 'a hard cut has no window');
});

test('a finding about a text points at the spec field that holds it, with the shot id alongside', () => {
  const at = (role, node, extra = {}) => ({ shot: 's2', t: 1, finding: { kind: 'mechanical', path: 'shots[1]', message: 'm', rule: 'r', node, role, ...extra } });
  const shots = [{ id: 's1' }, { id: 's2', say: 'hi', text: 'Hello', kicker: 'k', label: 'l', delta: '+1', prefix: '$', suffix: 'm', value: 5, caption: 'c' }];
  const path = (item) => dedupeFindings([item], shots)[0].path;
  assert.equal(path(at('kicker', 's2.kicker')), 'shots[1].kicker');
  assert.equal(path(at('hero', 's2.text')), 'shots[1].text');
  assert.equal(path(at('label', 's2.label')), 'shots[1].label');
  assert.equal(path(at('tag', 's2.delta')), 'shots[1].delta');
  assert.equal(path(at('affix', 's2.value.prefix')), 'shots[1].prefix');
  assert.equal(path(at('affix', 's2.value.suffix')), 'shots[1].suffix');
  assert.equal(path(at('caption', 's2.caption')), 'shots[1].caption');
  assert.equal(path(at('body', 'x')), 'shots[1]', 'a text with no field of its own');
  assert.equal(dedupeFindings([at('hero', 'h')], [{ id: 's1' }, { id: 's2', say: 'hi' }])[0].path, 'shots[1].say', 'a hero with only a say');
  assert.equal(dedupeFindings([at('kicker', 'k')], [{ id: 's1' }, { id: 's2' }])[0].path, 'shots[1]', 'a field the shot does not have');
  assert.equal(dedupeFindings([at('hero', 'h')], shots)[0].shot, 's2');
});

test('session findings: page errors, blocked requests and a failed post pass are findings; a clean session has none', () => {
  assert.deepEqual(sessionFindings({ info: { post: 'webgl2' }, errors: [], blocked: [] }), []);
  const found = sessionFindings({ info: { post: 'webgl2' }, errors: ['boom', 'boom', 'second'], blocked: ['http://example.com/x'] });
  assert.deepEqual(found.map((f) => [f.kind, f.message, f.path, f.shot]), [
    ['mechanical', 'page: boom', '', null], ['mechanical', 'page: second', '', null], ['mechanical', 'page: request blocked: http://example.com/x', '', null],
  ]);
});

test('describeError splits "what. how to fix" and gives a hint to the errors that carry none', () => {
  assert.deepEqual(describeError(new Error('ffmpeg not found. Install it (brew install ffmpeg)')), { message: 'ffmpeg not found', hint: 'Install it (brew install ffmpeg)' });
  assert.equal(describeError(new Error('cannot read x.json: ENOENT')).hint.includes('existing film'), true);
  assert.deepEqual(describeError(new Error('line one\nline two')), { message: 'line one', hint: '' });
  assert.deepEqual(describeError('plain'), { message: 'plain', hint: '' });
});

test('a report has the same keys whatever stopped the run, and ok needs a valid film, no error and no mechanical finding', () => {
  const base = { validated: true, error: null, stages: [], findings: [], sheets: [], output: null, timed: null, post: null, capture: null, frames: 0, captured: 0, seconds: null, msPerFrame: null, bytes: null, mbps: null };
  const keys = Object.keys(reportOf(base)).sort();
  assert.deepEqual(keys, ['bytes', 'captured', 'capture', 'findings', 'frames', 'mbps', 'msPerFrame', 'ok', 'output', 'post', 'seconds', 'sheets', 'stages', 'timed'].sort());
  assert.equal(reportOf(base).ok, true);
  assert.equal(reportOf({ ...base, validated: false }).ok, false);
  assert.equal(reportOf({ ...base, findings: [{ kind: 'creative' }] }).ok, true);
  assert.equal(reportOf({ ...base, findings: [{ kind: 'mechanical' }] }).ok, false);
  const withError = reportOf({ ...base, error: { message: 'm', hint: 'h' } });
  assert.deepEqual([withError.ok, withError.error], [false, { message: 'm', hint: 'h' }]);
});

// ---- the director's round 1: overflow, word overlap, the viral hook ----

test('an overflow message states the size it stopped at and names the widest word', () => {
  const node = textNode({ id: 'hook.text', size: 96, words: 3, word: 'DASHBOARDS', overflow: true });
  node.layout.lines[0].words[1] = { ...node.layout.lines[0].words[1], text: 'HIDING', width: 120 };
  const [found] = auditFrame([node], ctx()).filter((f) => f.rule === 'overflow');
  assert.match(found.message, /does not fit even at the smallest size its kind allows, 96 units/);
  assert.match(found.message, /widest word is "DASHBOARDS" \(192 units wide\)/);
  assert.doesNotMatch(found.message, /28-unit/);
});

test('no frame may have a word overlapping its neighbour on the line', () => {
  const node = textNode({ id: 'line', size: 132, x: 200, y: 400, words: 3, perLine: 3 }); // words 264 wide at x 0, 264, 528: touching
  assert.deepEqual(auditFrame([node], ctx()).filter((f) => f.rule === 'word-overlap'), []);
  const pulsing = { ...node, words: node.words.map((w, i) => (i === 1 ? { ...w, scale: 1.12 } : w)) };
  const [found] = auditFrame([pulsing], ctx()).filter((f) => f.rule === 'word-overlap');
  assert.equal(found.kind, 'mechanical');
  assert.match(found.message, /the word "word" overlaps "word" by 15\.8 units/);
  const gap = textNode({ id: 'line', size: 132, x: 200, y: 400, words: 3, perLine: 3 });
  gap.layout.lines[0].words.forEach((w, i) => { w.x = i * 300; });
  assert.deepEqual(auditFrame([{ ...gap, words: gap.words.map((w, i) => (i === 1 ? { ...w, scale: 1.12 } : w)) }], ctx()).filter((f) => f.rule === 'word-overlap'), [], 'a 36 unit gap absorbs the pulse');
  const hidden = { ...pulsing, words: pulsing.words.map((w, i) => (i !== 1 ? { ...w, opacity: 0 } : w)) };
  assert.deepEqual(auditFrame([hidden], ctx()).filter((f) => f.rule === 'word-overlap'), [], 'words that are not on screen overlap nothing');
});

test('the first shot of a viral film must show all its text on frame 0; a pro film is not held to it', () => {
  const tree = (opacities) => [{ ...textNode({ id: 'hook', words: opacities.length }), props: { role: 'hero' }, words: opacities.map((opacity) => ({ opacity, x: 0, y: 0, scale: 1 })) }];
  const film = (mode, show = 'statement') => ({ mode, shots: [{ id: 'hook', show }] });
  const at = (opacities) => [{ frame: 0, tree: tree(opacities) }];
  assert.deepEqual(hookFindings(film('viral'), {}, at([1, 1, 1])), []);
  const [found] = hookFindings(film('viral'), {}, at([1, 0, 0]));
  assert.deepEqual([found.kind, found.path, found.shot, found.t], ['mechanical', 'shots[0]', 'hook', 0]);
  assert.match(found.message, /2 of its 3 words are not on screen yet/);
  assert.deepEqual(hookFindings(film('pro'), {}, at([1, 0, 0])), []);
  assert.deepEqual(hookFindings(film('viral', 'number'), {}, at([1, 0, 0])), [], 'only a statement is a line of text to read');
});

// ---- revision 1: the emphasis span ----

test('a highlight run that spans more than one line is a creative finding at the text', () => {
  const spread = { ...textNode({ id: 'p.text', size: 132, words: 4, perLine: 2, role: 'hero' }) };
  const marked = { ...spread, props: { ...spread.props, highlightLines: 2 } };
  const found = auditFrame([marked], ctx()).filter((f) => f.rule === 'highlight-lines');
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, 'creative');
  assert.equal(found[0].message, 'one highlight runs across 2 lines; mark fewer words');
  assert.deepEqual(auditFrame([{ ...spread, props: { ...spread.props, highlightLines: 1 } }], ctx()).filter((f) => f.rule === 'highlight-lines'), []);
});

// ---- revision 1: the stack, measured horizontal ink ----

// Lines of one stack: text nodes inside a group, each at its own size, tagged with the stack's id.
const stackLine = (k, size, y, words = 2) => {
  const n = textNode({ id: `s.line${k}`, size, x: 200, y, words, role: 'hero' });
  return { ...n, props: { ...n.props, stack: 's' } };
};

test('in a stack, the lines of one text count as one size class for the sizes and hero rules', () => {
  const lines = [stackLine(0, 300, 100), stackLine(1, 200, 450), stackLine(2, 150, 720, 1)];
  const group = { type: 'group', id: 's', depth: 0, props: {}, x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, visible: true, children: lines, bbox: [0, 0, 0, 0] };
  const tag = textNode({ id: 'k', size: 56, x: 200, y: 20, words: 1, role: 'tag' });
  const findings = auditFrame([group, tag], ctx({ look: registries.looks.get('pop'), mode: 'viral', canvas: CANVAS }));
  assert.deepEqual(findings.filter((f) => f.rule === 'sizes' || f.rule === 'hero'), [], 'three line sizes plus a tag is two classes, and the stack is the hero');
  // the same three sizes as separate texts are still judged as three
  const loose = lines.map((n) => ({ ...n, props: { role: 'hero' } }));
  const spread = auditFrame([...loose, textNode({ id: 'x', size: 60, x: 200, y: 980, words: 1 })], ctx({ look: registries.looks.get('pop'), mode: 'viral' }));
  assert.ok(spread.some((f) => f.rule === 'sizes'), 'four separate sizes are still a finding');
});

test('the viral hook rule counts every word of a stack, not only its largest line', () => {
  const lines = [stackLine(0, 300, 100, 3), stackLine(1, 200, 450, 3), stackLine(2, 150, 720, 2)];
  const group = { type: 'group', id: 's', depth: 0, props: {}, x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, visible: true, children: lines, bbox: [0, 0, 0, 0] };
  const findings = auditFrame([group], ctx({ look: registries.looks.get('pop'), mode: 'viral', isFirstShot: true }));
  const hook = findings.find((f) => f.rule === 'hook-words');
  assert.ok(hook, 'eight words in the opening stack');
  assert.match(hook.message, /has 8 words/);
});

test('a line set flush by its ink is inside the safe area when its measured ink is: lineInk left and right', () => {
  const safe = safeRectFor(CANVAS, registries.looks.get('desk'));
  const n = textNode({ id: 't', size: 132, x: safe.left - 6, y: 300, words: 2 });
  assert.ok(auditFrame([n], ctx()).some((f) => f.rule === 'safe-area'), 'by its advance box the line starts 6 px outside');
  const width = n.layout.lines[0].words[0].width;
  const measured = { ...n, lineInk: [{ ascent: 0.7 * 132, descent: 0, words: [{ left: 8, right: width - 8 }, { left: 8, right: width - 8 }] }] };
  assert.deepEqual(auditFrame([measured], ctx()).filter((f) => f.rule === 'safe-area'), [], 'its ink starts 8 px in: inside');
});

test('a text flush on the safe edge is inside: the safe-area rule allows 1 unit, and a punch on its way home is not judged', () => {
  const safe = safeRectFor(CANVAS, registries.looks.get('desk'));
  const at = (dx, scale = 1) => {
    const n = textNode({ id: 'edge', size: 132, x: safe.left + dx, y: 300, words: 1 });
    return auditFrame([{ ...n, scale, bbox: [n.bbox[0], n.bbox[1], n.bbox[2] * scale, n.bbox[3] * scale] }], ctx({ restScales: new Map([['edge', 1]]) })).filter((f) => f.rule === 'safe-area').length;
  };
  assert.equal(at(0), 0, 'flush on the edge');
  assert.equal(at(-0.8), 0, 'within a unit of it (a punch at 0.2 percent moves a flush line this far)');
  assert.equal(at(-2), 1, 'two units out is outside');
  assert.equal(at(-20, 1.015), 0, 'a camera punch at 1.5 percent is a move in progress');
});

// ---- revision 2: frame furniture (the lead's ruling) ----

// A text inside a slug card or a caption card: props.furniture, set by the kind.
const furnitureText = (opts) => {
  const n = textNode(opts);
  return { ...n, props: { ...n.props, furniture: true } };
};

test('frame furniture is left out of the sizes and hero rules: a desk count with its label at step 4 and a desk proof pass', () => {
  const at = (id, size, y, role) => textNode({ id, size, x: 200, y, words: 1, role });
  const slug = [furnitureText({ id: 'number', size: 72, x: 1500, y: 100, words: 1, role: 'slug' }), furnitureText({ id: 'kicker', size: 44, x: 1500, y: 220, words: 1, role: 'kicker' })];
  // the figure, the label at step 4, the delta at step 2 and the slug's numeral and kicker
  const count = [at('digits', 820, 40, 'hero'), at('label', 132, 650, 'label'), at('delta', 44, 960, 'tag'), ...slug];
  assert.deepEqual(auditFrame(count, ctx()).filter((f) => f.rule === 'sizes' || f.rule === 'hero'), []);
  // a clipping: only the slug and the caption card are text
  const proof = [...slug, furnitureText({ id: 'caption', size: 44, x: 200, y: 900, words: 1, role: 'caption' })];
  assert.deepEqual(auditFrame(proof, ctx()).filter((f) => f.rule === 'sizes' || f.rule === 'hero'), [], 'fewer than two texts remain: nothing to compare');
});

test('without the furniture mark the same texts are judged: a 72 against 44 frame fires the hero rule, and furniture under the size floor still fires', () => {
  const plain = [textNode({ id: 'number', size: 72, x: 1500, y: 100, words: 1, role: 'slug' }), textNode({ id: 'kicker', size: 44, x: 1500, y: 300, words: 1, role: 'kicker' })];
  assert.equal(auditFrame(plain, ctx()).filter((f) => f.rule === 'hero').length, 1, 'a 1.6 ratio fires');
  const tiny = furnitureText({ id: 'kicker', size: 20, x: 1500, y: 300, words: 1, role: 'kicker' });
  assert.equal(auditFrame([tiny], ctx()).filter((f) => f.rule === 'min-size').length, 1, 'furniture is still held to the size floor');
});

test('a text whose last frame catches the tail of a move is still judged at rest: the rest scale is the one it holds most', () => {
  // one shot of 1 s at 30 fps: the text rests at scale 1 and only the last frame catches a pulse at 1.01
  const timeline = { fps: 30, frameCount: 30, duration: 1, shots: [{ id: 'hero', index: 0, start: 0, end: 1, duration: 1 }] };
  const tree = (scale) => [textNode({ id: 't', size: 44, x: -40, y: 300, scale })]; // its ink runs past the left safe edge
  const snapshots = [0, 7, 15, 22, 29].map((frame) => ({ frame, tree: tree(frame === 29 ? 1.01 : 1) }));
  const resting = restingByShot(timeline, snapshots).get('hero');
  assert.ok(Math.abs(resting.restScales.get('t') - 1) < 1e-9, `the scale held on most sampled frames: ${resting.restScales.get('t')}`);
  const found = auditFrame(tree(1), ctx({ restScales: resting.restScales }));
  assert.ok(found.some((f) => f.rule === 'safe-area'), 'the at-rest layout is judged and the defect reported');
});

test('a text over the paper of a card that holds text (a slug or a caption card) is mechanical; the card\'s own texts and texts clear of it are not', () => {
  const paper = { type: 'path', id: 'a.slug.paper', depth: 0, props: { textCard: true, fill: '#ffffff' }, x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, visible: true, children: [], bbox: [1400, 100, 360, 200], spread: 0 };
  const own = textNode({ id: 'a.kicker', size: 44, x: 1440, y: 140, words: 1 });
  const slug = { type: 'group', id: 'a.slug', depth: 0, props: { fixed: true }, x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, visible: true, children: [paper, own], bbox: [1400, 100, 360, 200], spread: 0 };
  const over = textNode({ id: 'a.text', size: 132, x: 1200, y: 150, words: 2 }); // runs under the card
  const found = auditFrame([slug, over], ctx()).filter((f) => f.rule === 'card-overlap');
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.equal(found[0].kind, 'mechanical');
  assert.equal(found[0].node, 'a.text|a.slug');
  assert.match(found[0].message, /runs over the card/);
  const clear = textNode({ id: 'a.text', size: 132, x: 200, y: 500, words: 2 });
  assert.deepEqual(auditFrame([slug, clear], ctx()).filter((f) => f.rule === 'card-overlap'), [], 'the card\'s own text and a text clear of it');
  const hidden = { ...slug, opacity: 0 };
  assert.deepEqual(auditFrame([hidden, over], ctx()).filter((f) => f.rule === 'card-overlap'), [], 'a card not on screen');
});

test('a text whose words rest a hair off scale 1 (a move sampled before its end) is still judged at rest', () => {
  const timeline = { fps: 30, frameCount: 30, duration: 1, shots: [{ id: 'hero', index: 0, start: 0, end: 1, duration: 1 }] };
  // its words hold 1.004 on every sampled frame, and its ink runs past the left safe edge
  const tree = () => {
    const n = textNode({ id: 't', size: 44, x: -40, y: 300 });
    return [{ ...n, words: n.words.map((w) => ({ ...w, scale: 1.004 })) }];
  };
  const snapshots = [0, 7, 15, 22, 29].map((frame) => ({ frame, tree: tree() }));
  const resting = restingByShot(timeline, snapshots).get('hero');
  const found = auditFrame(tree(), ctx({ restScales: resting.restScales, restWords: resting.restWords }));
  assert.ok(found.some((f) => f.rule === 'safe-area'), `the at-rest layout is judged: ${JSON.stringify(found.map((f) => f.rule))}`);
  // a word still mid-pulse is not at rest
  const pulsing = tree().map((n) => ({ ...n, words: n.words.map((w, i) => (i === 0 ? { ...w, scale: 1.08 } : w)) }));
  assert.ok(!auditFrame(pulsing, ctx({ restScales: resting.restScales, restWords: resting.restWords })).some((f) => f.rule === 'safe-area'), 'a word mid-pulse');
});

// ---- look gate fix pass, review-rev2 I3: a text drawn under a picture is covered ----

// A picture (an image node) on screen, already measured.
const picture = (box, opacity = 1) => ({ type: 'image', id: 'pic', depth: 0, props: { w: box[2], h: box[3] }, x: box[0], y: box[1], scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity, visible: opacity > 0, children: [], bbox: box, spread: 0 });

test('a text drawn before a picture that covers its ink is mechanical (a pinned kicker left under the zoomed picture of a punch); a text drawn after it, or clear of it, is not', () => {
  const kicker = textNode({ id: 'c.kicker', size: 44, x: 300, y: 400, words: 2 });
  const over = picture([200, 350, 900, 600]);
  const found = auditFrame([kicker, over], ctx()).filter((f) => f.rule === 'covered');
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.equal(found[0].kind, 'mechanical');
  assert.equal(found[0].node, 'c.kicker|pic');
  assert.match(found[0].message, /is drawn under the picture/);
  assert.deepEqual(auditFrame([over, kicker], ctx()).filter((f) => f.rule === 'covered'), [], 'drawn over the picture');
  assert.deepEqual(auditFrame([kicker, picture([1200, 350, 400, 400])], ctx()).filter((f) => f.rule === 'covered'), [], 'clear of it');
  assert.deepEqual(auditFrame([kicker, picture([200, 350, 900, 600], 0)], ctx()).filter((f) => f.rule === 'covered'), [], 'a picture not on screen');
  // inside a group: the order is the order things are drawn in, children after their group
  const group = { type: 'group', id: 'g', depth: 0, props: {}, x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, visible: true, children: [over], bbox: over.bbox, spread: 0 };
  assert.equal(auditFrame([kicker, group], ctx()).filter((f) => f.rule === 'covered').length, 1, 'a picture inside a later group');
});

// ---- look gate fix pass, review-rev2 I1: the rest scale counts only frames where the text is on screen ----

test('the reviewer\'s case: a pop number whose say never names the figure lands its label and delta late, and they rest at their landed scale, not the 0.6 they held while hidden', () => {
  const shot = { id: 'n', show: 'number', say: 'More than you would think, and every one of them ships today.', value: 5, label: 'skills', delta: 'one file each' };
  const film = filmOf([shot], 'pop', '9:16');
  const timeline = buildTimeline(film, { fps: FPS });
  const movie = buildFilm({ film, timeline, measure, assets: IMAGES, canvas: canvasOf('9:16'), viralInsets: viralOf(canvasOf('9:16')) });
  const snapshots = auditMoments(film, timeline).map((frame) => ({ frame, tree: movie.sampleAt(frame / FPS) }));
  const resting = restingByShot(timeline, snapshots).get('n');
  const last = snapshots.at(-1).tree;
  const texts = (function find(nodes) { return nodes.flatMap((n) => [...(n.type === 'text' ? [n.id] : []), ...find(n.children)]); })(last);
  const late = texts.filter((id) => /^n\.(label|delta)/.test(id));
  assert.ok(late.length >= 2, `the label and delta texts: ${texts}`);
  for (const id of late) assert.ok(Math.abs(resting.restScales.get(id) - 1) < 1e-6, `${id} rests at ${resting.restScales.get(id)}`);
});

test('a text that lands late in its shot is judged at the scale it lands at, not the entrance scale it held while hidden', () => {
  const timeline = { fps: 30, frameCount: 30, duration: 1, shots: [{ id: 'hero', index: 0, start: 0, end: 1, duration: 1 }] };
  // hidden at the entrance's start scale on 3 sampled frames, then landed at 1 with its ink past the left safe edge
  const tree = (frame) => [frame < 20 ? textNode({ id: 't', size: 44, x: -40, y: 300, scale: 0.6, opacity: 0 }) : textNode({ id: 't', size: 44, x: -40, y: 300 })];
  const snapshots = [0, 7, 15, 22, 29].map((frame) => ({ frame, tree: tree(frame) }));
  const resting = restingByShot(timeline, snapshots).get('hero');
  assert.ok(Math.abs(resting.restScales.get('t') - 1) < 1e-9, `the scale held while on screen: ${resting.restScales.get('t')}`);
  const found = auditFrame(tree(29), ctx({ restScales: resting.restScales, restWords: resting.restWords }));
  assert.ok(found.some((f) => f.rule === 'safe-area'), `the landed layout is judged: ${JSON.stringify(found.map((f) => f.rule))}`);
});

test('a word that lands late is judged at the scale it lands at, not the scale it held while hidden', () => {
  const timeline = { fps: 30, frameCount: 30, duration: 1, shots: [{ id: 'hero', index: 0, start: 0, end: 1, duration: 1 }] };
  // the text is on screen throughout; its words are hidden at an entrance scale of 0.6 until frame 20
  const tree = (frame) => {
    const n = textNode({ id: 't', size: 44, x: -40, y: 300 });
    return [{ ...n, words: n.words.map((w) => (frame < 20 ? { ...w, opacity: 0, scale: 0.6 } : w)) }];
  };
  const snapshots = [0, 7, 15, 22, 29].map((frame) => ({ frame, tree: tree(frame) }));
  const resting = restingByShot(timeline, snapshots).get('hero');
  assert.deepEqual(resting.restWords.get('t'), [1, 1, 1], 'each word rests at the scale it holds once shown');
  const found = auditFrame(tree(29), ctx({ restScales: resting.restScales, restWords: resting.restWords }));
  assert.ok(found.some((f) => f.rule === 'safe-area'), `the landed words are judged: ${JSON.stringify(found.map((f) => f.rule))}`);
  // a text never fully shown on a sampled frame falls back to its last frame
  const never = restingByShot(timeline, [0, 29].map((frame) => ({ frame, tree: [textNode({ id: 't', scale: 0.9, opacity: 0.5 })] }))).get('hero');
  assert.ok(Math.abs(never.restScales.get('t') - 0.9) < 1e-9, 'the last frame\'s scale');
});

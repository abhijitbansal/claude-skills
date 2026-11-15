// Final wave I1 and I2. I1: a text on screen in a shot that is at rest on no sampled frame is a mechanical finding
// ("never settles within the shot") instead of escaping every layout rule. I2: a word visible on a sampled frame is
// judged on it; a word is left out only on the frames where it is at opacity 0. Pure: hand-built snapshots and films
// built in Node with the fake measure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/looks/index.mjs';
import '../../engine/modes/index.mjs';
import { auditFrame } from '../../engine/review/frame.mjs';
import { auditMoments } from '../../scripts/v2/plan.mjs';
import { safeRectFor, restingByShot, settleFindings } from '../../scripts/v2/review.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { buildFilm } from '../../engine/graph/film.mjs';
import { annotate } from '../../engine/page/bounds.mjs';
import { FPS, measure, IMAGES, canvasOf, viralOf, filmOf } from './helpers/kinds.mjs';

const CANVAS = { w: 1920, h: 1080 };
const ctx = (extra = {}) => {
  const base = { look: registries.looks.get('desk'), canvas: CANVAS, mode: 'pro', shotId: 'hero', shotIndex: 0, t: 0.5, ...extra };
  return { safe: safeRectFor(base.canvas, base.look), ...base };
};
// One shot of 1 s at 30 fps, sampled at five frames; and a film around it for the settle rule's frame context.
const TIMELINE = { fps: 30, frameCount: 30, duration: 1, shots: [{ id: 'hero', index: 0, start: 0, end: 1, duration: 1 }] };
const FILM = { version: 2, mode: 'pro', look: 'desk', format: '16:9', fps: 30, shots: [{ id: 'hero', show: 'free', hold: 1 }] };
const FRAMES = [0, 7, 15, 22, 29];

// A text node as annotate() reports it (the shape review.test.mjs builds): 96 px words 192 px apart, one line.
function textNode({ id = 't', x = 200, y = 400, words = 3, opacity = 1, wordOpacity = () => 1 } = {}) {
  const size = 96, width = words * size * 2, height = size * 1.15;
  const line = { x: 0, y: size * 0.9, width, words: Array.from({ length: words }, (_, k) => ({ text: 'word', index: k, x: k * size * 2, width: size * 2 })) };
  return {
    type: 'text', id, depth: 0, props: {}, x, y, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity, visible: opacity > 0, children: [],
    words: Array.from({ length: words }, (_, k) => ({ opacity: wordOpacity(k), x: 0, y: 0, scale: 1 })),
    layout: { size, width, height, overflow: false, lines: [line] }, bbox: [x, y, width, height], spread: 0,
  };
}
const snapshotsOf = (tree) => FRAMES.map((frame) => ({ frame, tree: tree(frame), whole: true }));
// settleFindings gives { shot, t, finding } items (as dedupeFindings takes them); flattened here
const flat = (items) => items.map(({ shot, t, finding }) => ({ shot, t, ...finding }));
const settle = (snapshots) => flat(settleFindings(FILM, TIMELINE, restingByShot(TIMELINE, snapshots), snapshots));

// ---- I2 ----

test('I2: a word shown on some frames and gone on the last is judged on the frames where it shows', () => {
  // x 1400: words 0 and 1 sit inside the safe area, word 2 (1784 to 1976) runs past the right edge; word 2 leaves at frame 20
  const tree = (frame) => [textNode({ x: 1400, wordOpacity: (k) => (k === 2 && frame >= 20 ? 0 : 1) })];
  const resting = restingByShot(TIMELINE, snapshotsOf(tree)).get('hero');
  const found = auditFrame(tree(7), ctx({ ...resting }));
  assert.deepEqual(found.map((f) => f.rule), ['safe-area'], 'on screen at frame 7, outside the safe area');
  assert.deepEqual(auditFrame(tree(29), ctx({ ...resting })).filter((f) => f.rule === 'safe-area'), [], 'gone at frame 29: not in the ink');
});

test('I2: the words at opacity 0 on a frame are not waited for: a count is judged by the step it shows', () => {
  // three steps of a count, one shown at a time; the shown one is outside the safe area
  const tree = (frame) => [textNode({ x: 1400, words: 3, wordOpacity: (k) => (k === Math.min(2, Math.floor(frame / 10)) ? 1 : 0) })];
  const resting = restingByShot(TIMELINE, snapshotsOf(tree)).get('hero');
  assert.ok(auditFrame(tree(29), ctx({ ...resting })).some((f) => f.rule === 'safe-area'));
  assert.deepEqual(settle(snapshotsOf(tree)), [], 'it lands on its steps');
});

// ---- M5: the size floor counts a word's own rest scale ----

test('M5: a word resting at half scale is judged at half size: a 44 px text whose words rest at 0.5 is under the floor', () => {
  const half = (frame) => {
    const n = textNode({ x: 300 });
    return [{ ...n, layout: { ...n.layout, size: 44 }, words: n.words.map((w) => ({ ...w, scale: 0.5 })), frame }];
  };
  const resting = restingByShot(TIMELINE, snapshotsOf(half)).get('hero');
  const found = auditFrame(half(29), ctx({ ...resting })).filter((f) => f.rule === 'min-size');
  assert.equal(found.length, 1, 'about 22 units against a floor of 28');
  const full = (frame) => [{ ...textNode({ x: 300 }), frame }];
  assert.deepEqual(auditFrame(full(29), ctx({ ...restingByShot(TIMELINE, snapshotsOf(full)).get('hero') })).filter((f) => f.rule === 'min-size'), [], '96 px at scale 1');
});

// ---- I1 ----

test('I1: a text that never reaches full opacity is a mechanical finding, though no layout rule could judge it', () => {
  const tree = () => [textNode({ x: -400, opacity: 0.9 })];
  const snapshots = snapshotsOf(tree);
  assert.deepEqual(auditFrame(tree(), ctx(restingByShot(TIMELINE, snapshots).get('hero'))).filter((f) => f.kind === 'mechanical'), [], 'no frame judges it');
  const found = settle(snapshots);
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.deepEqual([found[0].kind, found[0].rule, found[0].node, found[0].shot], ['mechanical', 'unsettled', 't', 'hero']);
  assert.match(found[0].message, /text "t" never settles within the shot/);
});

test('I1: a text at rest on one sampled frame, or never on screen, has no settle finding', () => {
  assert.deepEqual(settle(snapshotsOf((frame) => [textNode({ opacity: frame === 22 ? 1 : 0.5 })])), [], 'at rest on frame 22');
  assert.deepEqual(settle(snapshotsOf(() => [textNode({ opacity: 0 })])), [], 'never on screen');
  assert.deepEqual(settle(snapshotsOf(() => [textNode({ wordOpacity: () => 0 })])), [], 'every word hidden');
});

test('I1, the reviewer\'s case: a desk number held 1 s lands its label and delta after the shot ends; both are findings', () => {
  const film = filmOf([{ id: 'n', show: 'number', hold: 1, value: 5, label: 'rows', delta: '+1' }], 'desk', '16:9');
  const timeline = buildTimeline(film, { fps: FPS });
  const movie = buildFilm({ film, timeline, measure, assets: IMAGES, canvas: canvasOf('16:9'), viralInsets: viralOf(canvasOf('16:9')) });
  // annotated as the page's __snapshot does it (boxes and layouts), with the fake measure's layout
  const snapshots = auditMoments(film, timeline).map((frame) => ({ frame, tree: annotate(movie.sampleAt(frame / FPS)), whole: true }));
  const found = flat(settleFindings(film, timeline, restingByShot(timeline, snapshots), snapshots));
  assert.deepEqual(found.map((f) => [f.rule, f.node]).sort(), [['unsettled', 'n.delta.text'], ['unsettled', 'n.label']]);
  assert.ok(found.every((f) => f.kind === 'mechanical' && f.path.startsWith('shots[0]')));
});

// The match carries the shared node visibly from its old place and size to its new one while the rest crossfades, and
// says so when the two shots share nothing (look review gate-cuts-1 D1; lead ruling 2). Pure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/cuts/index.mjs';
import { matchFindings } from '../../scripts/v2/review.mjs';
import { readFileSync } from 'node:fs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { resolveCut } from '../../engine/cuts/resolve.mjs';
import { filmFor } from './helpers/kinds.mjs';

const FPS = 30;
const DESK_FILM = new URL('../../references/examples/v2/cuts-desk.json', import.meta.url);

const CANVAS = { w: 1920, h: 1080 };
const LEGIBLE = 0.2; // a copy at or under this opacity does not read as words over the other one
const words = (text) => Object.freeze({ lines: Object.freeze([Object.freeze({ words: Object.freeze(text.split(' ').map((w) => Object.freeze({ text: w }))) })]) });
const text = (id, say, x, y, scale, bbox) => Object.freeze({
  type: 'text', id, depth: 0, props: Object.freeze({ layout: words(say) }), bbox,
  x, y, scale, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, draw: 1, reveal: 1, blur: 0, visible: true, children: Object.freeze([]),
});
const field = Object.freeze({ ...text('field', 'paper', 0, 0, 1, [0, 0, 1920, 1080]), type: 'path', depth: 1 });
// the outgoing line big and high on the left, the incoming one smaller and low on the right: unlike words
const OLD = text('line', 'Every shot has to end somewhere', 300, 300, 1, [200, 250, 800, 200]);
const NEW = text('line', 'A match carries one line across the cut', 1100, 800, 0.5, [1000, 760, 600, 100]);
const FROM = [field, OLD, text('open.kicker', 'Between shots', 200, 150, 1, [200, 120, 300, 60])];
const TO = [field, NEW, text('carry.kicker', 'Match', 1000, 700, 1, [1000, 680, 200, 60])];
const centre = (b) => [b[0] + b[2] / 2, b[1] + b[3] / 2];
const at = (p) => registries.cuts.get('match').apply({ from: FROM, to: TO, p, canvas: CANVAS });
const copies = (frame) => frame.find((n) => n.id === 'line').children;
const STEPS = Array.from({ length: 19 }, (_, k) => (k + 1) / 20);

test('match: unlike shared heroes ride one path from the old place and size to the new one', () => {
  const [a0, b0] = [centre(OLD.bbox), centre(NEW.bbox)];
  const half = copies(at(0.5));
  const visible = half.reduce((best, n) => (n.opacity > best.opacity ? n : best));
  // the visible copy's origin moved: neither where it started nor where it ends
  const moved = visible.id === 'line.from' ? [visible.x - OLD.x, visible.y - OLD.y] : [visible.x - NEW.x, visible.y - NEW.y];
  assert.ok(Math.hypot(...moved) > 100, `the carried copy moved ${JSON.stringify(moved)} px`);
  const k = visible.id === 'line.from' ? visible.scale / OLD.scale : visible.scale / NEW.scale;
  assert.ok(Math.abs(k - 1) > 0.05, `its size changes on the way (factor ${k})`);
  // early the outgoing copy is near the old place, late the incoming one near the new place
  const early = copies(at(0.05)).find((n) => n.id === 'line.from');
  const late = copies(at(0.95)).find((n) => n.id === 'line.to');
  assert.ok(Math.hypot(early.x - OLD.x, early.y - OLD.y) < 0.1 * Math.hypot(b0[0] - a0[0], b0[1] - a0[1]));
  assert.ok(Math.hypot(late.x - NEW.x, late.y - NEW.y) < 0.1 * Math.hypot(b0[0] - a0[0], b0[1] - a0[1]));
});

test('match: the two heroes are never both legible; the copy that shows hands over at the middle', () => {
  for (const p of STEPS) {
    const [from, to] = ['line.from', 'line.to'].map((id) => copies(at(p)).find((n) => n.id === id).opacity);
    assert.ok(Math.min(from, to) <= LEGIBLE, `p ${p}: outgoing ${from}, incoming ${to}`);
  }
});

test('match: the rest of the two shots never stands on screen at once (no 01 over 02)', () => {
  for (const p of STEPS) {
    const frame = at(p);
    const [out, into] = ['open.kicker', 'carry.kicker'].map((id) => frame.find((n) => n.id === id)?.opacity ?? 0);
    assert.ok(Math.min(out, into) <= LEGIBLE, `p ${p}: outgoing kicker ${out}, incoming kicker ${into}`);
  }
});

// ---- two lines of type: the line itself travels, by its type size and where its first line starts ----

// Round 2 ruling 2: the desk film's two statements reflow into boxes of nearly the same area and centre, so a carry by
// box moved the slot about 20 px and never showed the type shrinking. A line of type is carried by its type size and by
// where its first line starts (the place a reader's eye is), so the old line visibly shrinks and moves into the new one.
const typeLine = (id, say, x, y, size, firstY) => Object.freeze({
  ...text(id, say, x, y, 1, [x, y, 900, 500]),
  props: Object.freeze({ layout: Object.freeze({ ...words(say), size, lines: Object.freeze([Object.freeze({ ...words(say).lines[0], x: 0, y: firstY })]) }) }),
});
const BIG = typeLine('line', 'Every shot has to end somewhere', 236, 273, 172, 150);
const SMALL = typeLine('line', 'A match carries one line across the cut', 237, 322, 104, 90);
const lineAt = (from, to, p) => registries.cuts.get('match').apply({ from: [field, from], to: [field, to], p, canvas: CANVAS }).find((n) => n.id === 'line').children;
const visibleOf = (copies) => copies.reduce((best, n) => (n.opacity > best.opacity ? n : best));
// the type size a copy shows and where its first line starts on the canvas
const shownSize = (n) => n.scale * n.props.layout.size;
const anchorOf = (n) => [n.x + n.props.layout.lines[0].x * n.scale, n.y + n.props.layout.lines[0].y * n.scale];

test('match: a line of type shrinks visibly from its old type size to the new one across the window', () => {
  const sizes = STEPS.map((p) => shownSize(visibleOf(lineAt(BIG, SMALL, p))));
  assert.ok(Math.abs(sizes[0] - 172) < 0.05 * 172 && Math.abs(sizes.at(-1) - 104) < 0.05 * 104, `type size ${sizes[0]} to ${sizes.at(-1)}`);
  sizes.slice(1).forEach((s, k) => assert.ok(s <= sizes[k] + 1e-9, `never grows back: ${sizes[k]} then ${s}`));
  // and it passes through the sizes between: the shrink is seen, not a jump at the hand-over
  const seen = (p) => shownSize(visibleOf(lineAt(BIG, SMALL, p)));
  assert.ok(seen(0.4) < 0.9 * 172, `before the hand-over the old line has shrunk: ${seen(0.4)}`);
  assert.ok(seen(0.6) > 1.1 * 104, `after it the new line is still growing down to size: ${seen(0.6)}`);
});

test('match: lines far apart travel the whole distance between their two layouts, and the move spans the window', () => {
  const far = typeLine('line', 'A match carries one line across the cut', 1100, 760, 104, 90);
  const [a, b] = [anchorOf(BIG), anchorOf(far)];
  const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const path = STEPS.map((p) => anchorOf(visibleOf(lineAt(BIG, far, p))));
  assert.ok(Math.hypot(path[0][0] - a[0], path[0][1] - a[1]) < 0.05 * span, 'starts where the old line starts');
  assert.ok(Math.hypot(path.at(-1)[0] - b[0], path.at(-1)[1] - b[1]) < 0.05 * span, 'ends where the new line starts');
  const half = path[STEPS.indexOf(0.5)] ?? path[9];
  const mid = Math.hypot(half[0] - a[0], half[1] - a[1]);
  assert.ok(mid > 0.3 * span && mid < 0.7 * span, `half way through the window it is half way: ${mid} of ${span}`);
});

test('match in the desk film: the carried line travels between the two shots\' own layouts, type size and place', () => {
  const film = JSON.parse(readFileSync(DESK_FILM, 'utf8'));
  const shots = film.shots.slice(0, 2);
  const built = filmFor(shots, film.look, film.format, { cut: film.cut });
  const start = buildTimeline({ ...film, shots, fps: FPS }, { fps: FPS }).shots[1].start;
  const window = resolveCut(shots[1].cut).dur;
  const lineIn = (t) => built.sampleAt(t).find((n) => n.id === 'line');
  const [a, b] = [lineIn(start - 1 / FPS), lineIn(start + window + 1 / FPS)];
  const seen = (p) => visibleOf(lineIn(start + p * window).children);
  const [sizeA, sizeB] = [shownSize(a), shownSize(b)];
  assert.ok(sizeA > 1.3 * sizeB, `the two layouts set the line at different sizes: ${sizeA}, ${sizeB}`);
  const sizes = [0.1, 0.4, 0.6, 0.9].map((p) => shownSize(seen(p)));
  assert.ok(sizes[0] > 0.9 * sizeA && sizes[3] < 1.1 * sizeB, `from ${sizeA} to ${sizeB}: ${sizes}`);
  assert.ok(sizes[1] < 0.95 * sizeA && sizes[2] > 1.05 * sizeB, `seen shrinking on both sides of the hand-over: ${sizes}`);
  // the old line is seen most of the way: before the words change it has covered most of the size change (the sheet
  // of round 2's first render showed the move happening while both copies were faded)
  const before = shownSize(seen(0.65));
  assert.ok((sizeA - before) / (sizeA - sizeB) > 0.6, `by p 0.65 the old line has shrunk ${(sizeA - before).toFixed(1)} of ${(sizeA - sizeB).toFixed(1)} px`);
  assert.ok(seen(0.65).id === 'line.from', 'and it is still the old line that shows');
  const [pa, pb] = [anchorOf(a), anchorOf(b)];
  const span = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
  const end = anchorOf(seen(0.95));
  assert.ok(Math.hypot(end[0] - pb[0], end[1] - pb[1]) <= 0.1 * span + 1, `lands where the new line starts: ${end} vs ${pb}`);
});

// ---- the review: a match that carries nothing ----

const node = (id, depth = 0) => ({ type: 'group', id, depth, opacity: 1, visible: true, children: [] });
const filmOf = (cut) => ({ version: 2, mode: 'pro', look: 'desk', shots: [{ id: 'a', show: 'free' }, { id: 'b', show: 'free', cut }] });
const timeline = { fps: 30, shots: [{ id: 'a', index: 0, start: 0, duration: 1 }, { id: 'b', index: 1, start: 1, duration: 2 }] };
const snapshots = (before, after) => [{ frame: 29, whole: true, tree: before }, { frame: 45, whole: true, tree: after }];

test('review: a match whose shots share no node but the background is a creative finding naming both shots', () => {
  const found = matchFindings(filmOf('match'), timeline, snapshots([node('field', 1), node('x')], [node('field', 1), node('y')]));
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, 'creative');
  assert.equal(found[0].path, 'shots[1].cut');
  assert.match(found[0].message, /match into "b" carries nothing: it shares no node with shot "a"; name the same "hero" on both shots, or use another cut/);
});

test('review: a match that shares a hero, and any other cut, is no finding', () => {
  assert.deepEqual(matchFindings(filmOf('match'), timeline, snapshots([node('line')], [node('line')])), []);
  assert.deepEqual(matchFindings(filmOf('crossfade'), timeline, snapshots([node('x')], [node('y')])), []);
});

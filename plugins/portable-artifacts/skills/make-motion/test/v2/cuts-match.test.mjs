// The match carries the shared node visibly from its old place and size to its new one while the rest crossfades, and
// says so when the two shots share nothing (look review gate-cuts-1 D1; lead ruling 2). Pure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/cuts/index.mjs';
import { matchFindings } from '../../scripts/v2/review.mjs';

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

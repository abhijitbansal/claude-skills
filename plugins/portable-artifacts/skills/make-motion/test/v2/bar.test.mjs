// The look bar's six checks (helpers/bar.mjs), each proven on a small hand-built node list that breaks it, and a clean
// list that passes all six.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import { node } from '../../engine/graph/node.mjs';
import { track } from '../../engine/time/track.mjs';
import {
  stretchViolations, tallViolations, heroViolations, readableViolations, droppedViolations, frameZeroViolations,
} from './helpers/bar.mjs';

const desk = registries.looks.get('desk');
const WIDE = { w: 1920, h: 1080 };
const TALL = { w: 1080, h: 1920 };
const SAFE_TALL = { top: 96, bottom: 1920 - 96 };

// A one-line text of `words` words, each 1.1 em wide, its baseline 0.9 em down.
function text(id, size, x, y, { words = 2, role, extra = {}, tracks = {} } = {}) {
  const width = words * size * 1.1;
  const layout = { size, width, height: size * 1.15, overflow: false, lines: [{ x: 0, y: size * 0.9, width, words: Array.from({ length: words }, (_, i) => ({ text: 'word', index: i, x: i * size * 1.1, width: size })) }] };
  return node('text', id, { x, y, layout, fill: '#000000', ...(role ? { role } : {}), ...extra }, { tracks });
}
const box = (id, x, y, w, h, tracks = {}) => node('path', id, { d: `M${x} ${y}H${x + w}V${y + h}H${x}Z`, fill: '#888888' }, { tracks });
const rising = (from, to) => track([{ t: from, v: 0 }, { t: to, v: 1, ease: 'outCubic' }]);
const base = (nodes, extra = {}) => ({ nodes, duration: 3, canvas: WIDE, unit: 1, look: desk, mode: 'pro', safe: { top: 96, bottom: 984 }, floor: 30, nodeField: () => undefined, fields: [], findings: [], ...extra });

// A clean shot: a hero and a body 3x apart, the body arriving at 0.5 s; on a tall frame, a column filling the height.
const clean = () => [text('t.hero', 132, 200, 100, { role: 'hero' }), text('t.body', 44, 200, 400, { tracks: { opacity: rising(0.5, 1) } })];
const cleanTall = () => [box('t.top', 100, 120, 880, 500), text('t.hero', 132, 100, 700), box('t.low', 100, 900, 880, 880, { opacity: rising(0.5, 1) })];

test('a clean list passes all six checks', () => {
  const input = base(clean(), { nodeField: (id) => (id === 't.hero' ? 'title' : undefined), fields: ['title'] });
  assert.deepEqual(stretchViolations(input), []);
  assert.deepEqual(tallViolations({ ...base(cleanTall()), canvas: TALL, safe: SAFE_TALL }), []);
  assert.deepEqual(heroViolations(input), []);
  assert.deepEqual(readableViolations(input), []);
  assert.deepEqual(droppedViolations(input), []);
  assert.deepEqual(frameZeroViolations(input), []);
});

test('1: a block of lines at two sizes, and a text scaled on one axis, are stretched', () => {
  const stack = node('group', 's', {}, { children: [text('s.a', 100, 0, 0), text('s.b', 140, 0, 150)] });
  assert.equal(stretchViolations(base([stack])).length, 1);
  const emphasised = node('group', 'e', {}, { children: [text('e.a', 100, 0, 0), text('e.b', 140, 0, 150, { extra: { emphasised: true } })] });
  assert.deepEqual(stretchViolations(base([emphasised])), [], 'only an emphasised line may be larger');
  const squashed = node('group', 'q', { scaleX: 1.3 }, { children: [text('q.a', 100, 0, 0)] });
  assert.equal(stretchViolations(base([squashed])).length, 1);
});

test('2: content in the top third of a tall frame, and a gap in the middle, fail', () => {
  const top = [box('a', 100, 120, 880, 500)];
  assert.match(tallViolations({ ...base(top), canvas: TALL, safe: SAFE_TALL }).join(), /spans 29% of the safe height/);
  const split = [box('a', 100, 120, 880, 300), box('b', 100, 1500, 880, 300)];
  assert.match(tallViolations({ ...base(split), canvas: TALL, safe: SAFE_TALL }).join(), /an empty band of 63%/);
  assert.deepEqual(tallViolations(base(top)), [], 'a wide frame is not judged');
});

test('3: furniture, a borrowed tag role and a 2.6x hero fail', () => {
  assert.match(heroViolations(base([text('f', 132, 200, 100, { extra: { furniture: true } })])).join(), /sets props\.furniture/);
  assert.match(heroViolations(base([text('g', 132, 200, 100), text('h', 44, 200, 500, { role: 'tag' })])).join(), /role tag outside a tag device/);
  assert.match(heroViolations(base([text('i', 132, 200, 100), text('j', 50, 200, 500)])).join(), /hero: the hero text is only 2\.6 times/);
});

test('4: an author text under the floor fails', () => {
  const input = base([text('t.title', 30, 100, 300)], { canvas: TALL, floor: 44, nodeField: (id) => (id === 't.title' ? 'title' : undefined) });
  assert.deepEqual(readableViolations(input), ['t.title (title) is 30.0 units; the floor is 44']);
  assert.deepEqual(readableViolations({ ...input, nodeField: () => null }), [], 'a computed text (nodeField null) is not the author\'s');
});

test('5: a field neither drawn nor named by a finding fails', () => {
  const input = base([text('t.title', 132, 100, 300)], { fields: ['title', 'credit'], nodeField: (id) => (id === 't.title' ? 'title' : undefined) });
  assert.deepEqual(droppedViolations(input), ['field "credit" is neither drawn nor named by a finding']);
  assert.deepEqual(droppedViolations({ ...input, findings: [{ path: 'credit', message: 'not drawn at 9:16' }] }), []);
  const said = [text('t.title', 132, 100, 300, { extra: { dropped: ['credit'] } })];
  assert.deepEqual(droppedViolations({ ...input, nodes: said }), [], 'a node that says it left the field out (props.dropped)');
});

test('6: a half-entered first frame, an empty one, a still and a late reveal fail', () => {
  assert.match(frameZeroViolations(base([text('a', 132, 100, 100, { tracks: { opacity: rising(-0.2, 0.2) } }), text('b', 44, 100, 400, { tracks: { opacity: rising(0.5, 1) } })])).join(), /a: opacity 0\.\d+ at frame 0/);
  assert.match(frameZeroViolations(base([text('a', 132, 100, 100, { tracks: { y: track([{ t: -0.2, v: 140 }, { t: 0.3, v: 100 }]) } }), text('b', 44, 100, 400, { tracks: { opacity: rising(0.5, 1) } })])).join(), /a: y part-way at frame 0/);
  assert.match(frameZeroViolations(base([text('a', 132, 100, 100, { tracks: { opacity: rising(0.5, 1) } })])).join(), /frame 0 is empty/);
  const shadow = node('path', 's', { d: 'M0 0H50V50H0Z', fill: '#000000', opacity: 0.25 });
  assert.deepEqual(frameZeroViolations(base([shadow, ...clean()])), [], 'a static alpha (a shadow) is the design, not an entrance');
  assert.match(frameZeroViolations(base([text('a', 132, 100, 100)])).join(), /the shot is a still/);
  assert.match(frameZeroViolations(base([text('a', 132, 100, 100), text('b', 44, 100, 400, { tracks: { opacity: rising(2, 2.7) } })])).join(), /b: opacity lands at 2\.70 s/);
});

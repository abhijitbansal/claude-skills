// The chart kind's `scatter` type (plan 2026-11-16-pa2-shot-kinds-b, Task 10): schema branch, honesty findings, hand-placed
// geometry, arrivals, the highlight with its label device, and the bar in both looks and formats.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import { sample } from '../../engine/time/track.mjs';
import { chartTimes } from '../../engine/kinds/chart-time.mjs';
import { validateFilm } from '../../scripts/v2/spec.mjs';
import { expandIn, filmOf, all } from './helpers/kinds.mjs';
import { assertBar } from './helpers/bar.mjs';

const chart = registries.kinds.get('chart');
const expand = (shot, look = 'desk', format = '16:9') => expandIn(filmOf([shot], look, format));
const errorsOf = (shot) => validateFilm({ version: 2, shots: [shot] }, { specDir: '.' }).errors;
const find = (out, id) => all(out.nodes).find((n) => n.id === id);
const nums = (d) => d.match(/-?\d+(?:\.\d+)?/g).map(Number);
const centre = (n) => { const v = nums(n.props.d); const xs = v.filter((_, i) => i % 2 === 0), ys = v.filter((_, i) => i % 2); return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]; };
const FIVE = [{ x: 0, y: 0 }, { x: 10, y: 10, label: 'Top' }, { x: 5, y: 5 }, { x: 0, y: 10 }, { x: 10, y: 0, label: 'Low' }];
const SCATTER = (extra = {}) => ({ id: 's', show: 'chart', type: 'scatter', title: 'Price tracks size', xLabel: 'Size', yLabel: 'Price', data: FIVE, hold: 4, ...extra });

test('schema: a scatter needs both axis names; points are { x, y, label? }; a race reads { periods, rows }', () => {
  const paths = (shot) => errorsOf(shot).map((e) => e.path);
  assert.ok(errorsOf(SCATTER({ xLabel: undefined })).some((e) => e.path === 'shots[0]' || e.path === 'shots[0].xLabel'), JSON.stringify(errorsOf(SCATTER({ xLabel: undefined }))));
  assert.deepEqual(errorsOf(SCATTER()), []);
  assert.ok(errorsOf({ id: 'r', show: 'chart', type: 'race', title: 'T', hold: 2, data: [{ label: 'a', value: 1 }, { label: 'b', value: 2 }] }).some((e) => e.message === 'a race chart reads its data as { periods, rows }'));
  assert.ok(paths(SCATTER({ data: Array.from({ length: 7 }, (_, k) => ({ x: k, y: k, label: `p${k}` })) })).includes('shots[0].data'), 'at most 6 labelled');
  assert.ok(errorsOf(SCATTER({ highlight: 'Nope' })).some((e) => e.path === 'shots[0].highlight' && /labelled point/.test(e.message)));
  assert.ok(errorsOf({ ...SCATTER(), type: 'column', data: [{ label: 'a', value: 1 }] }).some((e) => e.path === 'shots[0].xLabel'), 'xLabel only on a scatter');
});

test('honesty: two points are a line; a non-finite value is mechanical', () => {
  const two = chart.review(SCATTER({ data: FIVE.slice(0, 2) }), {});
  assert.ok(two.some((f) => f.path === 'data' && f.kind === 'mechanical' && /is a line/.test(f.message)), JSON.stringify(two));
  const bad = chart.review(SCATTER({ data: [...FIVE.slice(0, 2), { x: Number.NaN, y: 1 }] }), {});
  assert.ok(bad.some((f) => f.path === 'data[2].x'));
  assert.deepEqual(chart.review(SCATTER(), {}), []);
});

test('geometry: five hand-placed points sit at their values on axes that fit the data (corners and centre)', () => {
  const out = expand(SCATTER());
  const plot = out.boxes.plot;
  const at = (k) => centre(find(out, `s.mark.${k}`));
  const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.01, `${msg}: ${a} vs ${b}`);
  near(at(0)[0], plot[0], 'x 0 at the left'); near(at(0)[1], plot[1] + plot[3], 'y 0 at the foot');
  near(at(1)[0], plot[0] + plot[2], 'x 10 at the right'); near(at(1)[1], plot[1], 'y 10 at the top');
  near(at(2)[0], plot[0] + plot[2] / 2, 'x 5 in the middle'); near(at(2)[1], plot[1] + plot[3] / 2, 'y 5 in the middle');
});

test('arrivals: the points arrive together over the first sentence, none on frame 0 part-way; the highlight lands on its word', () => {
  const shot = SCATTER({ hold: undefined, say: 'Bigger homes cost more. Top is the outlier.', highlight: 'Top' });
  const out = expand(shot);
  const { growEnd, highlightAt } = chartTimes(shot, out.timing);
  const shown = (k, t) => sample(find(out, `s.mark.${k}`).tracks.opacity, t);
  assert.ok([0, 1, 2, 3, 4].every((k) => shown(k, growEnd) === 1), 'all in by the first sentence');
  assert.ok([0, 1, 2, 3, 4].every((k) => [0, 1].includes(shown(k, 0))), 'steps');
  assert.equal(sample(find(out, 's.mark.1.accent').tracks.opacity, highlightAt + 1), 1);
  assert.ok(all(out.nodes).some((n) => n.id.startsWith('s.label.1')), 'the label device on the highlighted point');
  assert.equal(chart.landing(shot, out.timing), highlightAt);
});

// ---- the bar ----

const full = () => SCATTER({ hold: undefined, say: 'Bigger homes cost more. Top is the outlier.', highlight: 'Top', source: 'Listings, 2026',
  data: [...FIVE, { x: 2, y: 3 }, { x: 7, y: 6, label: 'Mid' }, { x: 3, y: 8 }] });
for (const look of ['desk', 'pop']) {
  for (const format of ['16:9', '9:16']) {
    test(`scatter bar: a plain scatter in ${look} at ${format}`, () => assertBar('chart', SCATTER(), { look, format }));
    test(`scatter bar: the full fixture in ${look} at ${format}`, () => assertBar('chart', full(), { look, format }));
  }
}

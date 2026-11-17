// The chart kind's `race` type (plan 2026-11-16-pa2-shot-kinds-b, Task 10): ranks and bar lengths for a 3-period, 4-row
// fixture at each period and halfway between two, ties in the given order, `top` and its finding, honesty findings, the
// land event, the five first-wave types unchanged (kinds-frozen), and the bar in both looks and formats.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import { sample } from '../../engine/time/track.mjs';
import { rankByPeriod, raceTimes } from '../../engine/kinds/chart-race.mjs';
import { validateFilm } from '../../scripts/v2/spec.mjs';
import { expandIn, filmOf, all } from './helpers/kinds.mjs';
import { assertBar } from './helpers/bar.mjs';

const chart = registries.kinds.get('chart');
const expand = (shot, look = 'desk', format = '16:9') => expandIn(filmOf([shot], look, format));
const errorsOf = (shot) => validateFilm({ version: 2, shots: [shot] }, { specDir: '.' }).errors;
const find = (out, id) => all(out.nodes).find((n) => n.id === id);
const ROWS = [
  { name: 'Ada', values: [10, 20, 40] },
  { name: 'Bo', values: [30, 25, 20] },
  { name: 'Cy', values: [20, 30, 10] },
  { name: 'Di', values: [5, 10, 30] },
];
const RACE = (extra = {}) => ({ id: 'r', show: 'chart', type: 'race', title: 'Ada took the lead', data: { periods: ['2023', '2024', '2025'], rows: ROWS }, hold: 4, ...extra });

test('ranks for 3 periods and 4 rows: value descending at each period', () => {
  const names = (t) => t.ranked.map((r) => ROWS[r.index].name);
  const table = rankByPeriod(RACE());
  assert.deepEqual(table.map(names), [['Bo', 'Cy', 'Ada', 'Di'], ['Cy', 'Bo', 'Ada', 'Di'], ['Ada', 'Di', 'Bo', 'Cy']]);
});

test('ties keep the given order', () => {
  const tied = RACE({ data: { periods: ['a', 'b'], rows: [{ name: 'X', values: [5, 1] }, { name: 'Y', values: [5, 2] }, { name: 'Z', values: [5, 3] }] } });
  assert.deepEqual(rankByPeriod(tied)[0].ranked.map((r) => r.index), [0, 1, 2]);
});

test('bar lengths at each period and halfway between two (the settle move on its way); rows move to their rank', () => {
  const shot = RACE();
  const out = expand(shot);
  const t = raceTimes(shot, out.timing);
  const len = (k, at) => sample(find(out, `r.mark.${k}`).tracks.scaleX, at);
  const max = 40;
  ROWS.forEach((row, k) => row.values.forEach((v, p) => assert.ok(Math.abs(len(k, t[p] + 0.7) - v / max) < 1e-6 || p === 0 && Math.abs(len(k, 0) - v / max) < 1e-6, `${row.name} at period ${p}`)));
  const half = t[1] + registries.looks.get('desk').moves.settle.dur / 2;
  const mid = len(0, half);
  assert.ok(mid > 10 / max && mid < 20 / max, `Ada halfway from 2023 to 2024: ${mid}`);
  const y = (k, at) => sample(find(out, `r.row.${k}`).tracks.y, at);
  assert.ok(y(0, t[2] + 0.7) < y(0, 0), 'Ada climbs to the top by the last period');
  assert.equal(chart.landing(shot, out.timing), t[2], 'the land event is the last period');
});

test('the period shows top right in each window: a label in desk, a numeral (hero) in pop', () => {
  const shot = RACE();
  for (const look of ['desk', 'pop']) {
    const out = expand(shot, look);
    const t = raceTimes(shot, out.timing);
    const p1 = find(out, 'r.period.1');
    assert.equal(sample(p1.tracks.opacity, t[1]), 1);
    assert.equal(sample(p1.tracks.opacity, t[2]), 0);
    if (look === 'pop') assert.equal(p1.props.role, 'hero');
  }
});

test('top hides the rest without a finding only when the highlight is shown at the end; else a finding at top', () => {
  assert.deepEqual(chart.review(RACE({ top: 2, highlight: 'Ada' }), {}), [], 'Ada is in the last top 2');
  const found = chart.review(RACE({ top: 2, highlight: 'Bo' }), {});
  assert.ok(found.some((f) => f.path === 'top' && /hides 2 of 4 rows/.test(f.message)), JSON.stringify(found));
  assert.ok(chart.review(RACE({ top: 2 }), {}).some((f) => f.path === 'top'), 'no highlight: a finding');
  const out = expand(RACE({ top: 2, highlight: 'Ada' }));
  const t = raceTimes(RACE(), out.timing);
  assert.equal(sample(find(out, 'r.row.3').tracks.opacity, 0), 0, 'Di is not in the first top 2');
  assert.equal(sample(find(out, 'r.row.3').tracks.opacity, t[2]), 1, 'Di is in the last top 2');
});

test('honesty: a negative value and a values list of the wrong length are findings at their paths', () => {
  const neg = chart.review(RACE({ data: { periods: ['a', 'b'], rows: [{ name: 'X', values: [5, -1] }, { name: 'Y', values: [1, 2] }] } }), {});
  assert.ok(neg.some((f) => f.path === 'data.rows[0].values[1]' && f.kind === 'mechanical' && /below zero/.test(f.message)));
  const short = errorsOf(RACE({ data: { periods: ['a', 'b', 'c'], rows: [{ name: 'X', values: [5, 1] }, { name: 'Y', values: [1, 2, 3] }] } }));
  assert.ok(short.some((e) => e.path === 'shots[0].data.rows[0].values' && /2 values for 3 periods/.test(e.message)), JSON.stringify(short));
  assert.ok(errorsOf(RACE({ top: 3, type: 'bar', data: [{ label: 'a', value: 1 }] })).some((e) => e.path === 'shots[0].top'), 'top only on a race');
  assert.deepEqual(errorsOf(RACE({ highlight: 'Ada', top: 3 })), []);
});

// ---- the bar ----

const full = () => RACE({ hold: undefined, say: 'Bo led at first. Then Cy. By the end Ada took the lead.', highlight: 'Ada', unit: '%', source: 'League table' });
for (const look of ['desk', 'pop']) {
  for (const format of ['16:9', '9:16']) {
    test(`race bar: a plain race in ${look} at ${format}`, () => assertBar('chart', RACE(), { look, format }));
    test(`race bar: the full fixture in ${look} at ${format}`, () => assertBar('chart', full(), { look, format }));
  }
}

// The `timeline` kind (plan 2026-11-16-pa2-shot-kinds-b, Task 7): two to six events in the order given, evenly spaced
// (sequence, not scale). desk: a ruled line with a tick per event, `when` three times `what`, earlier events in ink2;
// pop: one event at a time with a progress rail of dots.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import { sample } from '../../engine/time/track.mjs';
import { validateFilm } from '../../scripts/v2/spec.mjs';
import { expandIn, filmOf, all, canvasOf } from './helpers/kinds.mjs';
import { assertBar } from './helpers/bar.mjs';

const timeline = registries.kinds.get('timeline');
const FOUR = [{ when: '2019', what: 'First sketch' }, { when: '2021', what: 'Open beta' }, { when: '2023', what: 'One million users' }, { when: '2025', what: 'Version two' }];
const base = (extra = {}) => ({ id: 't', show: 'timeline', events: FOUR, ...extra });
const expand = (shot, look = 'desk', format = '16:9') => expandIn(filmOf([shot], look, format));
const errorsOf = (shot) => validateFilm({ version: 2, shots: [shot] }, { specDir: '.' }).errors;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.05, `${msg}: ${a} vs ${b}`);
const nums = (d) => d.match(/-?\d+(?:\.\d+)?/g).map(Number);
const find = (out, id) => all(out.nodes).find((n) => n.id === id);

// ---- timing ----

test('timing: one event per sentence when the counts match; spread over the words otherwise; equal intervals with hold; the first at 0', () => {
  const s = base({ say: 'We sketched it. Then a beta. Then a million users. Now version two.' });
  const so = expand(s);
  assert.deepEqual(timeline.arrivals(s, so.timing), so.timing.sentences.map((x, k) => (k === 0 ? 0 : x.start)));
  const w = base({ say: 'It started small and grew, year after year, into what you see today.' });
  const wo = expand(w);
  const tw = timeline.arrivals(w, wo.timing);
  assert.equal(tw[0], 0);
  assert.ok(tw.every((t, k) => k === 0 || t > tw[k - 1]), `in order: ${tw}`);
  assert.ok(tw.at(-1) <= wo.timing.duration - 0.6 + 1e-9, 'landed 0.6 s before the end');
  const h = base({ hold: 4 });
  const th = timeline.arrivals(h, expand(h).timing);
  th.forEach((t, k) => near(t, (k * (4 - 0.6)) / 3, `held ${k}`));
});

test('events: one event cue per event after the first; targets are event:<n> from 0', () => {
  const shot = base({ say: 'We sketched it. Then a beta. Then a million users. Now version two.' });
  const out = expand(shot);
  assert.deepEqual(timeline.events(shot, out.timing), timeline.arrivals(shot, out.timing).slice(1).map((t) => ({ kind: 'device', device: 'event', t })));
  assert.deepEqual(timeline.eventDevices, ['event']);
  assert.deepEqual(timeline.targets(shot), ['events', 'event:0', 'event:1', 'event:2', 'event:3']);
});

// ---- validation ----

test('validation: 2 to 6 events, when at most 14 characters, what at most 60, highlight an event number', () => {
  const paths = (shot) => errorsOf(shot).map((e) => e.path);
  assert.ok(paths(base({ hold: 2, events: FOUR.slice(0, 1) })).includes('shots[0].events'));
  assert.ok(paths(base({ hold: 2, events: [{ when: 'x'.repeat(15), what: 'a' }, FOUR[1]] })).includes('shots[0].events[0].when'));
  assert.ok(paths(base({ hold: 2, events: [{ when: '1', what: 'x'.repeat(61) }, FOUR[1]] })).includes('shots[0].events[0].what'));
  assert.ok(errorsOf(base({ hold: 2, highlight: 5 })).some((e) => e.path === 'shots[0].highlight' && e.message === 'no event 5: the events are numbered 1 to 4'));
  assert.deepEqual(errorsOf(base({ hold: 2, highlight: 3, title: 'How we got here' })), []);
});

// ---- desk ----

// the room starts at column 2 (242) since gate-kinds-b-1 (one left margin with the statement and the chart): 1436 wide,
// four columns of (1436 - 3 x 24) / 4 = 341; the years are evenly apart, so by date is even
test('desk 16:9: four ticks on a line across the grid, one per column (hand-computed: 242, 607, 972, 1337)', () => {
  const out = expand(base({ hold: 4 }));
  [242, 607, 972, 1337].forEach((x, k) => near(nums(find(out, `t.tick${k}`).props.d)[0], x, `tick ${k} x`));
});

test('desk 9:16: four ticks down a line on the left, one per equal slot of the room (hand-computed: 312, 744, 1176, 1608)', () => {
  const out = expand(base({ hold: 4 }), 'desk', '9:16');
  [312, 744, 1176, 1608].forEach((y, k) => near(nums(find(out, `t.tick${k}`).props.d)[1], y, `tick ${k} y`));
});

test('desk: an event is in ink while current and in ink2 once the next arrives; the highlighted one is ink again at the end', () => {
  const shot = base({ hold: 4, highlight: 1 });
  const out = expand(shot);
  const { ink, ink2 } = registries.looks.get('desk').palette;
  const t = timeline.arrivals(shot, out.timing);
  const fillAt = (id, at) => sample(find(out, id).wordTracks[0].fill, at);
  assert.equal(fillAt('t.when1', t[1]), ink);
  assert.equal(fillAt('t.when1', t[2]), ink2);
  assert.equal(fillAt('t.what1', t[2]), ink2);
  assert.equal(fillAt('t.when0', out.timing.duration), ink, 'the highlighted event (1) is ink at the end');
  assert.equal(fillAt('t.when2', out.timing.duration), ink2);
});

// ---- pop ----

test('pop: one event at a time, with a rail of one dot per event and the current dot in the accent', () => {
  const shot = base({ hold: 4 });
  for (const format of ['16:9', '9:16']) {
    const out = expand(shot, 'pop', format);
    const t = timeline.arrivals(shot, out.timing);
    const shown = (k, at) => sample(find(out, `t.event${k}`).tracks.opacity, at);
    assert.deepEqual([0, 1, 2, 3].map((k) => shown(k, t[1])), [0, 1, 0, 0], `${format}: only event 1 at its time`);
    assert.equal(shown(0, 0), 1, 'the first on frame 0');
    assert.equal(all(out.nodes).filter((n) => /^t\.rail\.dot\d$/.test(n.id)).length, 4);
    const lit = find(out, 't.rail.lit2');
    assert.equal(lit.props.fill, registries.looks.get('pop').palette.accent);
    assert.equal(sample(lit.tracks.opacity, t[2]), 1);
    assert.equal(sample(lit.tracks.opacity, t[3]), 0);
  }
});

test('pop 9:16: each event sits beside its own dot, so the text travels down the frame (unless held inside the area)', () => {
  const shot = base({ hold: 4 });
  const out = expand(shot, 'pop', '9:16');
  const dots = [0, 1, 2, 3].map((k) => { const p = nums(find(out, `t.rail.dot${k}`).props.d); return p[1] + registries.looks.get('pop').kinds.timeline.dot; });
  const mids = [0, 1, 2, 3].map((k) => out.boxes[`event:${k}`][1] + out.boxes[`event:${k}`][3] / 2);
  assert.ok(mids.every((m, k) => k === 0 || m > mids[k - 1] + 1), `the blocks go down the frame: ${mids.map(Math.round)}`);
  near(mids[1], dots[1], 'event 1 beside its dot');
  near(mids[2], dots[2], 'event 2 beside its dot');
});

// ---- the 3x relation and fit ----

test('when holds three times what on every frame, in both looks and formats, for a 1-character and a 14-character when', () => {
  const events = [{ when: '1', what: 'The first idea' }, { when: 'Spring of 2024', what: 'A long beta with many users' }, { when: '2025', what: 'Launch' }];
  for (const look of ['desk', 'pop']) {
    for (const format of ['16:9', '9:16']) {
      const out = expand(base({ hold: 4, events }), look, format);
      events.forEach((_, k) => {
        const when = find(out, `t.when${k}`).props.layout.size, what = find(out, `t.what${k}`).props.layout.size;
        assert.ok(when >= 3 * what - 1e-6, `${look} ${format} event ${k}: when ${when} vs what ${what}`);
      });
    }
  }
});

test('fit: six 14-character dates in desk columns at 16:9 give the finding "cut an event or shorten events[i].when"; four years give none; pop (one event at a time) holds them', () => {
  const six = base({ hold: 4, events: Array.from({ length: 6 }, (_, k) => ({ when: `Autumn of 20${10 + k}`, what: 'Something happened' })) });
  const review = (shot, look) => timeline.review(shot, { look: registries.looks.get(look), canvas: canvasOf('16:9') });
  const findings = review(six, 'desk');
  assert.ok(findings.some((f) => /^events\[\d\]\.when$/.test(f.path) && /cut an event or shorten events\[\d\]\.when/.test(f.message)), JSON.stringify(findings));
  assert.deepEqual(review(base({ hold: 4 }), 'desk'), []);
  assert.deepEqual(review(six, 'pop'), []);
});

// ---- the bar ----

const full = () => base({ say: 'We sketched it. Then a beta. Then a million users. Now version two.', title: 'How we got here', highlight: 3 });
for (const look of ['desk', 'pop']) {
  for (const format of ['16:9', '9:16']) {
    test(`timeline bar: the example in ${look} at ${format}`, () => assertBar('timeline', timeline.example, { look, format }));
    test(`timeline bar: the full fixture in ${look} at ${format}`, () => assertBar('timeline', full(), { look, format }));
    test(`timeline bar: two held events in ${look} at ${format}`, () => assertBar('timeline', base({ hold: 3, events: FOUR.slice(0, 2) }), { look, format }));
  }
}

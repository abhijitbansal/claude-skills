// A cut never lands on an empty or unrevealed shot (lead ruling 4, round 2 of the transitions revision; look review
// gate-cuts-1 D2, DF3, PF2, PF6): a number shows its count's start value from frame 0, the words spoken during a cut
// are revealed by the cut's end, a pop number's kicker plate never sits under its digits, and a feed's later messages
// arrive when they are spoken. Pure (layout through the node measurer).
import test from 'node:test';
import assert from 'node:assert/strict';
import { sample } from '../../engine/time/track.mjs';
import { resolveCut } from '../../engine/cuts/resolve.mjs';
import { feedTimes } from '../../engine/kinds/feed-layout.mjs';
import '../../engine/looks/index.mjs';
import '../../engine/modes/index.mjs';
import '../../engine/devices/index.mjs';
import '../../engine/kinds/index.mjs';
import '../../engine/cuts/index.mjs';
import { FILLER, filmOf, expandIn, textNode, all, visibleSteps, heroWords } from './helpers/kinds.mjs';

const opacityAt = (n, t) => (n.tracks?.opacity ? sample(n.tracks.opacity, t) : 1);

// desk push and pop dots as the films have them: the figure is spoken last, well after the cut
const PUSH = { id: 'push', show: 'number', cut: 'slide', kicker: 'Slide', say: 'A slide pushes the last shot out by one of its four edges.', value: 4, label: 'edges a slide can use' };
const DOTS = { id: 'dots', show: 'number', cut: 'polka-dots', kicker: 'Polka dots', say: 'Dots grow from a corner until the frame is one hundred percent dots.', value: 100, suffix: '%', label: 'covered by dots' };

for (const [look, format, shot] of [['desk', '16:9', PUSH], ['pop', '9:16', DOTS], ['desk', '16:9', { ...PUSH, cut: 'cut' }]]) {
  test(`${look} number on a ${typeof shot.cut === 'string' ? shot.cut : shot.cut.type} cut: the figure shows its start value from frame 0`, () => {
    const { nodes } = expandIn(filmOf([FILLER, shot], look, format), 1);
    const figure = all(nodes).find((n) => n.id === `${shot.id}.value`);
    const digits = textNode(nodes, `${shot.id}.value.digits`);
    // under a cut with a window the cut is the entrance: whole from frame 0; after a hard cut it enters from frame 0
    const windowed = resolveCut(shot.cut).dur > 0;
    assert.ok(windowed ? opacityAt(figure, 0) === 1 : opacityAt(figure, 0) > 0, `the figure group is up on the shot's first frame (${opacityAt(figure, 0)})`);
    assert.equal(visibleSteps(digits, 0), 1, 'one step of the count shows on frame 0');
    assert.equal(digits.props.steps[0].text.replace(/\D/g, '') === '' ? null : Number(digits.props.steps[0].text.replace(/,/g, '')) < shot.value, true, 'and it is the start value, not the final one');
  });
}

test('the desk push figure is up at the cut\'s end, long before the count moves (no empty hold, ruling 5)', () => {
  const film = filmOf([FILLER, PUSH], 'desk');
  const { nodes, timing } = expandIn(film, 1);
  const cutEnd = resolveCut('slide').dur;
  const digits = textNode(nodes, 'push.value.digits');
  const figure = all(nodes).find((n) => n.id === 'push.value');
  assert.equal(opacityAt(figure, cutEnd), 1);
  assert.equal(visibleSteps(digits, cutEnd), 1);
  assert.ok(timing.duration > 1, 'the shot runs on after the cut');
});

// ---- a pop number's kicker and label plates never sit under its digits ----

const FPS = 30;
// The figure's cap box at its largest: the group scales about its origin (number.mjs figureGroup), so its cap top and
// baseline move apart by the scale track's peak.
function peakCapBox(figure, box, duration) {
  const peak = Math.max(1, ...Array.from({ length: Math.ceil(duration * FPS) + 1 }, (_, k) => (figure.tracks?.scale ? sample(figure.tracks.scale, k / FPS) : 1)));
  const gy = figure.props.y;
  return { top: gy - (gy - box[1]) * peak, bottom: gy + (box[1] + box[3] - gy) * peak, peak };
}

const RISE = { id: 'rise', show: 'number', cut: { type: 'slide', direction: 'up' }, kicker: 'Slide up', say: 'This slide came up from below. Two edges left.', value: 2, label: 'edges left' };
for (const shot of [RISE, { ...DOTS }, { ...RISE, id: 'big', value: 88, kicker: 'Eighty-eight keys', say: 'A piano has eighty eight keys.', label: 'keys' }]) {
  test(`pop number ${shot.id}: at the pulse's peak the digits stay clear of the kicker plate and the label plate`, () => {
    const { nodes, boxes, timing } = expandIn(filmOf([FILLER, shot], 'pop', '9:16'), 1);
    const figure = all(nodes).find((n) => n.id === `${shot.id}.value`);
    const cap = peakCapBox(figure, boxes.value, timing.duration);
    assert.ok(cap.peak > 1, 'the figure pulses');
    assert.ok(boxes.kicker[1] + boxes.kicker[3] <= cap.top, `kicker bottom ${boxes.kicker[1] + boxes.kicker[3]} under the digits' top ${cap.top}`);
    assert.ok(cap.bottom <= boxes.label[1], `digits' baseline ${cap.bottom} under the label's top ${boxes.label[1]}`);
  });
}

// ---- a feed's later messages arrive when spoken ----

test('feed: the first message is up from frame 0 and every later one arrives on its own sentence, however late', () => {
  const timing = { duration: 7, sentences: [{ start: 0.1 }, { start: 2.4 }, { start: 4.2 }], words: [{ text: 'x', start: 0.1, end: 5.5 }] };
  assert.deepEqual(feedTimes(3, timing, 6.4), [0, 2.4, 4.2]);
});

// ---- words spoken during the cut are revealed by its end ----

const REVEAL_KEYS = ['opacity', 'fill', 'ghost'];
const valueAt = (tracks, key, t) => (tracks[key] ? sample(tracks[key], t) : null);

// Every word of `words` (word tracks) spoken before `window` shows at the window's end what it shows at the shot's end.
function unsettled(words, times, window, end) {
  return words.flatMap((tracks, i) => (times[i] >= window ? [] : REVEAL_KEYS
    .filter((key) => valueAt(tracks, key, window) !== valueAt(tracks, key, end))
    .map((key) => `word ${i} (spoken ${times[i].toFixed(2)}) ${key} ${valueAt(tracks, key, window)} at the cut's end`)));
}

// pop statements as the film has them (viral: words are ghosts that light when spoken), and a desk one
const STATEMENTS = [
  ['pop', '9:16', { id: 's', show: 'statement', cut: 'polka-dots', kicker: 'Polka dots', say: 'Dots grow from a corner until the frame is full.' }],
  ['pop', '9:16', { id: 's', show: 'statement', cut: 'cross-zoom', kicker: 'Cross zoom', say: 'A cross zoom blurs straight through the *middle*.' }],
  ['desk', '16:9', { id: 's', show: 'statement', cut: 'page-curl', kicker: 'Curl', say: 'A page curl turns the whole frame over like paper.' }],
];

for (const [look, format, shot] of STATEMENTS) {
  test(`${look} statement on ${shot.cut}: every word spoken inside the cut is fully revealed when the cut ends`, () => {
    const { nodes, timing } = expandIn(filmOf([FILLER, shot], look, format), 1);
    const window = resolveCut(shot.cut).dur;
    const spoken = timing.words.map((w) => w.start);
    assert.ok(spoken.filter((t) => t < window).length >= 2, 'the case has words spoken inside the window');
    const words = heroWords(nodes, 's.text');
    // on-screen words follow the spoken ones one to one here (plain sentences)
    assert.deepEqual(unsettled(words, spoken, window, timing.duration), []);
  });
}

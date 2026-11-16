// Sound cues are planned from the film's own events (cuts, devices, emphasis, a number landing), asking the film's look
// which cue each event makes and its mode whether cues play at all. Times come from a hand-built fixture timeline, so
// every expected second below is read straight off it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry, registries } from '../../engine/registry.mjs';
import '../../engine/looks/index.mjs';
import '../../engine/modes/index.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { resolveAnchor } from '../../engine/script/anchors.mjs';
import { soundEvents } from '../../scripts/v2/sound/events.mjs';
import { planCues, CUE_GAIN_DB, MIN_CUE_GAP } from '../../scripts/v2/sound/cues.mjs';
import { KNOWN_CUES } from '../../scripts/v2/sound/synth.mjs';
import { heardWordSpans } from '../../scripts/v2/sound/duck.mjs';

const FPS = 30;
const EPSILON = 1e-9;
const word = (text, start, end, emphasis = false) => ({ text, start, end, emphasis, aside: false });

// open: 0 to 3 s, two emphasised runs ("never leave" at 0.5, "Now." at 2.2) and two sentences.
// clip: 3 to 5.5 s after a slide, a highlight on "this" (0.8 s in: 3.8 s).
// rows: 5.5 to 8.5 s after a hard cut, a number whose count lands on "Forty" (0.6 s in: 6.1 s).
const TIMELINE = Object.freeze({
  fps: FPS,
  duration: 8.5,
  frameCount: 255,
  timed: 'estimated',
  shots: [
    {
      id: 'open', index: 0, start: 0, end: 3, duration: 3,
      words: [word('Files', 0, 0.4), word('never', 0.5, 0.9, true), word('leave', 1.0, 1.4, true), word('home.', 1.5, 1.9), word('Now.', 2.2, 2.6, true)],
      sentences: [{ start: 0, end: 1.9, first: 0, last: 3 }, { start: 2.2, end: 2.6, first: 4, last: 4 }],
    },
    {
      id: 'clip', index: 1, start: 3, end: 5.5, duration: 2.5,
      words: [word('Read', 0.2, 0.6), word('this.', 0.8, 1.2)],
      sentences: [{ start: 0.2, end: 1.2, first: 0, last: 1 }],
    },
    {
      id: 'rows', index: 2, start: 5.5, end: 8.5, duration: 3,
      words: [word('Forty', 0.6, 0.9), word('one', 1.0, 1.2), word('percent.', 1.3, 1.8)],
      sentences: [{ start: 0.6, end: 1.8, first: 0, last: 2 }],
    },
  ],
});

const shotsWith = ({ openOn, clipOn, rowsOn } = {}) => [
  { id: 'open', show: 'statement', say: 'Files *never leave* home. *Now.*', ...(openOn ? { on: openOn } : {}) },
  { id: 'clip', show: 'clipping', cut: 'slide', say: 'Read this.', on: clipOn ?? [{ at: 'word:this', do: 'highlight' }] },
  { id: 'rows', show: 'number', cut: 'cut', say: 'Forty one percent.', value: 41, label: 'of rows', ...(rowsOn ? { on: rowsOn } : {}) },
];
const film = (fields = {}, shots = {}) => ({ version: 2, mode: 'pro', ...fields, shots: shotsWith(shots) });

const plan = (f, opts) => planCues(f, TIMELINE, { looks: registries.looks, modes: registries.modes, ...opts });
// [t, cue] pairs with t rounded to 1e-6, for comparing against seconds read off the fixture.
const pairs = (cues) => cues.map(({ t, cue }) => [Math.round(t * 1e6) / 1e6, cue]);
const LAST_FRAME = (TIMELINE.frameCount - 1) / FPS;

// ---- events ----

test('soundEvents: a statement emphasis per run, a slide and a highlight on the clipping, a hard cut and the count landing, sorted by time', () => {
  const events = soundEvents(film(), TIMELINE);
  const want = [
    { kind: 'emphasis', t: 0.5, shot: 'open' },
    { kind: 'emphasis', t: 2.2, shot: 'open' },
    { kind: 'cut', t: 3, shot: 'clip', cut: 'slide' },
    { kind: 'device', t: 3.8, shot: 'clip', device: 'highlight' },
    { kind: 'cut', t: 5.5, shot: 'rows', cut: 'cut' },
    { kind: 'land', t: 6.1, shot: 'rows' },
  ];
  assert.equal(events.length, want.length, JSON.stringify(events));
  events.forEach((event, i) => {
    const { t, ...rest } = event;
    const { t: wantT, ...wantRest } = want[i];
    assert.deepEqual(rest, wantRest, `event ${i}`);
    assert.ok(Math.abs(t - wantT) < EPSILON, `event ${i}: t ${t} vs ${wantT}`);
  });
});

test('soundEvents: the first shot opens on no cut; an event at 0 s and one on the film end are kept where they fall', () => {
  const events = soundEvents(film({}, { openOn: [{ at: 'start', do: 'circle' }], rowsOn: [{ at: 'end', do: 'circle' }] }), TIMELINE);
  assert.equal(events.some((e) => e.kind === 'cut' && e.shot === 'open'), false);
  assert.deepEqual(events[0], { kind: 'device', t: 0, shot: 'open', device: 'circle' });
  assert.deepEqual(events.at(-1), { kind: 'device', t: 8.5, shot: 'rows', device: 'circle' });
});

test('soundEvents: a shot whose kind has no landing makes no land event, and a cut without a name is a "cut"', () => {
  const f = { version: 2, shots: [{ id: 'a', show: 'statement', say: 'One.' }, { id: 'b', show: 'statement', say: 'Two.' }] };
  const timeline = {
    fps: FPS, duration: 4, frameCount: 120, timed: 'estimated',
    shots: [
      { id: 'a', index: 0, start: 0, end: 2, duration: 2, words: [word('One.', 0, 0.4)], sentences: [] },
      { id: 'b', index: 1, start: 2, end: 4, duration: 2, words: [word('Two.', 0, 0.4)], sentences: [] },
    ],
  };
  assert.deepEqual(soundEvents(f, timeline), [{ kind: 'cut', t: 2, shot: 'b', cut: 'cut' }]);
});

// ---- whether cues play ----

test('the cue constants: -12 dB, 0.12 s', () => {
  assert.equal(CUE_GAIN_DB, -12);
  assert.equal(MIN_CUE_GAP, 0.12);
});

test('planCues in pro plays nothing without "sound": "on"', () => {
  assert.deepEqual(plan(film()), []);
});

test('planCues in pro with "sound": "on" asks desk: paper on the slide and the cut, a marker on the highlight, a click on the landing; emphasis is silent', () => {
  const cues = plan(film({ sound: 'on' }));
  assert.deepEqual(pairs(cues), [[3, 'paper'], [3.8, 'marker'], [5.5, 'paper'], [6.1, 'click']]);
  for (const cue of cues) {
    assert.equal(cue.gainDb, CUE_GAIN_DB);
    assert.equal(cue.pan, 0);
  }
});

test('planCues in viral plays by default and asks pop; "sound": "off" silences it', () => {
  const viral = film({ mode: 'viral' });
  assert.deepEqual(pairs(plan(viral)), [[0.5, 'pop'], [2.2, 'pop'], [3, 'whoosh'], [3.8, 'pop'], [5.5, 'click'], [6.1, 'sub']]);
  assert.deepEqual(plan({ ...viral, sound: 'off' }), []);
  assert.deepEqual(plan({ ...film({ sound: 'on' }), sound: 'off' }), []);
});

test('planCues: the film look, when it names one, answers in place of the mode default look', () => {
  assert.deepEqual(pairs(plan(film({ mode: 'viral', look: 'desk' }))), [[3, 'paper'], [3.8, 'marker'], [5.5, 'paper'], [6.1, 'click']]);
});

// ---- an explicit list ----

test('an explicit cues list replaces the plan, its anchors resolved across the whole film', () => {
  // word:6 is the film's seventh word, "this." in clip (open has five): 3 + 0.8 s; sentence:1 is open's "Now." at 2.2 s
  const cues = [{ at: 'word:6', cue: 'ding' }, { at: 2, cue: 'riser' }, { at: 'sentence:1', cue: 'chime' }];
  assert.deepEqual(pairs(plan(film({ mode: 'viral', cues }))), [[2, 'riser'], [2.2, 'chime'], [3.8, 'ding']]);
  assert.deepEqual(pairs(plan(film({ sound: 'on', cues: [{ at: 'word:Forty+0.5', cue: 'drop' }] }))), [[6.6, 'drop']]);
});

test('an explicit cues list is the author opting in: it plays in pro without "sound", and only "sound": "off" silences it', () => {
  const cues = [{ at: 1, cue: 'ding' }];
  assert.deepEqual(pairs(plan(film({ cues }))), [[1, 'ding']], 'pro, no sound field');
  assert.deepEqual(pairs(plan(film({ sound: 'on', cues }))), [[1, 'ding']]);
  assert.deepEqual(plan(film({ sound: 'off', cues })), [], 'pro, "sound": "off"');
  assert.deepEqual(plan(film({ mode: 'viral', sound: 'off', cues })), [], 'viral, "sound": "off"');
});

test('an empty explicit cues list means no cues at all', () => {
  assert.deepEqual(plan(film({ mode: 'viral', cues: [] })), []);
});

test('a cue on the film end sounds on its last frame, not after it', () => {
  assert.deepEqual(pairs(plan(film({ mode: 'viral', cues: [{ at: 'end', cue: 'ding' }] }))), [[Math.round(LAST_FRAME * 1e6) / 1e6, 'ding']]);
  const planned = plan(film({ sound: 'on' }, { rowsOn: [{ at: 'end', do: 'circle' }] }));
  assert.ok(Math.abs(planned.at(-1).t - LAST_FRAME) < EPSILON, `last cue at ${planned.at(-1).t}`);
});

test('an explicit anchor outside the film is an error naming the cue, not a silent move to the edge', () => {
  for (const at of [999, -3, 'end+5', 'word:Forty+5']) {
    assert.throws(() => plan(film({ mode: 'viral', cues: [{ at: 1, cue: 'ding' }, { at, cue: 'chime' }] })),
      /^RangeError: cues\[1\]\.at: "chime" lands at -?[\d.]+ s, outside the film \(0 to 8\.5 s\)/, String(at));
  }
  assert.deepEqual(pairs(plan(film({ mode: 'viral', cues: [{ at: 'end', cue: 'ding' }] }))).length, 1, 'the film end itself is inside');
});

test('a word named by its text that only one shot speaks resolves across the film; one no shot speaks is an error', () => {
  assert.deepEqual(pairs(plan(film({ mode: 'viral', cues: [{ at: 'word:this', cue: 'ding' }] }))), [[3.8, 'ding']]);
  assert.deepEqual(pairs(plan(film({ mode: 'viral', cues: [{ at: 'word:Read+0.1', cue: 'ding' }] }))), [[3.3, 'ding']]);
  assert.throws(() => plan(film({ mode: 'viral', cues: [{ at: 'word:nothing', cue: 'ding' }] })), /cues\[0\]\.at: no word "nothing"/);
});

test('a word text spoken in two shots is ambiguous: the error names each by its index across the film (word:<n>)', () => {
  const f = { version: 2, mode: 'viral', cues: [{ at: 'word:go+0.1', cue: 'ding' }], shots: [{ id: 'a', show: 'statement', say: 'Go.' }, { id: 'b', show: 'statement', say: 'Go.' }] };
  const timeline = {
    fps: FPS, duration: 4, frameCount: 120, timed: 'estimated',
    shots: [
      { id: 'a', index: 0, start: 0, end: 2, duration: 2, words: [word('Go.', 0, 0.4)], sentences: [] },
      { id: 'b', index: 1, start: 2, end: 4, duration: 2, words: [word('Go.', 0, 0.4)], sentences: [] },
    ],
  };
  assert.throws(() => planCues(f, timeline),
    /cues\[0\]\.at: "go" is spoken in more than one shot \("a" and "b"\); name the one you mean by its place in the film: word:0\+0\.1 \(in "a"\) or word:1\+0\.1 \(in "b"\)/);
  assert.deepEqual(pairs(planCues({ ...f, cues: [{ at: 'word:1+0.1', cue: 'ding' }] }, timeline)), [[2.1, 'ding']], 'the index form names the second');
});

test('a bad anchor in the explicit list is an error naming its path', () => {
  assert.throws(() => plan(film({ mode: 'viral', cues: [{ at: 1, cue: 'ding' }, { at: 'sentence:9', cue: 'ding' }] })), /cues\[1\]\.at: sentence:9 is out of range/);
});

// ---- spacing ----

test('two events of the same kind 0.05 s apart give one cue: the first', () => {
  const cues = plan(film({ mode: 'viral' }, { clipOn: [{ at: 0.5, do: 'highlight' }, { at: 0.55, do: 'punch' }] }));
  assert.deepEqual(pairs(cues).filter(([t]) => t > 3 && t < 4), [[3.5, 'pop']]);
});

test('within MIN_CUE_GAP the more specific event wins: land over device, device over emphasis and cut', () => {
  const cutDevice = plan(film({ sound: 'on' }, { clipOn: [{ at: 0.05, do: 'highlight' }] }));
  assert.deepEqual(pairs(cutDevice).filter(([t]) => t >= 3 && t < 3.5), [[3.05, 'marker']], 'a marker 0.05 s after the cut replaces its paper');
  const deviceLand = plan(film({ mode: 'viral' }, { rowsOn: [{ at: 0.55, do: 'punch' }] }));
  assert.deepEqual(pairs(deviceLand).filter(([t]) => t > 5.5), [[6.1, 'sub']], 'the landing 0.05 s after a punch replaces its impact');
  const emphasisDevice = plan(film({ mode: 'viral' }, { openOn: [{ at: 0.55, do: 'punch' }] }));
  assert.deepEqual(pairs(emphasisDevice).filter(([t]) => t < 1), [[0.55, 'impact']], 'a punch 0.05 s after an emphasis replaces its pop');
});

test('an emphasised word on the first frame of a shot wins over the cut into it', () => {
  const f = { version: 2, mode: 'viral', shots: [{ id: 'a', show: 'statement', say: 'One.' }, { id: 'b', show: 'statement', say: '*Now.*' }] };
  const timeline = {
    fps: FPS, duration: 4, frameCount: 120, timed: 'measured',
    shots: [
      { id: 'a', index: 0, start: 0, end: 2, duration: 2, words: [word('One.', 0, 0.4)], sentences: [] },
      { id: 'b', index: 1, start: 2, end: 4, duration: 2, words: [word('Now.', 0, 0.4, true)], sentences: [] },
    ],
  };
  assert.deepEqual(pairs(planCues(f, timeline)), [[2, 'pop']]);
});

test('the gap is measured from the last cue kept, so 3.0, 3.1 and 3.2 keep 3.0 and 3.2', () => {
  const cues = [{ at: 3, cue: 'click' }, { at: 3.1, cue: 'ding' }, { at: 3.2, cue: 'pop' }];
  assert.deepEqual(pairs(plan(film({ mode: 'viral', cues }))), [[3, 'click'], [3.2, 'pop']]);
});

test('a silent event takes no room: a marker 0.05 s after desk\'s silent emphasis still sounds', () => {
  const cues = plan(film({ sound: 'on' }, { openOn: [{ at: 0.55, do: 'circle' }] }));
  assert.deepEqual(pairs(cues)[0], [0.55, 'marker']);
});

test('at the same moment as the cut into its shot, a device wins: the cut cue is dropped', () => {
  const cues = plan(film({ mode: 'viral' }, { clipOn: [{ at: 'start', do: 'highlight' }] }));
  assert.deepEqual(pairs(cues).filter(([t]) => t === 3), [[3, 'pop']]);
});

test('a device the look names no sound for makes no cue', () => {
  const cues = plan(film({ sound: 'on' }, { clipOn: [{ at: 'word:this', do: 'shake' }] }));
  assert.deepEqual(pairs(cues), [[3, 'paper'], [5.5, 'paper'], [6.1, 'click']]);
});

// ---- cue names ----

test('every cue desk and pop name is one the synth knows', () => {
  assert.ok(Object.isFrozen(KNOWN_CUES));
  for (const name of ['desk', 'pop']) {
    const { sounds } = registries.looks.get(name);
    const named = [...Object.values(sounds.cut), ...Object.values(sounds.device), sounds.emphasis, sounds.land].filter((c) => c !== null);
    for (const cue of named) assert.ok(KNOWN_CUES.includes(cue), `${name} names "${cue}"`);
  }
});

test('a cue name no synth knows, in the explicit list, is an error listing the known names', () => {
  assert.throws(() => plan(film({ mode: 'viral', cues: [{ at: 1, cue: 'ding' }, { at: 2, cue: 'boing' }] })), (e) => {
    assert.match(e.message, /^cues\[1\]\.cue: unknown cue "boing"; known cues: /);
    assert.equal(e.message.split('known cues: ')[1], KNOWN_CUES.join(', '));
    return true;
  });
});

test('a cue name no synth knows, in a look, is an error naming the look and the sound', () => {
  const looks = createRegistry('look');
  const desk = registries.looks.get('desk');
  looks.add('test-boing', { ...desk, name: 'test-boing', sounds: { ...desk.sounds, land: 'boing' } });
  assert.throws(() => plan(film({ sound: 'on', look: 'test-boing' }), { looks }), /look "test-boing": sounds\.land: unknown cue "boing"; known cues: .*sub/);
});

test('a look with no sounds is an error naming the look, not a TypeError', () => {
  const looks = createRegistry('look');
  looks.add('desk', { name: 'desk', modes: ['pro'], cuts: ['cut'] });
  assert.throws(() => plan(film({ sound: 'on' }), { looks }), /look "desk" has no sounds/);
});

// ---- on the real timeline ----

// A number spoken on its cut: the count still runs for its minimum time on screen (engine/kinds/number.mjs MIN_COUNT,
// 0.5 s), and its landing sound fires when the figure lands, not on the cut (branch review B, I5: the sound follows the
// picture). The cut cue at the cut and the land cue at the landing are further apart than MIN_CUE_GAP: both are kept.
const NUMBER_ON_CUT = Object.freeze({
  version: 2,
  mode: 'viral',
  shots: [
    { id: 'hello', show: 'statement', say: 'Hello there.' },
    { id: 'rows', show: 'number', cut: 'cut', say: 'Four hundred fifty nine rows. One file.', value: 459, label: 'in one file' },
  ],
});
const MIN_COUNT_SECONDS = 0.5;
const rounded = (t) => Math.round(t * 1e6) / 1e6;

test('on buildTimeline: a number spoken on its cut plays the cut cue at the cut and the land cue when the count lands on screen', () => {
  const timeline = buildTimeline(NUMBER_ON_CUT, { fps: FPS });
  const rows = timeline.shots[1];
  const land = rows.start + MIN_COUNT_SECONDS;
  const events = soundEvents(NUMBER_ON_CUT, timeline).filter((e) => e.shot === 'rows');
  assert.deepEqual(events.map((e) => [e.kind, rounded(e.t)]), [['cut', rounded(rows.start)], ['land', rounded(land)]], 'spoken on "Four", the first word, but seen to count for 0.5 s');
  assert.ok(land - rows.start > MIN_CUE_GAP, 'further apart than MIN_CUE_GAP');
  const after = pairs(planCues(NUMBER_ON_CUT, timeline)).filter(([t]) => t >= rows.start - EPSILON);
  assert.deepEqual(after, [[rounded(rows.start), 'click'], [rounded(land), 'sub']], 'both kept: the click on the cut, the sub on the landing');
});

test('on buildTimeline: in a look with no cut cue, a number spoken on its cut plays only its land cue, when it lands', () => {
  const timeline = buildTimeline(NUMBER_ON_CUT, { fps: FPS });
  const rows = timeline.shots[1];
  const looks = createRegistry('look');
  const pop = registries.looks.get('pop');
  // the planner's own registry: pop as it is, but silent on a plain cut (the events still read the registered pop)
  looks.add('pop', { ...pop, sounds: { ...pop.sounds, cut: { ...pop.sounds.cut, cut: null } } });
  const cues = planCues(NUMBER_ON_CUT, timeline, { looks });
  assert.deepEqual(pairs(cues).filter(([t]) => t >= rows.start - EPSILON), [[rounded(rows.start + MIN_COUNT_SECONDS), 'sub']]);
});

// ---- fix round 1: chains, order, look checks on every path, pinned behaviour ----

// Two shots, a then b from 2 s, b's first word emphasised 0.1 s in and `on` entries as given: a cut at 2.0, an emphasis
// at 2.1 and whatever the entries add.
function chainFilm(on, extra = {}) {
  const f = { version: 2, mode: 'viral', ...extra, shots: [{ id: 'a', show: 'statement', say: 'One.' }, { id: 'b', show: 'statement', say: '*Now* go.', on }] };
  const timeline = {
    fps: FPS, duration: 4, frameCount: 120, timed: 'estimated',
    shots: [
      { id: 'a', index: 0, start: 0, end: 2, duration: 2, words: [word('One.', 0, 0.4)], sentences: [] },
      { id: 'b', index: 1, start: 2, end: 4, duration: 2, words: [word('Now', 0.1, 0.4, true), word('go.', 0.5, 0.8)], sentences: [] },
    ],
  };
  return { f, timeline };
}

test('a chain of clashes keeps every cue that clashes with nothing kept: cut 2.0, emphasis 2.1, device 2.2 give the cut and the device', () => {
  const { f, timeline } = chainFilm([{ at: 0.2, do: 'highlight' }]);
  assert.deepEqual(pairs(planCues(f, timeline)), [[2, 'click'], [2.2, 'pop']]);
});

test('the kept cues do not depend on the order of the input', () => {
  const forward = chainFilm([{ at: 0.2, do: 'highlight' }, { at: 0.3, do: 'punch' }]);
  const backward = chainFilm([{ at: 0.3, do: 'punch' }, { at: 0.2, do: 'highlight' }]);
  assert.deepEqual(planCues(backward.f, backward.timeline), planCues(forward.f, forward.timeline));
  const sorted = [{ at: 3, cue: 'click' }, { at: 3.1, cue: 'ding' }, { at: 3.2, cue: 'pop' }];
  const shuffled = [sorted[2], sorted[0], sorted[1]];
  assert.deepEqual(plan(film({ mode: 'viral', cues: shuffled })), plan(film({ mode: 'viral', cues: sorted })));
});

test('when a film brings its own list, the look\'s cue names are still checked', () => {
  const looks = createRegistry('look');
  const pop = registries.looks.get('pop');
  looks.add('test-boing', { ...pop, name: 'test-boing', sounds: { ...pop.sounds, emphasis: 'boing' } });
  assert.throws(() => plan(film({ mode: 'viral', look: 'test-boing', cues: [{ at: 1, cue: 'ding' }] }), { looks }), /look "test-boing": sounds\.emphasis: unknown cue "boing"/);
});

test('at plan time a look must still name a sound for every registered cut and device, or it is an error, not silence', () => {
  const looks = createRegistry('look');
  const pop = registries.looks.get('pop');
  const { punch: _gone, ...cut } = pop.sounds.cut;
  looks.add('test-no-punch', { ...pop, name: 'test-no-punch', sounds: { ...pop.sounds, cut } });
  assert.throws(() => plan(film({ mode: 'viral', look: 'test-no-punch' }), { looks }), /look "test-no-punch": sounds\.cut\.punch must be a cue name or null/);
});

test('pinned: two emphasised runs with nothing between them make one emphasis event (say.mjs keeps no run boundaries)', () => {
  const f = { version: 2, shots: [{ id: 'a', show: 'statement', say: 'The *end.* *Start* now.' }] };
  const timeline = {
    fps: FPS, duration: 3, frameCount: 90, timed: 'estimated',
    shots: [{ id: 'a', index: 0, start: 0, end: 3, duration: 3, words: [word('The', 0, 0.2), word('end.', 0.3, 0.6, true), word('Start', 0.9, 1.2, true), word('now.', 1.3, 1.6)], sentences: [] }],
  };
  assert.deepEqual(soundEvents(f, timeline), [{ kind: 'emphasis', t: 0.3, shot: 'a' }]);
});

test('a device 0.2 s into a slide sounds as well as the slide: they are further apart than MIN_CUE_GAP', () => {
  assert.deepEqual(pairs(plan(film({ mode: 'viral' }, { clipOn: [{ at: 0.2, do: 'highlight' }] }))).filter(([t]) => t >= 3 && t < 3.5), [[3, 'whoosh'], [3.2, 'pop']]);
});

test('a one-shot film has no cut events', () => {
  const f = { version: 2, mode: 'viral', shots: [{ id: 'solo', show: 'statement', say: '*Now.*' }] };
  const timeline = { fps: FPS, duration: 2, frameCount: 60, timed: 'estimated', shots: [{ id: 'solo', index: 0, start: 0, end: 2, duration: 2, words: [word('Now.', 0.1, 0.4, true)], sentences: [] }] };
  assert.deepEqual(soundEvents(f, timeline), [{ kind: 'emphasis', t: 0.1, shot: 'solo' }]);
  assert.deepEqual(pairs(planCues(f, timeline)), [[0.1, 'pop']]);
});

// ---- the heard times (final review I1): sound reads when a word is heard, not when the picture shows it ----

// A measured viral film: shot b's first word, *Big*, is heard `heardAt` s into its WAV (after an opening pause, or the
// voice's lead-in), while the picture shows it from the shot's first frame.
function heardFilm(heardAt, say = '*Big* news.') {
  const film = { version: 2, mode: 'viral', voice: { name: 'af_heart' }, shots: [{ id: 'a', show: 'statement', say: 'One.' }, { id: 'b', show: 'statement', cut: 'cut', say }] };
  const words = [
    { id: 'a', wav: 'shot-0.wav', seconds: 1, sentences: [{ words: [{ text: 'One.', start: 0.1, end: 0.4 }] }] },
    { id: 'b', wav: 'shot-1.wav', seconds: heardAt + 1.2, sentences: [{ words: [{ text: 'Big', start: heardAt, end: heardAt + 0.3 }, { text: 'news.', start: heardAt + 0.4, end: heardAt + 0.8 }] }] },
  ];
  const timeline = buildTimeline(film, { fps: FPS, words });
  return { film, timeline, b: timeline.shots[1] };
}
const near = (a, b) => Math.abs(a - b) < 1e-6;

for (const [label, heardAt, say] of [['a 0.5 s lead-in', 0.5, '*Big* news.'], ['an opening pause of 1 s', 1, '(1.0) *Big* news.']]) {
  test(`I1, ${label}: the emphasis cue sounds when the word is heard, and the cut keeps its own cue`, () => {
    const { film, timeline, b } = heardFilm(heardAt, say);
    assert.equal(b.words[0].start, 0, 'the picture still shows the word from the shot start');
    const emphasis = soundEvents(film, timeline).filter((e) => e.kind === 'emphasis' && e.shot === 'b');
    assert.equal(emphasis.length, 1);
    assert.ok(near(emphasis[0].t, b.start + heardAt), `emphasis at ${emphasis[0].t}, heard at ${b.start + heardAt}`);
    const cues = planCues(film, timeline).filter((c) => c.t >= b.start - 1e-9);
    assert.deepEqual(pairs(cues).map(([, cue]) => cue), ['click', 'pop'], JSON.stringify(cues));
    assert.ok(near(cues[0].t, b.start) && near(cues[1].t, b.start + heardAt));
  });

  test(`I1, ${label}: an explicit word anchor and the duck follow the heard word`, () => {
    const { film, timeline, b } = heardFilm(heardAt, say);
    const [cue] = planCues({ ...film, cues: [{ at: 'word:Big', cue: 'ding' }] }, timeline);
    assert.ok(near(cue.t, b.start + heardAt), `ding at ${cue.t}`);
    const [onSentence] = planCues({ ...film, cues: [{ at: 'sentence:1', cue: 'ding' }] }, timeline);
    assert.ok(near(onSentence.t, b.start + heardAt), `a cue on shot b's first sentence at ${onSentence.t}`);
    const big = heardWordSpans(timeline).find((s) => s.start >= b.start - 1e-9);
    assert.ok(near(big.start, b.start + heardAt) && near(big.end, b.start + heardAt + 0.3), JSON.stringify(big));
  });
}

test('I1: on an estimated timeline the heard times are the shown times', () => {
  const timeline = buildTimeline({ version: 2, shots: [{ id: 'a', show: 'statement', say: '(1.0) *Big* news.' }] }, { fps: FPS });
  for (const w of timeline.shots[0].words) assert.deepEqual([w.soundStart, w.soundEnd], [w.start, w.end]);
});

// ---- a kind's own events (the list's items, final wave follow-up) ----

test('a list shot in pop with sound on plans one pop per item after the first, at the time each item arrives', () => {
  const film = { version: 2, mode: 'viral', look: 'pop', shots: [{ id: 'steps', show: 'list', items: ['Write it', 'Render it', 'Share it'] }] };
  const timeline = buildTimeline(film, { fps: FPS });
  const { kinds } = registries;
  const arrivals = kinds.get('list').events(film.shots[0], timeline.shots[0]).map((e) => timeline.shots[0].start + e.t);
  assert.equal(arrivals.length, 2, 'item 0 arrives on the shot start: it sends no event');
  const items = soundEvents(film, timeline).filter((e) => e.kind === 'device' && e.device === 'item');
  assert.deepEqual(items.map((e) => [e.t, e.shot]), arrivals.map((t) => [t, 'steps']));
  assert.deepEqual(pairs(planCues(film, timeline)), arrivals.map((t) => [Math.round(t * 1e6) / 1e6, 'pop']));
});

test('a compare shot sounds its turn when the second side arrives: paper in desk (sound on), a whoosh in pop', () => {
  const shot = { id: 'swap', show: 'compare', say: 'Before, you ran a server. After, you share one file.', left: { title: 'A server' }, right: { title: 'One file' } };
  for (const [film, cue] of [[{ version: 2, mode: 'pro', look: 'desk', sound: 'on', shots: [shot] }, 'paper'], [{ version: 2, mode: 'viral', look: 'pop', shots: [shot] }, 'whoosh']]) {
    const timeline = buildTimeline(film, { fps: FPS });
    const turn = timeline.shots[0].start + registries.kinds.get('compare').events(shot, timeline.shots[0])[0].t;
    assert.deepEqual(pairs(planCues(film, timeline)), [[Math.round(turn * 1e6) / 1e6, cue]], film.look);
  }
});

test('a chart lands its highlighted value as the land event: a click in desk (sound on), a sub in pop', () => {
  const shot = { id: 'g', show: 'chart', type: 'column', title: 'Q3 carried the year', say: 'Sales rose every quarter. Q3 carried the year.', data: [{ label: 'Q1', value: 12 }, { label: 'Q3', value: 31 }], highlight: 'Q3' };
  for (const [film, cue] of [[{ version: 2, mode: 'pro', look: 'desk', sound: 'on', shots: [shot] }, 'click'], [{ version: 2, mode: 'viral', look: 'pop', shots: [shot] }, 'sub']]) {
    const timeline = buildTimeline(film, { fps: FPS });
    const land = timeline.shots[0].start + registries.kinds.get('chart').landing(shot, timeline.shots[0]);
    assert.ok(soundEvents(film, timeline).some((e) => e.kind === 'land' && e.t === land), film.look);
    assert.deepEqual(pairs(planCues(film, timeline)), [[Math.round(land * 1e6) / 1e6, cue]], film.look);
  }
});

test('a cut into a list keeps its own cue: item 0 sends no event (it arrives on the cut), items 1 on sound when heard', () => {
  const film = { version: 2, mode: 'viral', look: 'pop', shots: [{ id: 'a', show: 'statement', say: 'First things first.' }, { id: 'steps', show: 'list', cut: 'slide', say: 'Write it. Render it. Share it.', items: ['Write it', 'Render it', 'Share it'] }] };
  const timeline = buildTimeline(film, { fps: FPS });
  const entry = timeline.shots[1];
  const events = registries.kinds.get('list').events(film.shots[1], entry);
  assert.deepEqual(events.map((e) => e.t), [entry.sentences[1].start, entry.sentences[2].start], 'items 1 and 2 at their sentences (shot seconds)');
  const cues = pairs(planCues(film, timeline));
  const atCut = cues.filter(([t]) => Math.abs(t - Math.round(entry.start * 1e6) / 1e6) < 1e-6);
  assert.deepEqual(atCut.map(([, c]) => c), [registries.looks.get('pop').sounds.cut.slide], JSON.stringify(cues));
});

test('a kind event naming a device the kind did not declare in eventDevices is an error, never a silent cue', () => {
  const kinds = createRegistry('kinds');
  const list = registries.kinds.get('list');
  kinds.add('list', { ...list, events: () => [{ kind: 'device', device: 'bell', t: 0 }] });
  const film = { version: 2, mode: 'viral', look: 'pop', shots: [{ id: 'steps', show: 'list', items: ['A', 'B'] }] };
  const timeline = buildTimeline(film, { fps: FPS });
  assert.throws(() => soundEvents(film, timeline, { kinds }), /kind "list" sent the device event "bell", which its eventDevices \(item\) does not declare/);
});

test('a look without a sound for a device a kind declares is an error naming it', () => {
  const looks = createRegistry('looks');
  const pop = registries.looks.get('pop');
  const { item: _gone, ...device } = pop.sounds.device;
  looks.add('pop', { ...pop, sounds: { ...pop.sounds, device } });
  const film = { version: 2, mode: 'viral', look: 'pop', shots: [{ id: 'steps', show: 'list', items: ['A', 'B'] }] };
  assert.throws(() => planCues(film, buildTimeline(film, { fps: FPS }), { looks }), /look "pop": sounds\.device\.item must be a cue name or null \(kind "list" sends it\)/);
});

// ---- determinism ----

test('the plan is frozen data and the same film plans the same cues', () => {
  const first = plan(film({ mode: 'viral' }));
  assert.deepEqual(plan(film({ mode: 'viral' })), first);
  assert.ok(Object.isFrozen(first) && first.every(Object.isFrozen));
});

test('an on event aimed at a part off screen when it fires is a creative finding naming the part\'s window, and plans no cue', () => {
  const list = { id: 'steps', show: 'list', say: 'Write it. Render it. Share it.', items: ['Write it', 'Render it', 'Share it'], on: [{ at: 'word:write', do: 'underline', target: 'item:2' }, { at: 'word:share', do: 'underline', target: 'item:2' }] };
  const compare = { id: 'swap', show: 'compare', say: 'Before, you ran a server. After, you share one file.', left: { title: 'A server' }, right: { title: 'One file' }, on: [{ at: 'word:before', do: 'underline', target: 'right' }] };
  for (const shot of [list, compare]) {
    const film = { version: 2, mode: 'viral', look: 'pop', shots: [shot] };
    const timeline = buildTimeline(film, { fps: FPS });
    const kind = registries.kinds.get(shot.show);
    const found = kind.review(shot, { look: registries.looks.get('pop'), timing: timeline.shots[0], at: (ref) => resolveAnchor(ref, timeline.shots[0]) });
    const hidden = found.filter((f) => f.path === 'on[0].at');
    assert.equal(hidden.length, 1, `${shot.show}: ${JSON.stringify(found)}`);
    assert.match(hidden[0].message, /on screen only from \d+\.\d+ s to \d+\.\d+ s/);
    assert.ok(!found.some((f) => f.path === 'on[1].at'), `${shot.show}: an event inside the window is fine`);
    const devices = soundEvents(film, timeline).filter((e) => e.kind === 'device' && e.device === 'underline');
    assert.equal(devices.length, shot.on.length - 1, `${shot.show}: the hidden event plans no cue`);
  }
});

// Sound cues are planned from the film's own events (cuts, devices, emphasis, a number landing), asking the film's look
// which cue each event makes and its mode whether cues play at all. Times come from a hand-built fixture timeline, so
// every expected second below is read straight off it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry, registries } from '../../engine/registry.mjs';
import '../../engine/looks/index.mjs';
import '../../engine/modes/index.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { soundEvents } from '../../scripts/v2/sound/events.mjs';
import { planCues, CUE_GAIN_DB, MIN_CUE_GAP } from '../../scripts/v2/sound/cues.mjs';
import { KNOWN_CUES } from '../../scripts/v2/sound/synth.mjs';

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

test('a bad anchor in the explicit list is an error naming its path', () => {
  assert.throws(() => plan(film({ mode: 'viral', cues: [{ at: 1, cue: 'ding' }, { at: 'word:nothing', cue: 'ding' }] })), /cues\[1\]\.at: no word "nothing"/);
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

test('on buildTimeline: a number whose say opens on its figure lands on the cut, and the landing is the cue kept', () => {
  const f = {
    version: 2,
    mode: 'viral',
    shots: [
      { id: 'hello', show: 'statement', say: 'Hello there.' },
      { id: 'rows', show: 'number', cut: 'cut', say: 'Four hundred fifty nine rows. One file.', value: 459, label: 'in one file' },
    ],
  };
  const timeline = buildTimeline(f, { fps: FPS });
  const rows = timeline.shots[1];
  const events = soundEvents(f, timeline).filter((e) => e.shot === 'rows');
  assert.deepEqual(events.map((e) => [e.kind, e.t]), [['cut', rows.start], ['land', rows.start]], 'the count lands on "Four", the first word, at the shot start');
  assert.deepEqual(pairs(planCues(f, timeline)).filter(([t]) => t >= rows.start - EPSILON), [[Math.round(rows.start * 1e6) / 1e6, 'sub']], 'the click is dropped: the number arriving wins the tie with the cut');
});

// ---- determinism ----

test('the plan is frozen data and the same film plans the same cues', () => {
  const first = plan(film({ mode: 'viral' }));
  assert.deepEqual(plan(film({ mode: 'viral' })), first);
  assert.ok(Object.isFrozen(first) && first.every(Object.isFrozen));
});

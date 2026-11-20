import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, chmodSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRegistry } from '../../engine/registry.mjs';
import { validateFilm, withFilmDefaults, SpecError, anchorSpanErrors } from '../../scripts/v2/spec.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { loadFilm } from '../../scripts/v2/pipeline.mjs';
import { hintRefusals } from '../../scripts/v2/voice/calls.mjs';

// The registries are module singletons, so these tests pass their own stubs
// instead of registering into the shared ones. The modes are data the validator
// and the timeline read (mode choice, default look and format, pace).
const STUB_MODES = [
  { name: 'pro', defaultLook: 'desk', defaultFormat: '16:9', wpm: 150, tail: 0.6, voiceSpeed: 1.0, emphasisPause: 0, loudness: { lufs: -16, truePeakDb: -1.5, lra: 11 }, cues: false, captions: false },
  { name: 'viral', defaultLook: 'pop', defaultFormat: '9:16', wpm: 175, tail: 0.3, voiceSpeed: 1.0, emphasisPause: 0, loudness: { lufs: -14, truePeakDb: -1, lra: 9 }, cues: true, captions: true },
];
function stubRegistries({ modes = STUB_MODES } = {}) {
  const r = {
    kinds: createRegistry('kind'),
    looks: createRegistry('look'),
    modes: createRegistry('mode'),
    devices: createRegistry('device'),
  };
  r.kinds.add('statement', {
    schema: { properties: { text: { type: 'string' } } },
    targets: () => ['text'],
  });
  r.kinds.add('picture', {
    schema: { properties: { src: { type: 'string' }, caption: { type: 'string' } }, required: ['src'] },
    srcFields: ['src'],
    targets: () => ['image', 'caption'],
  });
  r.kinds.add('plain', { schema: { properties: {} } }); // no targets function: accepts no target
  r.kinds.add('gallery', {
    schema: { properties: { srcs: { type: 'array', items: { type: 'string' } }, items: { type: 'array', items: { type: 'object' } } } },
    srcFields: ['srcs', 'items.0.src'],
    targets: () => [],
  });
  r.looks.add('desk', { name: 'desk', modes: ['pro'], cuts: ['cut', 'match'] });
  r.looks.add('pop', { name: 'pop', modes: ['viral'], cuts: ['cut'] });
  r.devices.add('highlight', { supports: () => true });
  r.devices.add('shake', { supports: (look) => look.name === 'pop' });
  for (const mode of modes) r.modes.add(mode.name, mode);
  return r;
}

let specDir;
let registries;
before(() => {
  specDir = mkdtempSync(path.join(tmpdir(), 'mm-v2-spec-'));
  mkdirSync(path.join(specDir, 'assets'));
  writeFileSync(path.join(specDir, 'assets', 'photo.png'), 'x');
  writeFileSync(path.join(specDir, 'film.json'), '{}');
  writeFileSync(path.join(specDir, 'clip:1.png'), 'x');
  registries = stubRegistries();
});
after(() => rmSync(specDir, { recursive: true, force: true }));

const check = (spec, regs = registries) => validateFilm(spec, { specDir, registries: regs });
const shotA = { id: 'a', show: 'statement', say: 'Hi.' };
const film = (extra = {}, shots = [shotA]) => ({ version: 2, shots, ...extra });

// --- binding tests from the brief ---

test('the file the version 1 refusal names exists', () => {
  const message = validateFilm({ scenes: [] }, { specDir: tmpdir() }).errors[0].message;
  const named = message.match(/See (references\/[a-z-]+\.md)/)[1];
  assert.ok(existsSync(path.join(import.meta.dirname, '../..', named)), `${named} exists in the skill folder`);
});

test('a version 1 spec gets one clear error', () => {
  const r = check({ scenes: [] });
  assert.deepEqual(r.errors, [{ path: '', message: 'this is a version 1 spec; make-motion 2 reads version 2 only. See references/migrating.md' }]);
});
test('a misspelled field gets a did-you-mean with its path', () => {
  const r = check({ version: 2, shots: [{ id: 'a', show: 'statment', say: 'Hi.' }] });
  assert.match(r.errors[0].path, /^shots\[0\]\.show$/);
  assert.match(r.errors[0].message, /did you mean "statement"/);
});
test('an anchor to a word that is not spoken lists the words', () => {
  const r = check({ version: 2, shots: [{ id: 'a', show: 'statement', say: 'One file.', on: [{ at: 'word:server', do: 'highlight', target: 'text' }] }] });
  assert.match(r.errors[0].message, /no word "server" in shot "a"; its words are: One, file\./);
});
test('a target the kind does not have lists its targets', () => {
  const r = check({ version: 2, shots: [{ id: 'a', show: 'statement', say: 'One file.', on: [{ at: 'word:file', do: 'highlight', target: 'label' }] }] });
  assert.match(r.errors[0].message, /targets of statement are: text/);
});
test('a look that does not serve the mode is refused', () => {
  const r = check({ version: 2, mode: 'viral', look: 'desk', shots: [{ id: 'a', show: 'statement', say: 'Hi.' }] });
  assert.match(r.errors[0].message, /look "desk" does not serve mode "viral"/);
});

// --- the happy path ---

test('a minimal film is valid', () => {
  assert.deepEqual(check(film()), { ok: true, errors: [] });
});
test('a full film is valid', () => {
  const full = film(
    { mode: 'pro', look: 'desk', format: '16:9', fps: 60, seed: 7918, accent: '#ff6600', generatedBy: { model: 'x' } },
    [
      { id: 'one', show: 'statement', say: 'One file.', text: 'hello', on: [{ at: 'word:file', do: 'highlight', target: 'text' }] },
      { id: 'two-b', show: 'statement', hold: 2, cut: 'match' },
    ],
  );
  assert.deepEqual(check(full), { ok: true, errors: [] });
});

// --- version and shape of the root ---

test('a version 1 spec is recognised by its scenes array even when it says version 2', () => {
  const r = check({ version: 2, scenes: [], shots: [shotA] });
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].path, '');
  assert.match(r.errors[0].message, /version 1 spec/);
});
test('version 1 written out is the same single error', () => {
  const r = check({ version: 1, shots: [shotA] });
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /make-motion 2 reads version 2 only/);
});
test('a missing version says what to write', () => {
  const r = check({ shots: [shotA] });
  assert.deepEqual(r.errors, [{ path: 'version', message: 'required; write "version": 2' }]);
});
test('a version that is not 1 or 2 says what to write', () => {
  const r = check({ version: '2', shots: [shotA] });
  assert.equal(r.errors[0].path, 'version');
  assert.match(r.errors[0].message, /must be 2/);
});
test('a spec that is not an object is an error at the root', () => {
  for (const bad of [null, [], 'film', 7, true, undefined]) {
    const r = check(bad);
    assert.equal(r.ok, false);
    assert.equal(r.errors.length, 1);
    assert.equal(r.errors[0].path, '');
    assert.match(r.errors[0].message, /JSON object/);
  }
});
test('an unknown root field gets a did-you-mean', () => {
  const r = check({ ...film(), moed: 'pro' });
  assert.deepEqual(r.errors, [{ path: 'moed', message: 'unknown property; did you mean "mode"?' }]);
});
test('a misspelled shots does not also report shots as missing', () => {
  const r = check({ version: 2, shot: [shotA] });
  assert.deepEqual(r.errors, [{ path: 'shot', message: 'unknown property; did you mean "shots"?' }]);
});
test('an unknown root field with no near match lists the allowed ones', () => {
  const r = check({ ...film(), zzzzzzzz: 1 });
  assert.equal(r.errors[0].path, 'zzzzzzzz');
  assert.match(r.errors[0].message, /allowed: .*shots/);
});
test('shots needs one to sixty entries', () => {
  assert.equal(check(film({}, [])).errors[0].path, 'shots');
  const many = Array.from({ length: 61 }, (_, i) => ({ id: `s${i}`, show: 'statement', hold: 1 }));
  assert.equal(check(film({}, many)).errors[0].path, 'shots');
  assert.equal(check(film({}, many.slice(0, 60))).ok, true);
});
test('fps must be one of 24, 25, 30, 60', () => {
  const r = check(film({ fps: 50 }));
  assert.equal(r.errors[0].path, 'fps');
  assert.match(r.errors[0].message, /must be one of 24, 25, 30, 60/);
  for (const fps of [24, 25, 30, 60]) assert.equal(check(film({ fps })).ok, true);
});
test('seed must be an integer from 0 to 7918', () => {
  for (const seed of [-1, 7919, 1.5, '3']) {
    const r = check(film({ seed }));
    assert.equal(r.errors[0].path, 'seed', `seed ${JSON.stringify(seed)}`);
  }
  assert.equal(check(film({ seed: 0 })).ok, true);
  assert.equal(check(film({ seed: 7918 })).ok, true);
});
test('accent must be #rrggbb and the error shows one', () => {
  for (const accent of ['red', '#fff', '#12345g', 5]) {
    const r = check(film({ accent }));
    assert.equal(r.errors[0].path, 'accent', `accent ${JSON.stringify(accent)}`);
  }
  assert.match(check(film({ accent: 'red' })).errors[0].message, /#rrggbb/);
  assert.equal(check(film({ accent: '#A1b2C3' })).ok, true);
});
test('mode and format name their choices', () => {
  assert.match(check(film({ mode: 'provv' })).errors[0].message, /did you mean "pro"/);
  assert.equal(check(film({ format: '4:3' })).errors[0].path, 'format');
});
test('an unknown look gets a did-you-mean from the registry', () => {
  const r = check(film({ look: 'dsk' }));
  assert.equal(r.errors[0].path, 'look');
  assert.match(r.errors[0].message, /did you mean "desk"/);
});
test('a mode with no registered default look says so', () => {
  const regs = stubRegistries();
  const bare = { ...regs, looks: createRegistry('look') };
  const r = check(film(), bare);
  assert.equal(r.errors[0].path, 'look');
  assert.match(r.errors[0].message, /default look for mode "pro" is "desk"/);
});

// --- shots ---

test('duplicate ids are errors at the later shot', () => {
  const r = check(film({}, [shotA, { ...shotA }]));
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].path, 'shots[1].id');
  assert.match(r.errors[0].message, /duplicate id "a".*shots\[0\]/);
});
test('an id must be lowercase letters, digits and hyphens starting with a letter', () => {
  for (const id of ['Bad', '1st', 'a_b', '', 'a b']) {
    const r = check(film({}, [{ ...shotA, id }]));
    assert.equal(r.errors[0].path, 'shots[0].id', `id ${JSON.stringify(id)}`);
  }
  assert.match(check(film({}, [{ ...shotA, id: 'Bad' }])).errors[0].message, /lowercase/);
});
test('a shot with no id says it is required', () => {
  const r = check(film({}, [{ show: 'statement', say: 'Hi.' }]));
  assert.deepEqual(r.errors, [{ path: 'shots[0].id', message: 'required (string)' }]); // 1.3.0: required names the type
});
test('a shot with no show lists the kinds', () => {
  const r = check(film({}, [{ id: 'a', say: 'Hi.' }]));
  assert.equal(r.errors[0].path, 'shots[0].show');
  assert.match(r.errors[0].message, /required; one of: statement, picture/);
});
test('hold together with say is an error at hold', () => {
  const r = check(film({}, [{ ...shotA, hold: 2 }]));
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].path, 'shots[0].hold');
  assert.match(r.errors[0].message, /remove "hold"|remove "say"/);
});
test('hold alone is fine and has a range', () => {
  assert.equal(check(film({}, [{ id: 'a', show: 'statement', hold: 30 }])).ok, true);
  assert.equal(check(film({}, [{ id: 'a', show: 'statement', hold: 1 }])).ok, true);
  assert.equal(check(film({}, [{ id: 'a', show: 'statement', hold: 0.5 }])).errors[0].path, 'shots[0].hold', 'every shot lasts at least 1 s');
  assert.equal(check(film({}, [{ id: 'a', show: 'statement', hold: 31 }])).errors[0].path, 'shots[0].hold');
});
test('a say that does not parse is an error at say with the parser message', () => {
  const r = check(film({}, [{ ...shotA, say: 'this is *broken' }]));
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].path, 'shots[0].say');
  assert.match(r.errors[0].message, /unclosed \* in "this is \*broken"/);
});
test('a say has a length range', () => {
  assert.equal(check(film({}, [{ ...shotA, say: '' }])).errors[0].path, 'shots[0].say');
  assert.equal(check(film({}, [{ ...shotA, say: 'a'.repeat(401) }])).errors[0].path, 'shots[0].say');
  assert.equal(check(film({}, [{ ...shotA, say: 'a'.repeat(400) }])).ok, true);
});
test('a misspelled shot field gets a did-you-mean', () => {
  const r = check(film({}, [{ ...shotA, sayy: 'x' }]));
  assert.deepEqual(r.errors, [{ path: 'shots[0].sayy', message: 'unknown property; did you mean "say"?' }]);
});
test("a kind's own field is checked by the kind's schema", () => {
  const typo = check(film({}, [{ ...shotA, txet: 'x' }]));
  assert.deepEqual(typo.errors, [{ path: 'shots[0].txet', message: 'unknown property; did you mean "text"?' }]);
  const wrongType = check(film({}, [{ ...shotA, text: 5 }]));
  assert.deepEqual(wrongType.errors, [{ path: 'shots[0].text', message: 'must be string' }]);
});
test("a kind's required fields are required", () => {
  const r = check(film({}, [{ id: 'p', show: 'picture', hold: 2 }]));
  assert.deepEqual(r.errors, [{ path: 'shots[0].src', message: 'required (string)' }]); // 1.3.0: required names the type
});
test('a kind schema cannot redefine a shot field', () => {
  const regs = stubRegistries();
  regs.kinds.add('clash', { schema: { properties: { say: { type: 'number' } } }, targets: () => [] });
  assert.throws(() => check(film({}, [{ id: 'a', show: 'clash' }]), regs), /kind "clash".*"say"/);
});
test('an unknown kind does not flag its other fields as unknown', () => {
  const r = check(film({}, [{ id: 'a', show: 'statment', say: 'Hi.', text: 'x' }]));
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].path, 'shots[0].show');
});
test('every shot is checked and every error is collected', () => {
  const r = check(film({ fps: 50 }, [
    { id: 'a', show: 'statment', say: 'Hi.' },
    { id: 'a', show: 'statement', say: '*oops' },
  ]));
  assert.deepEqual(r.errors.map((e) => e.path).sort(), ['fps', 'shots[0].show', 'shots[1].id', 'shots[1].say'].sort());
});

// --- cuts ---

test('a cut on the first shot other than "cut" is refused', () => {
  const r = check(film({}, [{ ...shotA, cut: 'match' }]));
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].path, 'shots[0].cut');
  assert.match(r.errors[0].message, /first shot/);
  assert.match(r.errors[0].message, /"cut"/);
});
test('the plain cut is allowed on the first shot', () => {
  assert.equal(check(film({}, [{ ...shotA, cut: 'cut' }])).ok, true);
});
test('a cut the look does not list names the look and its cuts', () => {
  const r = check(film({}, [shotA, { id: 'b', show: 'statement', say: 'Yo.', cut: 'fade' }]));
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].path, 'shots[1].cut');
  assert.match(r.errors[0].message, /look "desk"/);
  assert.match(r.errors[0].message, /cut, match/);
});
test('a near-miss cut gets a did-you-mean', () => {
  const r = check(film({}, [shotA, { id: 'b', show: 'statement', say: 'Yo.', cut: 'matc' }]));
  assert.match(r.errors[0].message, /did you mean "match"/);
});
test('a listed cut is fine', () => {
  assert.equal(check(film({}, [shotA, { id: 'b', show: 'statement', say: 'Yo.', cut: 'match' }])).ok, true);
});

// --- on: anchors, devices, targets ---

test('on has at most eight entries and closed fields', () => {
  const nine = Array.from({ length: 9 }, () => ({ at: 'start', do: 'highlight' }));
  assert.equal(check(film({}, [{ ...shotA, on: nine }])).errors[0].path, 'shots[0].on');
  const r = check(film({}, [{ ...shotA, on: [{ at: 'start', do: 'highlight', why: 1 }] }]));
  assert.equal(r.errors[0].path, 'shots[0].on[0].why');
});
test('an on entry needs at and do', () => {
  const r = check(film({}, [{ ...shotA, on: [{}] }]));
  assert.deepEqual(r.errors.map((e) => e.path).sort(), ['shots[0].on[0].at', 'shots[0].on[0].do']);
});
test('a bad anchor is an error at the at field with the anchor message', () => {
  const r = check(film({}, [{ ...shotA, on: [{ at: 'middle', do: 'highlight' }] }]));
  assert.equal(r.errors[0].path, 'shots[0].on[0].at');
  assert.match(r.errors[0].message, /word:<n>/);
});
test('a beat anchor says music is missing', () => {
  const r = check(film({}, [{ ...shotA, on: [{ at: 'beat:1', do: 'highlight' }] }]));
  assert.equal(r.errors[0].message, 'beat anchors need music, which this build does not have yet');
});
test('a good anchor, device and target pass', () => {
  const r = check(film({}, [{ ...shotA, say: 'One file.', on: [{ at: 'word:file-0.05', do: 'highlight', target: 'text' }, { at: 0.5, do: 'highlight' }] }]));
  assert.deepEqual(r, { ok: true, errors: [] });
});
test('anchors in a hold shot resolve against its duration', () => {
  const r = check(film({}, [{ id: 'h', show: 'statement', hold: 2, on: [{ at: 'end-0.5', do: 'highlight' }, { at: 'word:x', do: 'highlight' }] }]));
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].path, 'shots[0].on[1].at');
  assert.match(r.errors[0].message, /no narration/);
});
test('an unknown device gets a did-you-mean from the registry', () => {
  const r = check(film({}, [{ ...shotA, on: [{ at: 'start', do: 'hilight' }] }]));
  assert.equal(r.errors[0].path, 'shots[0].on[0].do');
  assert.match(r.errors[0].message, /did you mean "highlight"/);
});
test('a device the look does not support names the look and the ones it does', () => {
  const r = check(film({}, [{ ...shotA, on: [{ at: 'start', do: 'shake' }] }]));
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].path, 'shots[0].on[0].do');
  assert.match(r.errors[0].message, /device "shake" is not supported by look "desk"/);
  assert.match(r.errors[0].message, /highlight/);
});
test('a device the look does support is accepted in another look', () => {
  const r = check({ version: 2, mode: 'viral', shots: [{ ...shotA, on: [{ at: 'start', do: 'shake' }] }] });
  assert.deepEqual(r, { ok: true, errors: [] });
});
test('a target error is at the target field and lists the targets', () => {
  const r = check(film({}, [{ ...shotA, on: [{ at: 'start', do: 'highlight', target: 'label' }] }]));
  assert.equal(r.errors[0].path, 'shots[0].on[0].target');
});
test('a near-miss target gets a did-you-mean', () => {
  const r = check(film({}, [{ id: 'p', show: 'picture', src: 'assets/photo.png', hold: 2, on: [{ at: 'start', do: 'highlight', target: 'captin' }] }]));
  assert.match(r.errors[0].message, /did you mean "caption"/);
  assert.match(r.errors[0].message, /targets of picture are: image, caption/);
});
test('every on entry is checked', () => {
  const r = check(film({}, [{ ...shotA, on: [{ at: 'nope', do: 'hilight' }, { at: 'start', do: 'shake', target: 'zzz' }] }]));
  assert.deepEqual(r.errors.map((e) => e.path).sort(), ['shots[0].on[0].at', 'shots[0].on[0].do', 'shots[0].on[1].do', 'shots[0].on[1].target'].sort());
});
test('anchors are not checked in a shot whose say does not parse', () => {
  const r = check(film({}, [{ ...shotA, say: '*oops', on: [{ at: 'word:x', do: 'highlight' }] }]));
  assert.deepEqual(r.errors.map((e) => e.path), ['shots[0].say']);
});

// --- src fields ---

test('a src inside the spec folder that exists passes', () => {
  assert.equal(check(film({}, [{ id: 'p', show: 'picture', src: 'assets/photo.png', hold: 2 }])).ok, true);
  assert.equal(check(film({}, [{ id: 'p', show: 'picture', src: './assets/../assets/photo.png', hold: 2 }])).ok, true);
});
test('a src that escapes the spec folder is refused', () => {
  const r = check(film({}, [{ id: 'p', show: 'picture', src: '../elsewhere.png', hold: 2 }]));
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].path, 'shots[0].src');
  assert.match(r.errors[0].message, /outside the spec folder/);
});
test('a src that escapes by way of a subfolder is refused', () => {
  const r = check(film({}, [{ id: 'p', show: 'picture', src: 'assets/../../x.png', hold: 2 }]));
  assert.match(r.errors[0].message, /outside the spec folder/);
});
test('an absolute src is refused', () => {
  const r = check(film({}, [{ id: 'p', show: 'picture', src: path.join(specDir, 'assets', 'photo.png'), hold: 2 }]));
  assert.equal(r.errors[0].path, 'shots[0].src');
  assert.match(r.errors[0].message, /absolute/);
});
test('a URL src is refused as not relative', () => {
  const r = check(film({}, [{ id: 'p', show: 'picture', src: 'https://example.com/a.png', hold: 2 }]));
  assert.match(r.errors[0].message, /relative/);
});
test('a missing src names the file', () => {
  const r = check(film({}, [{ id: 'p', show: 'picture', src: 'assets/nope.png', hold: 2 }]));
  assert.equal(r.errors[0].path, 'shots[0].src');
  assert.match(r.errors[0].message, /assets\/nope\.png/);
  assert.match(r.errors[0].message, /not found/);
});
test('a src that is a folder is refused', () => {
  const r = check(film({}, [{ id: 'p', show: 'picture', src: 'assets', hold: 2 }]));
  assert.match(r.errors[0].message, /folder/);
});
test('a symlink that points outside the spec folder is refused', () => {
  const outside = mkdtempSync(path.join(tmpdir(), 'mm-v2-outside-'));
  try {
    writeFileSync(path.join(outside, 'secret.png'), 'x');
    symlinkSync(path.join(outside, 'secret.png'), path.join(specDir, 'assets', 'link.png'));
    const r = check(film({}, [{ id: 'p', show: 'picture', src: 'assets/link.png', hold: 2 }]));
    assert.match(r.errors[0].message, /outside the spec folder/);
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});
test('every picture of an array srcField is held to the film folder, at its own path (branch review A, Minor 1)', () => {
  const r = check(film({}, [{ id: 'g', show: 'gallery', srcs: ['assets/photo.png', '/etc/passwd', 'https://example.com/a.png'], hold: 2 }]));
  assert.deepEqual(r.errors.map((e) => e.path), ['shots[0].srcs[1]', 'shots[0].srcs[2]']);
  assert.match(r.errors[0].message, /absolute/);
});
test('a numbered step in a dotted srcField names the array item: items[0].src, not items.0.src', () => {
  const r = check(film({}, [{ id: 'g', show: 'gallery', items: [{ src: '../outside.png' }], hold: 2 }]));
  assert.deepEqual(r.errors.map((e) => e.path), ['shots[0].items[0].src']);
});
test('a field not declared in srcFields is not treated as a path', () => {
  const r = check(film({}, [{ id: 'p', show: 'picture', src: 'assets/photo.png', caption: '../not-a-path.png', hold: 2 }]));
  assert.deepEqual(r, { ok: true, errors: [] });
});

// --- defaults and immutability ---

test('withFilmDefaults fills every root default for pro', () => {
  const out = withFilmDefaults({ version: 2, shots: [shotA] }, registries);
  assert.equal(out.mode, 'pro');
  assert.equal(out.look, 'desk');
  assert.equal(out.format, '16:9');
  assert.equal(out.fps, 30);
  assert.equal(out.seed, 1);
  assert.equal(out.version, 2);
  assert.deepEqual(out.shots, [shotA]);
});
test('withFilmDefaults fills the viral defaults', () => {
  const out = withFilmDefaults({ version: 2, mode: 'viral', shots: [shotA] }, registries);
  assert.equal(out.look, 'pop');
  assert.equal(out.format, '9:16');
});
test('withFilmDefaults keeps what the author wrote', () => {
  const written = { version: 2, mode: 'viral', look: 'desk', format: '1:1', fps: 60, seed: 9, accent: '#112233', shots: [shotA] };
  assert.deepEqual(withFilmDefaults(written, registries), written);
});
test('a registered mode supplies its own default look and format', () => {
  const regs = stubRegistries({ modes: [{ name: 'pro', defaultLook: 'pop', defaultFormat: '1:1', wpm: 150, tail: 0.6, voiceSpeed: 1.0, emphasisPause: 0, loudness: { lufs: -16, truePeakDb: -1.5, lra: 11 }, cues: false, captions: false }] });
  const out = withFilmDefaults({ version: 2, shots: [shotA] }, regs);
  assert.equal(out.look, 'pop');
  assert.equal(out.format, '1:1');
});
test('withFilmDefaults returns a new object and never mutates its input', () => {
  const input = { version: 2, shots: [{ ...shotA, on: [{ at: 'start', do: 'highlight' }] }] };
  const before = JSON.stringify(input);
  const out = withFilmDefaults(input, registries);
  assert.notEqual(out, input);
  assert.notEqual(out.shots, input.shots);
  assert.equal(JSON.stringify(input), before);
  out.shots[0].on[0].at = 'end';
  assert.equal(JSON.stringify(input), before);
});
test('validateFilm never mutates its input', () => {
  const input = film({ fps: 50 }, [{ ...shotA, on: [{ at: 'nope', do: 'hilight' }] }, { ...shotA }]);
  const before = JSON.stringify(input);
  check(input);
  assert.equal(JSON.stringify(input), before);
});

// --- loadFilm ---

const writeFilm = (name, body) => {
  const file = path.join(specDir, name);
  writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body));
  return file;
};

test('loadFilm returns the film with defaults, its timeline and the spec folder', () => {
  const file = writeFilm('good.json', { version: 2, shots: [{ id: 'a', show: 'statement', say: 'One file.' }, { id: 'b', show: 'statement', hold: 2 }] });
  const out = loadFilm(file, { registries });
  assert.equal(out.specDir, specDir);
  assert.equal(out.film.mode, 'pro');
  assert.equal(out.film.look, 'desk');
  assert.equal(out.film.format, '16:9');
  assert.equal(out.film.fps, 30);
  assert.equal(out.film.seed, 1);
  assert.equal(out.timeline.fps, 30);
  assert.deepEqual(out.timeline.shots.map((s) => s.id), ['a', 'b']);
  assert.equal(out.timeline.shots[1].duration, 2);
});
test('loadFilm says when the rules that judge time were not run: a voiced film waits for its measured timeline', () => {
  const silent = writeFilm('timing-silent.json', { version: 2, shots: [{ id: 'a', show: 'statement', say: 'One file.' }] });
  assert.equal(loadFilm(silent, { registries }).timingJudged, true);
  const voiced = writeFilm('timing-voiced.json', { version: 2, voice: { name: 'af_heart' }, shots: [{ id: 'a', show: 'statement', say: 'One file.' }] });
  const out = loadFilm(voiced, { registries });
  assert.equal(out.timingJudged, false, 'anchors outside their shots and time-dependent kind rules are judged on the measured timeline (run.mjs)');
  assert.equal(out.timeline.timed, 'estimated');
});
test('loadFilm honours the fps in the film', () => {
  const file = writeFilm('fps.json', { version: 2, fps: 60, shots: [{ id: 'a', show: 'statement', hold: 2 }] });
  assert.equal(loadFilm(file, { registries }).timeline.fps, 60);
});
test('loadFilm throws SpecError carrying every error', () => {
  const file = writeFilm('bad.json', { version: 2, fps: 50, shots: [{ id: 'a', show: 'statment', say: 'Hi.' }] });
  assert.throws(() => loadFilm(file, { registries }), (err) => {
    assert.ok(err instanceof SpecError);
    assert.ok(err instanceof Error);
    assert.deepEqual(err.errors.map((e) => e.path).sort(), ['fps', 'shots[0].show']);
    assert.match(err.message, /shots\[0\]\.show: unknown kind "statment"/);
    assert.match(err.message, /fps: must be one of/);
    return true;
  });
});
test('loadFilm names the path of a file it cannot read', () => {
  const file = path.join(specDir, 'missing.json');
  assert.throws(() => loadFilm(file, { registries }), (err) => {
    assert.ok(!(err instanceof SpecError));
    assert.ok(err.message.includes(file), err.message);
    return true;
  });
});
test('loadFilm names the path of a file that is not JSON', () => {
  const file = writeFilm('notjson.json', '{ nope');
  assert.throws(() => loadFilm(file, { registries }), (err) => {
    assert.ok(err.message.includes(file), err.message);
    assert.match(err.message, /JSON/);
    return true;
  });
});
// --- review round 1: crashes, bounded work, filesystem errors, echoes ---

test('an anchor with a line terminator is an error, never a crash', () => {
  for (const at of ['word:a\nb', 'start\u2028+1', 'end\r\n', 'sentence:0\u2029']) {
    const r = check(film({}, [{ ...shotA, on: [{ at, do: 'highlight' }] }]));
    assert.equal(r.ok, false, JSON.stringify(at));
    assert.equal(r.errors[0].path, 'shots[0].on[0].at');
  }
});

test('a 100,000 character say validates fast and reports only its length', () => {
  const started = performance.now();
  const r = check(film({}, [{ ...shotA, say: 'word '.repeat(20000), on: [{ at: 'word:5', do: 'highlight' }] }]));
  assert.ok(performance.now() - started < 1000, 'took too long');
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].path, 'shots[0].say');
  assert.match(r.errors[0].message, /400/);
});

test('shots after the sixtieth are not checked, only counted', () => {
  const shots = Array.from({ length: 70 }, (_, i) => ({ id: `s${i}`, show: i === 65 ? 'statment' : 'statement', hold: 1 }));
  const r = check(film({}, shots));
  assert.deepEqual(r.errors.map((e) => e.path), ['shots']);
});

test('a huge shots array is cheap to refuse', () => {
  const started = performance.now();
  const r = check(film({}, Array.from({ length: 200000 }, () => 1)));
  assert.ok(performance.now() - started < 1000, 'took too long');
  assert.ok(r.errors.length <= 61, `${r.errors.length} errors`);
  assert.equal(r.errors[0].path, 'shots');
});

test('a non-object shot among the first sixty is an error at its path', () => {
  const r = check(film({}, [shotA, 5]));
  assert.deepEqual(r.errors, [{ path: 'shots[1]', message: 'must be object' }]);
});

test('on entries after the eighth are not checked, only counted', () => {
  const on = Array.from({ length: 10 }, (_, i) => ({ at: 'start', do: i === 9 ? 'hilight' : 'highlight' }));
  const r = check(film({}, [{ ...shotA, on }]));
  assert.deepEqual(r.errors.map((e) => e.path), ['shots[0].on']);
});

test('loadFilm refuses a file over 1 MB and names the path and the limit', () => {
  const file = writeFilm('big.json', `{"version":2,"shots":[],"pad":"${' '.repeat(1024 * 1024)}"}`);
  assert.throws(() => loadFilm(file, { registries }), (err) => {
    assert.ok(!(err instanceof SpecError));
    assert.ok(err.message.includes(file), err.message);
    assert.match(err.message, /1 MB/);
    return true;
  });
});

test('a src file that cannot be read reports its code, not "not found"', () => {
  symlinkSync('loop.png', path.join(specDir, 'assets', 'loop.png'));
  const loop = check(film({}, [{ id: 'p', show: 'picture', src: 'assets/loop.png', hold: 2 }]));
  assert.match(loop.errors[0].message, /ELOOP/);
  assert.doesNotMatch(loop.errors[0].message, /not found/);
  const long = check(film({}, [{ id: 'p', show: 'picture', src: `assets/${'a'.repeat(300)}.png`, hold: 2 }]));
  assert.match(long.errors[0].message, /ENAMETOOLONG/);
  const nul = check(film({}, [{ id: 'p', show: 'picture', src: 'assets/a\0b.png', hold: 2 }]));
  assert.equal(nul.errors.length, 1);
  assert.match(nul.errors[0].message, /ERR_INVALID_ARG_VALUE/);
});

test('a src in a folder that cannot be searched reports EACCES', { skip: process.getuid?.() === 0 }, () => {
  const locked = path.join(specDir, 'locked');
  mkdirSync(locked);
  writeFileSync(path.join(locked, 'a.png'), 'x');
  chmodSync(locked, 0o000);
  try {
    const r = check(film({}, [{ id: 'p', show: 'picture', src: 'locked/a.png', hold: 2 }]));
    assert.match(r.errors[0].message, /EACCES/);
  } finally {
    chmodSync(locked, 0o700);
  }
});

test('a src file that disappears between two checks does not throw', () => {
  const file = path.join(specDir, 'assets', 'fleeting.png');
  writeFileSync(file, 'x');
  const shots = [{ id: 'p', show: 'picture', src: 'assets/fleeting.png', hold: 2 }];
  assert.equal(check(film({}, shots)).ok, true);
  rmSync(file);
  const r = check(film({}, shots));
  assert.match(r.errors[0].message, /not found/);
});

test('a missing spec folder is an error at each src, and fine without one', () => {
  const gone = path.join(specDir, 'no-such-folder');
  const withSrc = validateFilm(film({}, [{ id: 'p', show: 'picture', src: 'assets/photo.png', hold: 2 }]), { specDir: gone, registries });
  assert.equal(withSrc.errors[0].path, 'shots[0].src');
  assert.match(withSrc.errors[0].message, /spec folder/);
  assert.match(withSrc.errors[0].message, /ENOENT|not found/);
  assert.equal(validateFilm(film(), { specDir: gone, registries }).ok, true);
});

test('validateFilm needs a specDir string', () => {
  assert.throws(() => validateFilm(film(), { registries }), TypeError);
  assert.throws(() => validateFilm(film()), TypeError);
});

test('an unreadable spec folder is an error at the src, not a crash', { skip: process.getuid?.() === 0 }, () => {
  const sealed = mkdtempSync(path.join(tmpdir(), 'mm-v2-sealed-'));
  chmodSync(sealed, 0o000);
  try {
    const r = validateFilm(film({}, [{ id: 'p', show: 'picture', src: 'assets/photo.png', hold: 2 }]), { specDir: sealed, registries });
    assert.equal(r.errors[0].path, 'shots[0].src');
    assert.match(r.errors[0].message, /EACCES/);
  } finally {
    chmodSync(sealed, 0o700);
    rmSync(sealed, { recursive: true, force: true });
  }
});

test('version 3 alone is one error at version', () => {
  const r = check({ version: 3, shots: [shotA] });
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].path, 'version');
  assert.match(r.errors[0].message, /must be 2/);
});

test('a bad target is reported even when the shot has another schema error', () => {
  const r = check(film({}, [{ ...shotA, text: 5, on: [{ at: 'start', do: 'highlight', target: 'label' }] }]));
  assert.deepEqual(r.errors.map((e) => e.path).sort(), ['shots[0].on[0].target', 'shots[0].text']);
});

test('targets that cannot be computed for a broken shot are skipped, not thrown', () => {
  const regs = stubRegistries();
  regs.kinds.add('fragile', {
    schema: { properties: { items: { type: 'array' } } },
    targets: (shot) => shot.items.map(String),
  });
  const r = validateFilm(film({}, [{ id: 'f', show: 'fragile', items: 'oops', hold: 2, on: [{ at: 'start', do: 'highlight', target: 'x' }] }]), { specDir, registries: regs });
  assert.deepEqual(r.errors.map((e) => e.path), ['shots[0].items']);
});

test('a kind with no targets function accepts no target', () => {
  const bad = check(film({}, [{ id: 'p', show: 'plain', hold: 2, on: [{ at: 'start', do: 'highlight', target: 'x' }] }]));
  assert.equal(bad.errors.length, 1);
  assert.equal(bad.errors[0].path, 'shots[0].on[0].target');
  assert.match(bad.errors[0].message, /this kind has no targets/);
  assert.equal(check(film({}, [{ id: 'p', show: 'plain', hold: 2, on: [{ at: 'start', do: 'highlight' }] }])).ok, true);
});

test('a file name with a colon is not mistaken for a URL', () => {
  assert.equal(check(film({}, [{ id: 'p', show: 'picture', src: 'clip:1.png', hold: 2 }])).ok, true);
});

test('real URLs are refused', () => {
  for (const src of ['https://example.com/a.png', 'data:image/png;base64,AAAA', 'blob:abc', 'file:///etc/passwd', 'javascript:alert(1)']) {
    const r = check(film({}, [{ id: 'p', show: 'picture', src, hold: 2 }]));
    assert.match(r.errors[0].message, /URL/, src);
  }
});

test('drive and UNC paths are absolute', () => {
  for (const src of ['C:\\x.png', 'C:/x.png', '\\\\host\\share\\x.png', '//host/share/x.png']) {
    const r = check(film({}, [{ id: 'p', show: 'picture', src, hold: 2 }]));
    assert.match(r.errors[0].message, /absolute/, src);
  }
});

test('a relative src with a backslash is told to use forward slashes', () => {
  const r = check(film({}, [{ id: 'p', show: 'picture', src: 'assets\\photo.png', hold: 2 }]));
  assert.match(r.errors[0].message, /forward slashes/);
});

test('values echoed in error messages are cut to 80 characters', () => {
  const long = 'x'.repeat(1000);
  const echoes = [
    check(film({}, [{ ...shotA, id: long.toUpperCase() }])).errors[0].message,
    check(film({}, [{ id: 'a'.repeat(1000), show: 'statement', say: 'Hi.' }, { id: 'a'.repeat(1000), show: 'statement', say: 'Hi.' }])).errors.at(-1).message,
    check(film({}, [shotA, { id: 'b', show: 'statement', say: 'Hi.', cut: long }])).errors[0].message,
    check(film({}, [{ ...shotA, on: [{ at: 'start', do: 'highlight', target: long }] }])).errors[0].message,
    check(film({}, [{ ...shotA, on: [{ at: long, do: 'highlight' }] }])).errors[0].message,
    check(film({}, [{ ...shotA, on: [{ at: 'start', do: long }] }])).errors[0].message,
    check(film({ look: long })).errors[0].message,
    check(film({}, [{ id: 'a', show: long }])).errors[0].message,
    check(film({ accent: long })).errors[0].message,
    check({ version: long, shots: [shotA] }).errors[0].message,
    check(film({}, [{ id: 'p', show: 'picture', src: long, hold: 2 }])).errors[0].message,
  ];
  echoes.forEach((message, i) => {
    assert.ok(message.length < 400, `echo ${i} is ${message.length} characters: ${message.slice(0, 120)}`);
    assert.ok(!/(.)\1{100}/.test(message), `echo ${i} holds a long run of the value`);
  });
});

// --- review round 2 ---

test('50,000 shots are refused with a handful of errors, fast', () => {
  const shots = Array.from({ length: 50000 }, () => ({ id: 'dup', show: 'statement', hold: 1 }));
  const started = performance.now();
  const r = check(film({}, shots));
  assert.ok(performance.now() - started < 1000, 'took too long');
  assert.equal(r.errors[0].path, 'shots');
  assert.ok(r.errors.length <= 62, `${r.errors.length} errors`);
});

test('an on array of 50,000 numbers is refused with a handful of errors, fast, and not changed', () => {
  const on = Array.from({ length: 50000 }, () => 1);
  const input = film({}, [{ ...shotA, on }]);
  const started = performance.now();
  const r = check(input);
  assert.ok(performance.now() - started < 1000, 'took too long');
  assert.ok(r.errors.some((e) => e.path === 'shots[0].on' && /8/.test(e.message)));
  assert.ok(r.errors.length <= 10, `${r.errors.length} errors`);
  assert.equal(input.shots[0].on.length, 50000);
});

test('the cut messages read as whole sentences', () => {
  const two = (cut) => check(film({}, [shotA, { id: 'b', show: 'statement', say: 'Yo.', cut }])).errors[0].message;
  assert.equal(two('fade'), 'look "desk" has no cut "fade"; its cuts are: cut, match');
  assert.equal(two('matc'), 'look "desk" has no cut "matc"; did you mean "match"? Its cuts are: cut, match');
});

test('the target messages read as whole sentences', () => {
  const message = (show, extra, target) => check(film({}, [{ id: 'p', show, hold: 2, ...extra, on: [{ at: 'start', do: 'highlight', target }] }])).errors[0].message;
  assert.equal(message('statement', {}, 'label'), 'unknown target "label"; the targets of statement are: text');
  assert.equal(message('picture', { src: 'assets/photo.png' }, 'captin'), 'unknown target "captin"; did you mean "caption"? The targets of picture are: image, caption');
});

test('a value that is not a string is shown as JSON, a string in quotes', () => {
  const got = (version) => check({ version, shots: [shotA] }).errors[0].message;
  assert.equal(got(3), 'must be 2, the only version make-motion 2 reads; got 3');
  assert.equal(got('3'), 'must be 2, the only version make-motion 2 reads; got "3"');
  assert.equal(got({ a: 1 }), 'must be 2, the only version make-motion 2 reads; got {"a":1}');
  assert.equal(got(null), 'must be 2, the only version make-motion 2 reads; got null');
});

test('a cut inside a surrogate pair never happens in a message', () => {
  const emoji = '\u{1F600}'.repeat(100);
  const messages = [
    check(film({}, [{ ...shotA, id: emoji }])).errors[0].message,
    check(film({ look: emoji })).errors[0].message,
    check({ version: emoji, shots: [shotA] }).errors[0].message,
    check(film({}, [{ ...shotA, on: [{ at: emoji, do: 'highlight' }] }])).errors[0].message,
  ];
  for (const message of messages) {
    assert.doesNotMatch(message, /\\ud[89a-f][0-9a-f]{2}/i, message.slice(0, 100));
    assert.ok(message.length < 400);
  }
});

test('loadFilm refuses what is not a regular file', () => {
  assert.throws(() => loadFilm(specDir, { registries }), (err) => {
    assert.ok(!(err instanceof SpecError));
    assert.ok(err.message.includes(specDir), err.message);
    assert.match(err.message, /not a regular file/);
    return true;
  });
  const fifo = path.join(specDir, 'pipe.json');
  execFileSync('mkfifo', [fifo]);
  assert.throws(() => loadFilm(fifo, { registries }), /not a regular file/);
});

test('a kind whose targets returns a non-array is a programmer error that names the kind', () => {
  const regs = stubRegistries();
  regs.kinds.add('broken', { schema: { properties: {} }, targets: () => 'text' });
  const shots = [{ id: 'b', show: 'broken', hold: 2, on: [{ at: 'start', do: 'highlight' }] }];
  assert.throws(() => validateFilm(film({}, shots), { specDir, registries: regs }), /kind "broken".*targets.*array/);
  const invalid = [{ id: 'b', show: 'broken', hold: 2, nope: 1 }];
  assert.doesNotThrow(() => validateFilm(film({}, invalid), { specDir, registries: regs }));
});

test('a colon after a single leading letter is refused as a Windows drive', () => {
  for (const src of ['C:x.png', 'C:\\x.png', 'C:/x.png', 'a:b.png']) {
    const r = check(film({}, [{ id: 'p', show: 'picture', src, hold: 2 }]));
    assert.match(r.errors[0].message, /Windows drive/, src);
    assert.match(r.errors[0].message, /absolute/, src);
  }
});

test('loadFilm reports a version 1 file as a SpecError with the one error', () => {
  const file = writeFilm('v1.json', { scenes: [] });
  assert.throws(() => loadFilm(file, { registries }), (err) => {
    assert.ok(err instanceof SpecError);
    assert.equal(err.errors.length, 1);
    return true;
  });
});

// --- voice: a user's pronunciation hint may only use phoneme characters the voice has ---

const U02DE = String.fromCharCode(0x02de); // rhotic hook: not in the voice's vocab
const hint = (word, ipa) => `[${word}](/${ipa}/)`;
const sayShot = (say) => film({}, [shotA, { id: 'b', show: 'statement', say }]);
const hintErrors = (ipa) => check(sayShot(`Say ${hint('word', ipa)} now.`)).errors;

test('a pronunciation hint with a character outside the voice vocab is an error at shots[i].say naming the characters', () => {
  const r = check(sayShot(`Say ${hint('car', `k\u0251${U02DE}`)} now.`));
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].path, 'shots[1].say');
  assert.ok(r.errors[0].message.includes(`"${U02DE}"`), r.errors[0].message);
  assert.match(r.errors[0].message, /U\+02DE/);
  assert.ok(r.errors[0].message.includes('on "car"'), 'names the word the hint is on');
});

test('a hint refuses a space, the pad, punctuation and characters the voice rewrites, and says which and why', () => {
  const cases = [
    ['b c', 'U+0020', /space/],
    ['b$c', 'U+0024', /pad/],
    ['b:c', 'U+003A', /punctuation/],
    ['bc.', 'U+002E', /punctuation/],
    ['b,c', 'U+002C', /punctuation/],
    ['b\u2014c', 'U+2014', /punctuation/],
    ['bra', 'U+0072', /rewrites it to "\u0279"/],
    ['lox', 'U+0078', /rewrites it to "k"/],
    ['b\u02b2a', 'U+02B2', /rewrites it to "j"/],
  ];
  for (const [ipa, point, why] of cases) {
    const errors = hintErrors(ipa);
    assert.equal(errors.length, 1, ipa);
    assert.equal(errors[0].path, 'shots[1].say');
    assert.ok(errors[0].message.includes(point), `${ipa}: ${errors[0].message}`);
    assert.match(errors[0].message, why, ipa);
  }
});

test('a hint is checked after NFC normalisation: a letter that composes into a character the voice lacks is refused, one that does not compose is fine', () => {
  const composed = hintErrors('e\u0303');
  assert.equal(composed.length, 1);
  assert.match(composed[0].message, /U\+1EBD/, 'names the normalised character');
  assert.deepEqual(hintErrors('\u0251\u0303'), [], 'a + combining tilde has no precomposed form');
});

test('every bad hint of a shot is named in one error; a good one is not', () => {
  const say = `${hint('a', `x${U02DE}${U02DE}`)} ${hint('b', 'ok')} ${hint('c', '\u00e9')}`;
  const r = check(film({}, [{ id: 'a', show: 'statement', say }]));
  assert.equal(r.errors.length, 1);
  assert.equal((r.errors[0].message.match(/U\+02DE/g) ?? []).length, 1, 'a repeat inside one hint is named once');
  assert.match(r.errors[0].message, /U\+00E9/);
  assert.match(r.errors[0].message, /on "a"/);
  assert.ok(!r.errors[0].message.includes('on "b"'), 'a good hint is not named');
});

test('a hint made only of voice phoneme characters, stress and length marks, and narration with no hint, validate', () => {
  assert.deepEqual(hintErrors('t\u0259m\u02c8e\u026ato\u028a'), []);
  assert.deepEqual(hintErrors('k\u02c8\u0251\u02d0'), []);
  assert.deepEqual(check(film()), { ok: true, errors: [] });
});

test('the validator and the synthesiser agree on a hint: an error exactly when hintRefusals names a character', () => {
  for (const ipa of ['k\u02c8\u0251\u02d0', 'b c', 'b$c', 'bra', 'lox', 'e\u0303', '\u0251\u0303', 'c\u0327', `a${U02DE}`, 'b.', 'ok']) {
    assert.equal(hintErrors(ipa).length > 0, hintRefusals(ipa).length > 0, ipa);
  }
});

// --- voice data on the film's mode: checked here too, for a mode that reached a registry without the shared wrapper ---

test('a film whose mode lacks voice data, or has it out of range, is an error at mode that says what to add', () => {
  const regsWith = (extra, drop = []) => {
    const mode = { ...STUB_MODES[0], ...extra };
    for (const key of drop) delete mode[key];
    return stubRegistries({ modes: [mode] });
  };
  const missing = check(film({ mode: 'pro' }), regsWith({}, ['voiceSpeed', 'emphasisPause']));
  assert.equal(missing.ok, false);
  assert.equal(missing.errors.length, 1);
  assert.equal(missing.errors[0].path, 'mode');
  assert.match(missing.errors[0].message, /voiceSpeed/);
  assert.match(missing.errors[0].message, /the mode's data is incomplete or out of range/);
  assert.match(check(film({ mode: 'pro' }), regsWith({}, ['emphasisPause'])).errors[0].message, /emphasisPause must be/);
  assert.match(check(film({ mode: 'pro' }), regsWith({ voiceSpeed: 1.3 })).errors[0].message, /voiceSpeed must be a number from 0.8 to 1.25, got 1.3/);
  assert.equal(check(film({ mode: 'pro' }), regsWith({ voiceSpeed: 1.25, emphasisPause: 3 })).ok, true);
  assert.equal(check(film({ mode: 'pro' })).ok, true, 'the stub modes carry voice data');
});

// --- the film's voice ---

test('voice accepts the synthesised shape and the own-recording shape', () => {
  assert.deepEqual(check(film({ voice: { name: 'af_heart' } })), { ok: true, errors: [] });
  writeFileSync(path.join(specDir, 'vo.wav'), 'RIFF');
  writeFileSync(path.join(specDir, 'vo.json'), JSON.stringify({ segments: [{ words: [{ word: ' Hi.', start: 0.2, end: 0.5 }] }] }));
  assert.deepEqual(check(film({ voice: { src: 'vo.wav', words: 'vo.json' } })), { ok: true, errors: [] });
});
test('a misspelled voice key gets a did-you-mean at its path', () => {
  const r = check(film({ voice: { nam: 'af_heart' } }));
  assert.deepEqual(r.errors, [{ path: 'voice.nam', message: 'unknown property; did you mean "name"?' }]);
});
test('a voice name other than af_heart is an error listing the accepted one, with a did-you-mean', () => {
  const r = check(film({ voice: { name: 'af_hart' } }));
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].path, 'voice.name');
  assert.match(r.errors[0].message, /^voice "af_hart" is not available; did you mean "af_heart"\? The accepted voice is: af_heart$/);
  assert.match(check(film({ voice: { name: 'zz' } })).errors[0].message, /not available; the accepted voice is: af_heart/);
});
test('a voice that is not one of the two shapes says what to write', () => {
  const shapes = /\{ "name": "af_heart" \}.*\{ "src": "vo\.wav", "words": "vo\.json" \}/;
  for (const voice of [{}, { name: 'af_heart', src: 'vo.wav' }, { src: 'vo.wav' }, { words: 'vo.json' }]) {
    const r = check(film({ voice }));
    assert.equal(r.errors.length, 1, JSON.stringify(voice));
    assert.equal(r.errors[0].path, 'voice');
    assert.match(r.errors[0].message, shapes);
  }
  assert.deepEqual(check(film({ voice: 'af_heart' })).errors.map((e) => e.path), ['voice']);
  assert.match(check(film({ voice: 'af_heart' })).errors[0].message, /must be object/);
  assert.deepEqual(check(film({ voice: { name: 3 } })).errors, [{ path: 'voice.name', message: 'must be string' }]);
});

test('a voiced film with hold and say on one shot still gets the hold error', () => {
  const r = check(film({ voice: { name: 'af_heart' } }, [{ ...shotA, hold: 2 }]));
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].path, 'shots[0].hold');
  assert.match(r.errors[0].message, /^hold cannot be used with say/);
});

// An anchor at 1.6 s in shot "a", whose estimated length is under 1.2 s: outside on estimated times.
const pastEnd = (extra) => film(extra, [{ ...shotA, say: 'One file.', on: [{ at: 1.6, do: 'highlight' }] }]);

test('a voiced film is not checked for anchors outside their shot on estimated times; a silent film is', () => {
  assert.match(check(pastEnd({})).errors[0].message, /outside the shot/);
  assert.deepEqual(check(pastEnd({ voice: { name: 'af_heart' } })), { ok: true, errors: [] });
});
test('a voiced film still gets the anchor errors that do not depend on time', () => {
  const r = check(film({ voice: { name: 'af_heart' } }, [{ ...shotA, say: 'One file.', on: [{ at: 'word:server', do: 'highlight' }] }]));
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].path, 'shots[0].on[0].at');
  assert.match(r.errors[0].message, /no word "server"/);
});
test('anchorSpanErrors checks every anchor against the timeline it is given, in the validator path form', () => {
  const spec = pastEnd({ voice: { name: 'af_heart' } });
  const timeline = buildTimeline(spec, { fps: 30, modes: registries.modes });
  const errors = anchorSpanErrors(spec, timeline);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].path, 'shots[0].on[0].at');
  assert.match(errors[0].message, /^1\.6 resolves to 1\.6 s, outside the shot, which runs from 0 to [\d.]+ s/);
  const longer = { ...timeline, shots: timeline.shots.map((s) => ({ ...s, duration: s.duration + 1 })) };
  assert.deepEqual(anchorSpanErrors(spec, longer), [], 'inside a longer measured shot');
});

// ---- sound: "sound", "cues", "music", and "captions" (validated only here) ----

const errorsAt = (spec) => check(spec).errors.map((e) => [e.path, e.message]);

test('sound is "on" or "off", captions true or false; a misspelled field gets a did-you-mean', () => {
  for (const extra of [{ sound: 'on' }, { sound: 'off' }, { captions: true }, { captions: false }]) assert.equal(check(film(extra)).ok, true, JSON.stringify(extra));
  assert.deepEqual(errorsAt(film({ sound: 'loud' })), [['sound', 'must be one of "on", "off"']]);
  assert.match(errorsAt(film({ captions: 'yes' }))[0].join(': '), /^captions: must be boolean/);
  const misspelled = errorsAt(film({ sond: 'on' }));
  assert.equal(misspelled[0][0], 'sond');
  assert.match(misspelled[0][1], /did you mean "sound"/);
});

test('cues is a list of { at, cue }: at a number or an anchor, cue a name the synth knows', () => {
  assert.equal(check(film({ cues: [{ at: 1.5, cue: 'pop' }, { at: 'word:hi+0.1', cue: 'click' }] })).ok, true);
  assert.equal(check(film({ cues: [] })).ok, true);
  const unknown = errorsAt(film({ cues: [{ at: 1, cue: 'poop' }] }));
  assert.equal(unknown[0][0], 'cues[0].cue');
  assert.match(unknown[0][1], /^must be one of "pop", "click", .*"marker", "erase"; did you mean "pop"\?/);
  assert.deepEqual(errorsAt(film({ cues: [{ cue: 'pop' }] })).map(([p]) => p), ['cues[0].at']);
  assert.match(errorsAt(film({ cues: [{ at: 1, cue: 'pop', cuee: 'x' }] }))[0].join(': '), /^cues\[0\]\.cuee: unknown property/);
  assert.match(errorsAt(film({ cues: [{ at: { s: 1 }, cue: 'pop' }] }))[0].join(': '), /^cues\[0\]\.at: must be number,string/);
  assert.match(errorsAt(film({ cues: 'pop' }))[0].join(': '), /^cues: must be array/);
  assert.match(errorsAt(film({ cues: Array.from({ length: 65 }, () => ({ at: 1, cue: 'pop' })) }))[0].join(': '), /^cues: must NOT have more than 64 items/);
});

test('music is { bed, bpm? } or { src }: a bed the synth plays, a tempo from 60 to 180, a file inside the film folder', () => {
  writeFileSync(path.join(specDir, 'track.mp3'), 'not really audio: the sound stage probes it');
  for (const music of [{ bed: 'pulse' }, { bed: 'drift', bpm: 60 }, { bed: 'tape', bpm: 180 }, { src: 'track.mp3' }]) {
    assert.equal(check(film({ music })).ok, true, JSON.stringify(music));
  }
  assert.match(errorsAt(film({ music: { bed: 'disco' } }))[0].join(': '), /^music\.bed: must be one of "pulse", "drift", "tape"/);
  for (const bpm of [59, 181, '120']) assert.equal(errorsAt(film({ music: { bed: 'pulse', bpm } }))[0][0], 'music.bpm', String(bpm));
  assert.match(errorsAt(film({ music: { bed: 'pulse', src: 'track.mp3' } }))[0].join(': '), /^music: has a bed and a src; use \{ "bed": "pulse" \}/);
  assert.match(errorsAt(film({ music: { src: 'track.mp3', bpm: 120 } }))[0].join(': '), /^music: bpm sets the tempo of a bed; a file of your own keeps its own tempo/);
  assert.match(errorsAt(film({ music: {} }))[0].join(': '), /^music: is empty; use/);
  assert.match(errorsAt(film({ music: { bedd: 'pulse' } }))[0].join(': '), /^music\.bedd: unknown property; did you mean "bed"\?/);
  assert.match(errorsAt(film({ music: { src: 'missing.mp3' } }))[0].join(': '), /^music\.src: .*missing\.mp3/);
  assert.match(errorsAt(film({ music: { src: '../outside.mp3' } }))[0].join(': '), /^music\.src: /);
});

test('the beds the validator names are the beds sound/bed.mjs plays', async () => {
  const { MUSIC_BEDS } = await import('../../scripts/v2/spec.mjs');
  const { BEDS } = await import('../../scripts/v2/sound/bed.mjs');
  assert.deepEqual([...MUSIC_BEDS], [...BEDS]);
});

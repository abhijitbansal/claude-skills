// Modes are data in their registry (design section 7): the timeline's pace, the validator's choice of mode and --list
// all read the registered mode, so a third mode needs no code. A test mode is registered here, in this file's own
// process, and a stub registry is passed where the code takes one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { registries, createRegistry } from '../../engine/registry.mjs';
import { validateMode } from '../../engine/modes/index.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { validateFilm, withFilmDefaults } from '../../scripts/v2/spec.mjs';
import { loadFilm } from '../../scripts/v2/pipeline.mjs';
import { listEntries } from '../../scripts/v2/list.mjs';
import '../../engine/looks/index.mjs';
import { auditFrame } from '../../engine/review/frame.mjs';
import { compositionRect } from '../../engine/kinds/shared.mjs';
import { safeInsets, VIRAL_SAFE_ZONE } from '../../template/formats.mjs';

const SLOW = Object.freeze({ name: 'test-slow', summary: 'A test mode.', defaultLook: 'desk', defaultFormat: '1:1', wpm: 60, tail: 2, maxStillSeconds: 6, hookFromFrameZero: false, voiceSpeed: 1.0, emphasisPause: 0, loudness: { lufs: -16, truePeakDb: -1.5, lra: 11 } });
const SAY = 'One two three four five six.';
const FPS = 30;

// A registry holding only `modes` (each frozen, as the modes index registers them).
function modesOf(...modes) {
  const r = createRegistry('mode');
  modes.forEach((m) => r.add(m.name, Object.freeze(m)));
  return r;
}

test('the timeline takes its pace from the mode registry: wpm and tail of the registered mode', () => {
  const film = { mode: 'test-slow', shots: [{ id: 'a', say: SAY }] };
  const slow = buildTimeline(film, { fps: FPS, modes: modesOf(SLOW) }).shots[0];
  const fast = buildTimeline(film, { fps: FPS, modes: modesOf({ ...SLOW, wpm: 240, tail: 0.2 }) }).shots[0];
  assert.ok(slow.words.at(-1).end > fast.words.at(-1).end * 3.9, 'four times slower speech');
  assert.ok(slow.duration >= slow.words.at(-1).end + SLOW.tail - 1e-9, 'the tail is the mode tail');
  assert.ok(slow.duration < slow.words.at(-1).end + SLOW.tail + 1 / FPS);
});

test('a changed wpm in a registered mode changes the timeline (no second table of paces)', () => {
  const film = { mode: 'pro', shots: [{ id: 'a', say: SAY }] };
  const pro = registries.modes.get('pro');
  const asRegistered = buildTimeline(film, { fps: FPS }).shots[0];
  const slower = buildTimeline(film, { fps: FPS, modes: modesOf({ ...pro, wpm: pro.wpm / 2 }) }).shots[0];
  assert.ok(Math.abs(slower.words.at(-1).end - 2 * asRegistered.words.at(-1).end) < 0.3, 'half the wpm, about twice the speech');
});

test('a mode registered in the shared registry is a mode the timeline knows', () => {
  if (!registries.modes.has(SLOW.name)) registries.modes.add(SLOW.name, SLOW);
  const tl = buildTimeline({ mode: SLOW.name, shots: [{ id: 'a', say: SAY }] }, { fps: FPS });
  assert.ok(tl.duration >= tl.shots[0].words.at(-1).end + SLOW.tail - 1e-9);
});

test('a mode without a usable pace is an error that names the mode', () => {
  assert.throws(() => buildTimeline({ mode: 'test-slow', shots: [{ id: 'a', say: SAY }] }, { fps: FPS, modes: modesOf({ ...SLOW, tail: -1 }) }), /mode "test-slow": tail must be/);
  assert.throws(() => buildTimeline({ mode: 'test-slow', shots: [{ id: 'a', say: SAY }] }, { fps: FPS, modes: modesOf({ ...SLOW, wpm: undefined }) }), /mode "test-slow": wpm must be/);
});

// A stub set of registries: the real modes plus the test mode, one look serving each.
function stubRegistries() {
  const r = { kinds: createRegistry('kind'), looks: createRegistry('look'), devices: createRegistry('device'), modes: modesOf(registries.modes.get('pro'), registries.modes.get('viral'), SLOW) };
  r.kinds.add('statement', { schema: { properties: { text: { type: 'string' } } } });
  r.looks.add('desk', { name: 'desk', modes: ['pro', 'test-slow'], cuts: ['cut'] });
  r.looks.add('pop', { name: 'pop', modes: ['viral'], cuts: ['cut'] });
  return r;
}

test('the validator accepts a third registered mode, fills its defaults, and still names the choices for a typo', () => {
  const specDir = mkdtempSync(path.join(tmpdir(), 'mm-v2-modes-'));
  try {
    const regs = stubRegistries();
    const film = { version: 2, mode: 'test-slow', shots: [{ id: 'a', show: 'statement', say: SAY }] };
    assert.deepEqual(validateFilm(film, { specDir, registries: regs }), { ok: true, errors: [] });
    const filled = withFilmDefaults(film, regs);
    assert.deepEqual([filled.look, filled.format], ['desk', '1:1']);
    const typo = validateFilm({ ...film, mode: 'test-slw' }, { specDir, registries: regs });
    assert.equal(typo.errors[0].path, 'mode');
    assert.match(typo.errors[0].message, /did you mean "test-slow"/);
    writeFileSync(path.join(specDir, 'film.json'), JSON.stringify(film));
    const loaded = loadFilm(path.join(specDir, 'film.json'), { registries: regs });
    assert.ok(loaded.timeline.duration >= loaded.timeline.shots[0].words.at(-1).end + SLOW.tail - 1e-9, 'loadFilm times the film with the registry it validated with');
  } finally {
    rmSync(specDir, { recursive: true, force: true });
  }
});

// ---- the review's word rules and the composition rectangle read mode data, never a mode's name ----

const register = (mode) => { if (!registries.modes.has(mode.name)) registries.modes.add(mode.name, Object.freeze(mode)); };
const CANVAS = { w: 1920, h: 1080 };
// A one-line text of `words` words as the page's snapshot reports it.
function lineOf(words) {
  const size = 96, width = words * 192;
  const line = { x: 0, y: 86, width, words: Array.from({ length: words }, (_, k) => ({ text: 'word', index: k, x: k * 192, width: 192 })) };
  return { type: 'text', id: 't', depth: 0, props: { role: 'hero' }, x: 200, y: 300, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, visible: true, children: [],
    layout: { size, width, height: 110, overflow: false, lines: [line] }, bbox: [200, 300, Math.min(width, 1400), 110], spread: 0 };
}
const rules = (mode, words, extra = {}) => {
  const look = registries.looks.get('desk');
  return auditFrame([lineOf(words)], { look, canvas: CANVAS, safe: { left: 0, top: 0, right: 99999, bottom: 99999 }, mode, shotId: 'a', shotIndex: 0, t: 1, ...extra }).map((f) => f.rule);
};

test('the line-words rule takes its limit from the mode (maxLineWords): a third mode with 3 fires on 4 words; a mode without it never fires', () => {
  register({ ...SLOW, name: 'test-terse', maxLineWords: 3 });
  assert.ok(rules('test-terse', 4).includes('line-words'));
  assert.ok(!rules('test-terse', 3).includes('line-words'));
  register({ ...SLOW, name: 'test-no-limits' });
  assert.ok(!rules('test-no-limits', 13).includes('line-words'), 'no maxLineWords: no line rule');
  assert.ok(rules('pro', 13).includes('line-words'), 'pro keeps its 12');
  assert.ok(!rules('viral', 13).includes('line-words'), 'viral has no line limit');
});

test('the hook-words rule takes its limit from the mode (maxHookWords), on the film first shot only', () => {
  register({ ...SLOW, name: 'test-short-hook', maxHookWords: 2 });
  assert.ok(rules('test-short-hook', 3, { isFirstShot: true }).includes('hook-words'));
  assert.ok(!rules('test-short-hook', 3, { isFirstShot: false }).includes('hook-words'));
  assert.ok(!rules('test-no-limits', 9, { isFirstShot: true }).includes('hook-words'), 'no maxHookWords: no hook rule');
  assert.ok(rules('viral', 8, { isFirstShot: true }).includes('hook-words'), 'viral keeps its 7');
});

test('a look composes inside the platform safe zone on 9:16 when it serves a mode whose data asks for it (platformSafeZone)', () => {
  register({ ...SLOW, name: 'test-platform', platformSafeZone: true });
  const desk = registries.looks.get('desk');
  if (!registries.looks.has('desk-platform-test')) registries.looks.add('desk-platform-test', Object.freeze({ ...desk, name: 'desk-platform-test', modes: ['test-platform'] }));
  const canvas = { w: 1080, h: 1920 };
  const viralInsets = safeInsets([1080, 1920], VIRAL_SAFE_ZONE);
  assert.equal(compositionRect({ canvas, look: registries.looks.get('desk-platform-test'), viralInsets }).safe, true);
  assert.equal(compositionRect({ canvas, look: desk, viralInsets }).safe, false, 'desk serves pro, which does not');
  assert.equal(compositionRect({ canvas, look: registries.looks.get('pop'), viralInsets }).safe, true, 'pop serves viral, which does');
});

test('--list modes says each mode pace from its own wpm', () => {
  for (const name of ['pro', 'viral']) {
    const { summary } = listEntries('modes').find((e) => e.name === name);
    assert.match(summary, new RegExp(`${registries.modes.get(name).wpm} words a minute`));
  }
});

// ---- voice data: voiceSpeed and emphasisPause are mode data, read by the voice code, never by a mode's name ----

test('pro and viral carry voice data: voiceSpeed 1.0 and 1.1, emphasisPause 0', () => {
  assert.deepEqual([registries.modes.get('pro').voiceSpeed, registries.modes.get('pro').emphasisPause], [1.0, 0]);
  assert.deepEqual([registries.modes.get('viral').voiceSpeed, registries.modes.get('viral').emphasisPause], [1.1, 0]);
});

test('a mode whose voice data is missing or outside its range fails validateMode, naming the mode and the field', () => {
  const ok = { ...SLOW, voiceSpeed: 1.0, emphasisPause: 0 };
  assert.doesNotThrow(() => validateMode(ok));
  assert.doesNotThrow(() => validateMode({ ...ok, voiceSpeed: 0.8 }));
  assert.doesNotThrow(() => validateMode({ ...ok, voiceSpeed: 1.25 }));
  for (const voiceSpeed of [undefined, 0.79, 1.26, 0, -1, NaN, '1', Infinity]) {
    assert.throws(() => validateMode({ ...ok, voiceSpeed }), /mode "test-slow": voiceSpeed must be/, String(voiceSpeed));
  }
  for (const emphasisPause of [undefined, -0.1, NaN, '0', 3.5]) {
    assert.throws(() => validateMode({ ...ok, emphasisPause }), /mode "test-slow": emphasisPause must be/, String(emphasisPause));
  }
});

test('a mode added to the shared registry is checked as it is added: without voice data it cannot register', () => {
  const { voiceSpeed: _speed, emphasisPause: _pause, ...bare } = SLOW;
  assert.throws(() => registries.modes.add('test-no-voice', { ...bare, name: 'test-no-voice' }), /mode "test-no-voice": voiceSpeed must be/);
  assert.equal(registries.modes.has('test-no-voice'), false, 'a refused mode is not left in the registry');
  assert.throws(() => registries.modes.add('test-fast-voice', { ...SLOW, name: 'test-fast-voice', voiceSpeed: 2 }), /mode "test-fast-voice": voiceSpeed must be/);
  assert.throws(() => registries.modes.add('test-bad-pause', { ...SLOW, name: 'test-bad-pause', emphasisPause: -1 }), /emphasisPause must be/);
  registries.modes.add('test-voiced', { ...SLOW, name: 'test-voiced' });
  assert.equal(registries.modes.get('test-voiced').voiceSpeed, 1.0);
});

// ---- loudness: the mastering targets of a voiced film are mode data ----

test('pro and viral carry their loudness targets: pro -16 LUFS / -1.5 dBTP / LRA 11, viral -14 / -1 / 9', () => {
  assert.deepEqual(registries.modes.get('pro').loudness, { lufs: -16, truePeakDb: -1.5, lra: 11 });
  assert.deepEqual(registries.modes.get('viral').loudness, { lufs: -14, truePeakDb: -1, lra: 9 });
  assert.ok(Object.isFrozen(registries.modes.get('pro').loudness), 'mode data cannot be changed in place');
});

test('a mode whose loudness is missing, out of range or malformed fails validateMode, naming the mode and the field', () => {
  const ok = { ...SLOW };
  assert.doesNotThrow(() => validateMode(ok));
  const { loudness: _loudness, ...bare } = SLOW;
  assert.throws(() => validateMode(bare), /mode "test-slow": loudness must be \{ lufs, truePeakDb, lra \}, got undefined/);
  for (const lufs of [-31, -4, NaN, '-16', undefined]) {
    assert.throws(() => validateMode({ ...ok, loudness: { ...ok.loudness, lufs } }), /mode "test-slow": loudness\.lufs must be a number from -30 to -5/, String(lufs));
  }
  for (const truePeakDb of [-3.1, 0.1, null]) {
    assert.throws(() => validateMode({ ...ok, loudness: { ...ok.loudness, truePeakDb } }), /mode "test-slow": loudness\.truePeakDb must be a number from -3 to 0/, String(truePeakDb));
  }
  for (const lra of [0.5, 51, Infinity]) {
    assert.throws(() => validateMode({ ...ok, loudness: { ...ok.loudness, lra } }), /mode "test-slow": loudness\.lra must be a number from 1 to 50/, String(lra));
  }
  assert.throws(() => validateMode({ ...ok, loudness: -16 }), /mode "test-slow": loudness must be \{ lufs, truePeakDb, lra \}/);
});

test('a mode added to the shared registry must carry its loudness: without it, it cannot register', () => {
  const { loudness: _loudness, ...bare } = SLOW;
  assert.throws(() => registries.modes.add('test-no-loudness', { ...bare, name: 'test-no-loudness' }), /mode "test-no-loudness": loudness must be \{ lufs, truePeakDb, lra \}/);
  assert.equal(registries.modes.has('test-no-loudness'), false);
  assert.throws(() => registries.modes.add('test-loud', { ...SLOW, name: 'test-loud', loudness: { lufs: 0, truePeakDb: -1, lra: 9 } }), /loudness\.lufs must be/);
});

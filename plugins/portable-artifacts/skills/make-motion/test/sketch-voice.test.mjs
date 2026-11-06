// Task 12: voice sync. A hand-drawn scene whose audio track has a voice sidecar beside it (scripts/voice.mjs writes
// <name>.json next to <name>.wav) draws its top-level elements during the narration's sentences. The sidecars here are
// fakes in test/fixtures (no model runs); the audio is a small generated WAV.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { requireRender, BROWSER_ONLY } from './helpers/render.mjs';
import { writeWav } from './helpers/wav.mjs';
import lucide from '../template/sketch/lucide.mjs';
import { planScene } from '../template/sketch/plan.mjs';
import { assignWindows } from '../template/sketch/timing.mjs';
import { expandSpec } from '../template/defaults.mjs'; // before layout.mjs: the two import each other, and defaults.mjs must load first
import { validateSpec } from '../scripts/lib/spec.mjs';
import { resolveSpecBeats, needsResolving } from '../scripts/lib/beats-file.mjs';
import { resolveSketchVoice, voiceSidecars, MAX_SIDECAR_BYTES } from '../scripts/lib/sketch-voice.mjs';
import { assetSrcs, startServer } from '../scripts/lib/server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(root, 'test/fixtures');
const CHECK = path.join(root, 'scripts/check.mjs');
const RENDER = path.join(root, 'scripts/render.mjs');
const SIZE = [1920, 1080];
const EPS = 1e-6;
const near = (a, b, eps = EPS) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

// fixtures/voice/five.json: sentences at 0-2, 2-4.5, 4.5-6, 6-8.5, 8.5-10. four.json: four of 2.5 s. (Not beside the specs in
// fixtures/: other tests read every .json there as a spec.)
const VOICES = path.join(FIXTURES, 'voice');
const sentencesOf = (fixture) => JSON.parse(readFileSync(path.join(VOICES, fixture), 'utf8')).sentences.map(({ start, end }) => ({ start, end }));
const FIVE = sentencesOf('five.json');
const FOUR = sentencesOf('four.json');

// ---- the stroke plan with narration -----------------------------------------------------------------------------------------

const rect = (id, x, extra = {}) => ({ id, type: 'shape', shape: 'rect', x, y: 540, width: 300, height: 200, ...extra });
const label = (id, x, y = 540, extra = {}) => ({ id, type: 'text', text: 'hello world', x, y, fontSize: 80, ...extra });
const scene = (elements, narration) => ({ id: 's', duration: 30, style: 'sketch', elements, ...(narration ? { narration } : {}) });
const plan = (elements, narration, ctx = {}) => planScene(scene(elements, narration), { size: SIZE, seed: 1, pace: 1, icons: lucide, sceneIndex: 0, ...ctx });
const at = (p, k) => p.elements.get(`scenes[0].elements[${k}]`);
const FOUR_RECTS = [rect('a', 300), rect('b', 700), rect('c', 1100), rect('d', 1500)];

test('4 elements and 4 sentences: element k gets sentence k', () => {
  const windows = assignWindows([1, 1, 1, 1].map((weight) => ({ weight })), FOUR);
  assert.deepEqual(windows.map(({ start, end }) => ({ start, end })), FOUR);
  assert.deepEqual(windows.map((w) => w.pinned), [false, false, false, false]);
  const p = plan(FOUR_RECTS, FOUR);
  FOUR.forEach(({ start, end }, k) => {
    const { t0, t1 } = at(p, k);
    assert.ok(t0 >= start - EPS && t1 <= end + EPS, `element ${k} draws ${t0.toFixed(2)}-${t1.toFixed(2)} inside sentence ${k} (${start}-${end})`);
    if (k > 0) near(t0, start);
  });
  assert.equal(p.overruns.length, 0);
});

test('2 elements over 5 sentences share the whole narration in proportion to drawing length', () => {
  const windows = assignWindows([{ weight: 1 }, { weight: 3 }], FIVE);
  assert.deepEqual(windows.map(({ start, end }) => ({ start, end })), [{ start: 0, end: 2.5 }, { start: 2.5, end: 10 }]);
  // The same through the plan: a text three times as long as a box takes three times the share.
  const [box, words] = [rect('box', 500), label('words', 1300, 540, { text: 'a rather longer line of words to write' })];
  const p = plan([box, words], FIVE);
  const natural = plan([box, words]);
  const [boxSeconds, wordSeconds] = [natural, natural].map((n, k) => at(n, k).t1 - at(n, k).t0);
  assert.ok(at(p, 0).t1 <= 10 * (boxSeconds / (boxSeconds + wordSeconds)) + EPS, 'the box ends inside its share');
  assert.ok(at(p, 1).t0 >= 10 * (boxSeconds / (boxSeconds + wordSeconds)) - EPS, 'the words start after it');
  assert.ok(at(p, 1).t1 <= 10 + EPS);
});

test('with more elements than sentences they share the narration too', () => {
  const windows = assignWindows([{ weight: 1 }, { weight: 1 }, { weight: 1 }, { weight: 1 }, { weight: 1 }, { weight: 1 }], FOUR);
  near(windows[0].start, 0);
  near(windows[5].end, 10);
  windows.slice(1).forEach((w, k) => near(w.start, windows[k].end));
  near(windows[2].end - windows[2].start, 10 / 6);
  assert.deepEqual(assignWindows([{ weight: 0 }, { weight: 0 }], FOUR).map(({ start, end }) => [start, end]), [[0, 5], [5, 10]], 'no weight at all: equal shares');
});

test('a block counts as one element and its parts share its window', () => {
  const group = { id: 'g', type: 'group', x: 0, y: 0, children: [label('one', 400, 300), label('two', 400, 500), label('three', 400, 700)] };
  const natural = plan([group, rect('after', 1500)]);
  const [t0, t1] = [at(natural, 0).t0, at(natural, 0).t1];
  const narration = [{ start: 0, end: t0 + 1.5 * (t1 - t0) }, { start: t0 + 1.5 * (t1 - t0), end: 12 }];
  const p = plan([group, rect('after', 1500)], narration);
  const part = (m) => p.elements.get(`scenes[0].elements[0].children[${m}]`);
  near(part(0).t0, t0); // the parts start with the group's window...
  near(part(2).t1, narration[0].end); // ...and the three of them fill it together
  assert.ok(part(0).t1 <= part(1).t0 + EPS && part(1).t1 <= part(2).t0 + EPS, 'one after another inside it');
  assert.ok(at(p, 1).t0 >= narration[1].start - EPS, 'the next element takes the next sentence');
  assert.equal(assignWindows([{ weight: 3 }, { weight: 1 }], FOUR).length, 2, 'a block is one item: two items, not four parts');
});

test('a pinned element splits runs: earlier elements use sentences before it, later ones after it', () => {
  const items = [{ weight: 1 }, { weight: 1 }, { weight: 1, sentence: 3 }, { weight: 1 }];
  const windows = assignWindows(items, FIVE);
  // items 0 and 1 share sentences 0-2 (0 to 6 s); item 2 takes sentence 3 and item 3 sentence 4
  near(windows[0].start, 0);
  near(windows[1].end, 6);
  assert.deepEqual([windows[2].start, windows[2].end, windows[2].pinned], [6, 8.5, true]);
  assert.deepEqual([windows[3].start, windows[3].end, windows[3].pinned], [8.5, 10, false]);
  const p = plan(FOUR_RECTS.map((el, k) => (k === 2 ? { ...el, drawAt: { sentence: 3 } } : el)), FIVE);
  assert.ok(at(p, 0).t1 <= 6 + EPS && at(p, 1).t1 <= 6 + EPS, 'the elements before the pin end by sentence 2');
  assert.ok(at(p, 2).t0 >= 6 - EPS && at(p, 2).t1 <= 8.5 + EPS, 'the pinned one draws during sentence 3');
  assert.ok(at(p, 3).t0 >= 8.5 - EPS && at(p, 3).t1 <= 10 + EPS, 'the one after it takes the next');
  // two pins: the run from the first shares sentences 1-3 between its two items; the second pin takes the last sentence
  const twice = assignWindows([{ weight: 1, sentence: 1 }, { weight: 1 }, { weight: 1, sentence: 4 }], FIVE);
  [[2, 5.25], [5.25, 8.5], [8.5, 10]].forEach(([start, end], k) => { near(twice[k].start, start); near(twice[k].end, end); });
  // a pin that comes before where the items ahead of it must end leaves them no sentence: an empty window, reported by the plan
  const behind = assignWindows([{ weight: 1 }, { weight: 1, sentence: 0 }], FIVE);
  assert.deepEqual([behind[0].start, behind[0].end], [0, 0]);
  const crowded = plan([rect('a', 300), rect('b', 700, { drawAt: { sentence: 0 } })], FIVE);
  assert.equal(crowded.overruns.length, 1, 'the element with no sentence cannot be drawn');
  assert.equal(crowded.overruns[0].path, 'scenes[0].elements[0]');
});

test('a drawing stretches to fill its window, to half pace at most, then the hand leaves and the board holds', () => {
  const natural = plan([rect('box', 960)]);
  const { t0, t1 } = at(natural, 0);
  const n = t1 - t0;
  const fill = plan([rect('box', 960)], [{ start: 0, end: t0 + 1.5 * n }]);
  near(at(fill, 0).t0, t0);
  near(at(fill, 0).t1, t0 + 1.5 * n); // fills the window exactly
  const roomy = plan([rect('box', 960)], [{ start: 0, end: 20 }]);
  near(at(roomy, 0).t1 - at(roomy, 0).t0, 2 * n); // half pace at most
  assert.ok(roomy.drawEnd < 5, 'then the hand is done long before the window ends');
  const exit = roomy.moves.at(-1);
  assert.equal(exit.kind, 'exit');
  near(exit.t0, roomy.drawEnd);
  assert.equal(roomy.overruns.length, 0);
});

test('a drawing squeezes into a short window, to twice pace at most', () => {
  const natural = plan([rect('box', 960)]);
  const { t0, t1 } = at(natural, 0);
  const n = t1 - t0;
  const tight = plan([rect('box', 960)], [{ start: 0, end: t0 + 0.7 * n }]);
  near(at(tight, 0).t1 - at(tight, 0).t0, 0.7 * n);
  assert.equal(tight.overruns.length, 0);
});

test('a drawing that cannot fit at twice pace reports a problem naming the element and the seconds needed', () => {
  const natural = plan([rect('box', 960)]);
  const { t0, t1 } = at(natural, 0);
  const n = t1 - t0;
  const p = plan([rect('box', 960)], [{ start: 0, end: t0 + 0.4 * n }]);
  assert.equal(p.overruns.length, 1);
  assert.equal(p.overruns[0].path, 'scenes[0].elements[0]');
  const needed = Math.ceil((t0 + 0.5 * n - 1e-9) * 10) / 10;
  assert.match(p.overruns[0].message, /^shape "box" cannot be drawn during the narration it is matched to, even at twice the pace: that lasts \d+(\.\d+)?s and the drawing needs \d+\.\ds;/);
  assert.ok(p.overruns[0].message.includes(`the drawing needs ${needed}s;`), `${p.overruns[0].message} needs ${needed}s`);
  assert.deepEqual(p.problems, [], 'not a plan problem: validation passes and the page still draws it (check.mjs reports it)');
  near(at(p, 0).t1 - at(p, 0).t0, 0.5 * n); // drawn at twice pace anyway
});

test('a numeric drawAt on a voiced element still holds it back; drawAt inside a group is refused in a voiced scene', () => {
  const late = plan([rect('box', 960, { drawAt: 8 })], [{ start: 0, end: 20 }]);
  near(at(late, 0).t0, 8);
  const nested = plan([{ id: 'g', type: 'group', x: 0, y: 0, children: [label('one', 400, 300, { drawAt: 2 })] }], [{ start: 0, end: 20 }]);
  assert.equal(nested.problems.length, 1);
  assert.equal(nested.problems[0].path, 'scenes[0].elements[0].children[0]');
  assert.match(nested.problems[0].message, /^drawAt on an element inside a group does not apply in a scene with narration/);
  const unvoiced = plan([{ id: 'g', type: 'group', x: 0, y: 0, children: [label('one', 400, 300, { drawAt: 2 })] }]);
  assert.deepEqual(unvoiced.problems, [], 'the same group in a scene without narration is as it always was');
});

test('changing the track\'s at shifts windows by the same amount', () => {
  const dir = project();
  const at0 = resolveSketchVoice(film(FOUR_RECTS), dir).spec.scenes[0].narration;
  const at15 = resolveSketchVoice(film(FOUR_RECTS, { at: 1.5 }), dir).spec.scenes[0].narration;
  assert.deepEqual(at15, at0.map(({ start, end }) => ({ start: start + 1.5, end: end + 1.5 })));
  const [early, shifted] = [plan(FOUR_RECTS, at0), plan(FOUR_RECTS, at15)];
  for (let k = 1; k < 4; k++) {
    near(at(shifted, k).t0, at(early, k).t0 + 1.5);
    near(at(shifted, k).t1, at(early, k).t1 + 1.5);
  }
});

// ---- the voice step: sidecar to narration ---------------------------------------------------------------------------------

// A spec folder holding voice/intro.wav and (by default) voice/intro.json, a copy of fixture `sidecar`.
function project({ sidecar = 'five.json', raw, src = 'voice/intro.wav' } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'sketch-voice-'));
  mkdirSync(path.join(dir, 'voice'));
  writeWav(path.join(dir, src), { seconds: 0.2 });
  const side = path.join(dir, src.replace(/\.wav$/i, '.json'));
  if (raw !== undefined) writeFileSync(side, raw);
  else if (sidecar) copyFileSync(path.join(VOICES, sidecar), side);
  return dir;
}

// A one-scene hand-drawn film with one voice track on scene "s" (`at`: where the track starts in it).
function film(elements, { at: start, duration = 12, audio, scene: sceneExtra = {}, spec = {} } = {}) {
  const track = { src: 'voice/intro.wav', scene: 's', ...(start === undefined ? {} : { at: start }) };
  return { size: SIZE, fps: 30, style: 'sketch', audio: audio ?? [track], scenes: [{ id: 's', duration, elements, ...sceneExtra }], ...spec };
}

const errorsOf = (result) => (result.errors ?? []).map((e) => `${e.path}: ${e.message}`);
const validated = (spec, dir) => validateSpec(spec, { dir }).errors.map((e) => `${e.path}: ${e.message}`);

test('a scene whose audio track has a sidecar gets narration in scene seconds; the sentence texts and phonemes stay out of the spec', () => {
  const dir = project();
  const { spec } = resolveSketchVoice(film(FOUR_RECTS), dir);
  assert.deepEqual(spec.scenes[0].narration, FIVE);
  assert.deepEqual(Object.keys(spec.scenes[0].narration[0]).sort(), ['end', 'start']);
});

test('a track with no sidecar is not a voice track', () => {
  const dir = project({ sidecar: null });
  const written = film(FOUR_RECTS);
  const result = resolveSketchVoice(written, dir);
  assert.equal(result.spec, written, 'the very same spec');
  assert.deepEqual(errorsOf(resolveSketchVoice(film([rect('a', 300, { drawAt: 'sentence:1' })]), dir)), [
    'scenes[0].elements[0].drawAt: drawAt "sentence:1" needs a voice track: an audio entry with "scene": "s" whose file has a voice sidecar beside it (node scripts/voice.mjs writes one next to the .wav)',
  ]);
});

test('a track for another scene, or for no scene, or a sound that is not a .wav, is not this scene\'s voice track', () => {
  const dir = project();
  for (const audio of [[{ src: 'voice/intro.wav', scene: 'other' }], [{ src: 'voice/intro.wav' }]]) {
    const written = film(FOUR_RECTS, { audio });
    assert.equal(resolveSketchVoice(written, dir).spec, written);
  }
  const mp3 = project({ src: 'voice/intro.wav' });
  copyFileSync(path.join(mp3, 'voice/intro.wav'), path.join(mp3, 'voice/intro.mp3'));
  const written = film(FOUR_RECTS, { audio: [{ src: 'voice/intro.mp3', scene: 's' }] });
  assert.equal(resolveSketchVoice(written, mp3).spec, written, 'sidecarPath leaves an mp3 name as it is: the audio is never parsed as a sidecar');
});

test('only hand-drawn scenes are given narration', () => {
  const dir = project();
  const written = film(FOUR_RECTS, { spec: { style: 'standard' } });
  assert.equal(resolveSketchVoice(written, dir).spec, written);
});

test('sentence:9 past the end is an error naming the count; sentence:<n> with no voice track is an error', () => {
  const dir = project();
  assert.deepEqual(errorsOf(resolveSketchVoice(film([rect('a', 300), rect('b', 700, { drawAt: 'sentence:9' })]), dir)), [
    'scenes[0].elements[1].drawAt: sentence:9 does not exist; the narration of scene "s" has 5 sentences (0 to 4)',
  ]);
  assert.deepEqual(errorsOf(resolveSketchVoice(film([rect('a', 300, { drawAt: 'sentence:5' })]), dir)), [
    'scenes[0].elements[0].drawAt: sentence:5 does not exist; the narration of scene "s" has 5 sentences (0 to 4)',
  ]);
  const four = project({ sidecar: 'four.json' });
  assert.match(errorsOf(resolveSketchVoice(film([rect('a', 300, { drawAt: 'sentence:4' })]), four))[0], /has 4 sentences \(0 to 3\)$/);
  const bare = film([rect('a', 300, { drawAt: 'sentence:1' })], { audio: [] });
  assert.deepEqual(errorsOf(resolveSketchVoice(bare, dir)), [
    'scenes[0].elements[0].drawAt: drawAt "sentence:1" needs a voice track: an audio entry with "scene": "s" whose file has a voice sidecar beside it (node scripts/voice.mjs writes one next to the .wav)',
  ]);
});

test('sentence:<n> becomes { sentence: n }, on a nested element too, and resolving a resolved spec changes nothing', () => {
  const dir = project();
  const written = film([rect('a', 300, { drawAt: 'sentence:2' }), { id: 'g', type: 'group', x: 0, y: 0, children: [label('t', 400, 300, { drawAt: 'sentence:1' })] }]);
  const { spec } = resolveSketchVoice(written, dir);
  assert.deepEqual(spec.scenes[0].elements[0].drawAt, { sentence: 2 });
  assert.deepEqual(spec.scenes[0].elements[1].children[0].drawAt, { sentence: 1 });
  assert.equal(written.scenes[0].elements[0].drawAt, 'sentence:2', 'the input is not changed');
  const again = resolveSketchVoice(spec, dir);
  assert.deepEqual(again.spec, spec);
  assert.equal(again.spec, spec, 'the very same object');
});

test('a written narration field is an error; the resolved one is accepted', () => {
  const dir = project();
  const lie = film(FOUR_RECTS, { scene: { narration: [{ start: 0, end: 1 }] } });
  assert.deepEqual(errorsOf(resolveSketchVoice(lie, dir)), ['scenes[0].narration: narration is set from the voice file beside the audio track, not written in the spec; remove it']);
  const noVoice = project({ sidecar: null });
  assert.equal(errorsOf(resolveSketchVoice(lie, noVoice)).length, 1, 'with no voice file there is nothing it could be');
  const standard = { size: SIZE, fps: 30, scenes: [{ id: 's', duration: 3, elements: [label('t', 960)], narration: [{ start: 0, end: 1 }] }] };
  assert.equal(errorsOf(resolveSketchVoice(standard, dir)).length, 1, 'a standard scene takes none either');
  // validateSpec resolves first and checks what is written: the lie fails, the resolved spec passes again
  assert.deepEqual(validated(lie, dir), ['scenes[0].narration: narration is set from the voice file beside the audio track, not written in the spec; remove it']);
  const resolved = resolveSpecBeats(film(FOUR_RECTS), dir).spec;
  assert.deepEqual(validated(resolved, dir), []);
  assert.deepEqual(validated(film(FOUR_RECTS), dir), []);
});

test('numeric drawAt on a voiced scene still validates; a voiced scene too short for its drawing is not a validation error', () => {
  const dir = project();
  assert.deepEqual(validated(film([rect('a', 300, { drawAt: 1.5 })], { duration: 12 }), dir), []);
  assert.deepEqual(validated(film([rect('a', 300, { drawAt: 12 })], { duration: 12 }), dir), ['scenes[0].elements[0].drawAt: drawAt 12 is outside scene "s", which lasts 12s; use 0 or more and less than 12, or "sentence:<n>"']);
  // The drawing needs more than 0.6 s; with a voice it is check.mjs's call (overruns, unfinished writing), without one it is an error.
  const tight = film([label('long', 960, 540, { text: 'a line of words that takes a while to write out' })], { duration: 0.6 });
  assert.deepEqual(validated(tight, dir), []);
  const silent = project({ sidecar: null });
  assert.match(validated(tight, silent)[0], /^scenes\[0\]: this drawing needs a scene of at least \d+\.\ds$/);
});

test('no voice track: natural pace, the same plan as without audio', () => {
  const dir = project({ sidecar: null });
  const [withAudio, without] = [film(FOUR_RECTS), film(FOUR_RECTS, { audio: [] })];
  const plans = [withAudio, without].map((spec) => {
    const resolved = resolveSpecBeats(spec, dir).spec;
    return planScene(expandSpec(resolved).scenes[0], { size: SIZE, icons: lucide, sceneIndex: 0 });
  });
  assert.deepEqual(plans[0], plans[1]);
  assert.equal(plans[0].overruns.length, 0);
});

test('the same files give the same plan every time', () => {
  const dir = project();
  const plans = [0, 1].map(() => planScene(expandSpec(resolveSpecBeats(film(FOUR_RECTS), dir).spec).scenes[0], { size: SIZE, icons: lucide, sceneIndex: 0 }));
  assert.deepEqual(plans[0], plans[1]);
  assert.deepEqual(JSON.parse(JSON.stringify(plans[0].strokes)), plans[0].strokes);
});

test('a block keeps its sentence pin on its group', () => {
  const block = { id: 'b', type: 'block', block: 'title-card', x: 960, y: 540, params: { title: 'Hi' }, drawAt: { sentence: 2 } };
  assert.deepEqual(expandSpec({ scenes: [{ id: 's', duration: 5, narration: FIVE, elements: [block] }] }).scenes[0].elements[0].drawAt, { sentence: 2 });
  assert.deepEqual(expandSpec({ scenes: [{ id: 's', duration: 5, narration: FIVE, elements: [block] }] }).scenes[0].narration, FIVE, 'and the scene keeps its narration');
});

// ---- the sidecar is untrusted file content -----------------------------------------------------------------------------------

const SIDECAR = 'voice/intro.json';
const sidecarErrors = (raw) => errorsOf(resolveSketchVoice(film(FOUR_RECTS), project({ raw })));

test('a sidecar that is not usable is an error at the audio src, naming the file', () => {
  assert.deepEqual(sidecarErrors('{ nope'), [`audio[0].src: ${SIDECAR} is not valid JSON: ${(() => { try { JSON.parse('{ nope'); } catch (e) { return e.message; } })()}`]);
  assert.deepEqual(sidecarErrors('[]'), [`audio[0].src: ${SIDECAR}: must be an object like { "sentences": [{ "start": 0, "end": 2.1 }] }`]);
  assert.deepEqual(sidecarErrors('{}'), [`audio[0].src: ${SIDECAR}: "sentences" must be an array like [{ "start": 0, "end": 2.1 }]`]);
  assert.deepEqual(sidecarErrors('{"sentences":[]}'), [`audio[0].src: ${SIDECAR}: "sentences" has no sentences; the voice file says nothing`]);
  assert.deepEqual(sidecarErrors('{"sentences":[5]}'), [`audio[0].src: ${SIDECAR}: sentences[0] must be an object like { "start": 0, "end": 2.1 }`]);
});

test('sidecar times must be finite numbers with start <= end, in order', () => {
  const one = (s) => sidecarErrors(JSON.stringify({ sentences: [{ start: 0, end: 1 }, s] }));
  assert.deepEqual(one({ start: 'x', end: 2 }), [`audio[0].src: ${SIDECAR}: sentences[1].start is "x"; it must be a number of seconds, 0 or more`]);
  assert.deepEqual(one({ start: -1, end: 2 }), [`audio[0].src: ${SIDECAR}: sentences[1].start is -1; it must be a number of seconds, 0 or more`]);
  assert.deepEqual(one({ start: 1 }), [`audio[0].src: ${SIDECAR}: sentences[1].end is undefined; it must be a number of seconds`]);
  assert.deepEqual(one({ start: 3, end: 2 }), [`audio[0].src: ${SIDECAR}: sentences[1] ends (2) before it starts (3)`]);
  assert.deepEqual(sidecarErrors('{"sentences":[{"start":2,"end":3},{"start":1,"end":4}]}'), [`audio[0].src: ${SIDECAR}: sentences[1].start (1) comes before sentences[0].start (2); list the sentences in order`]);
  // JSON cannot say NaN or Infinity, but a number too large for a double reads as Infinity, and that is refused as well
  assert.deepEqual(sidecarErrors('{"sentences":[{"start":0,"end":1e999}]}'), [`audio[0].src: ${SIDECAR}: sentences[0].end is Infinity; it must be a number of seconds`]);
});

test('a sidecar over the size limit, and a symbolic link out of the folder, are refused', () => {
  const big = sidecarErrors(`{"sentences":[{"start":0,"end":1}],"pad":"${'x'.repeat(MAX_SIDECAR_BYTES)}"}`);
  assert.match(big[0], /^audio\[0\]\.src: voice\/intro\.json is \d+ bytes; a voice file is at most 1048576 bytes$/);
  const dir = project({ sidecar: null });
  const outside = path.join(mkdtempSync(path.join(tmpdir(), 'sketch-voice-out-')), 'secret.json');
  copyFileSync(path.join(VOICES, 'five.json'), outside);
  symlinkSync(outside, path.join(dir, SIDECAR));
  const result = resolveSketchVoice(film(FOUR_RECTS), dir);
  assert.deepEqual(errorsOf(result), [`audio[0].src: ${SIDECAR}: must stay inside the spec folder`]);
});

test('two voice tracks for one scene are an error', () => {
  const dir = project();
  writeWav(path.join(dir, 'voice/more.wav'), { seconds: 0.2 });
  copyFileSync(path.join(VOICES, 'four.json'), path.join(dir, 'voice/more.json'));
  const audio = [{ src: 'voice/intro.wav', scene: 's' }, { src: 'voice/more.wav', scene: 's', at: 1 }];
  assert.deepEqual(errorsOf(resolveSketchVoice(film(FOUR_RECTS, { audio }), dir)), ['audio[1].src: scene "s" has a second voice track; a drawn scene lines up with one (audio[0] is the first)']);
});

test('voiceSidecars names the file beside every .wav track that has a scene, as written', () => {
  assert.deepEqual(voiceSidecars(film([], { audio: [{ src: 'v/a.wav', scene: 's' }, { src: 'v/b.WAV', scene: 's' }, { src: 'v/c.mp3', scene: 's' }, { src: 'v/d.wav' }] })), ['v/a.json', 'v/b.json']);
  assert.deepEqual(voiceSidecars({ scenes: [] }), []);
});

// ---- the four consumers get the narration ------------------------------------------------------------------------------------

function writeFilm(dir, spec, name = 'motion.json') {
  const file = path.join(dir, name);
  writeFileSync(file, JSON.stringify(spec));
  return file;
}

test('needsResolving: a beats file or a hand-drawn scene; any other spec is served as written', () => {
  assert.equal(needsResolving({ beats: 'a.json', scenes: [] }), true);
  assert.equal(needsResolving(film([])), true);
  assert.equal(needsResolving({ scenes: [{ id: 's', style: 'sketch' }] }), true);
  assert.equal(needsResolving({ scenes: [{ id: 's' }] }), false);
  assert.equal(needsResolving({ style: 'sketch', scenes: [{ id: 's', style: 'standard' }] }), false);
});

test('validateSpec and resolveSpecBeats: a spec with a voice track and no root beats reaches the voice step', () => {
  const dir = project();
  const written = film(FOUR_RECTS);
  assert.equal(Object.hasOwn(written, 'beats'), false);
  assert.deepEqual(resolveSpecBeats(written, dir).spec.scenes[0].narration, FIVE);
  assert.deepEqual(validated(film([rect('a', 300, { drawAt: 'sentence:9' })]), dir), ['scenes[0].elements[0].drawAt: sentence:9 does not exist; the narration of scene "s" has 5 sentences (0 to 4)']);
  // with a beats file too: a beat reference is seconds before the voice step reads the track's at
  writeFileSync(path.join(dir, 'm.beats.json'), JSON.stringify({ beats: [0.5, 1, 1.5] }));
  const both = film(FOUR_RECTS, { at: 'beat:2', spec: { beats: 'm.beats.json' } });
  assert.deepEqual(resolveSpecBeats(both, dir).spec.scenes[0].narration[0], { start: 1.5, end: 3.5 });
});

test('the preview server: /spec.json of a voiced spec with no root beats carries narration and sentence pins; a standard spec is still served byte for byte', async () => {
  const dir = project();
  const specPath = writeFilm(dir, film([rect('a', 300), rect('b', 700, { drawAt: 'sentence:3' })]));
  const server = await startServer({ specPath, mode: 'preview' });
  try {
    const served = await (await fetch(new URL('/spec.json', server.url))).json();
    assert.deepEqual(served.scenes[0].narration, FIVE);
    assert.deepEqual(served.scenes[0].elements[1].drawAt, { sentence: 3 });
  } finally { await server.close(); }
  const standardPath = writeFilm(dir, { scenes: [{ id: 's', duration: 1, elements: [label('t', 960)] }] }, 'plain.json');
  const plain = await startServer({ specPath: standardPath, mode: 'preview' });
  try {
    const body = await (await fetch(new URL('/spec.json', plain.url))).text();
    assert.equal(body, readFileSync(standardPath, 'utf8'));
  } finally { await plain.close(); }
});

test('the preview server watches the voice file as it does the beats file: it is a referenced asset, so a change reloads', async () => {
  const dir = project();
  const written = film(FOUR_RECTS, { audio: [{ src: 'voice/intro.wav', scene: 's' }, { src: 'voice/intro.wav' }] });
  assert.ok(assetSrcs(written).includes('voice/intro.json'));
  assert.ok(!assetSrcs(film(FOUR_RECTS, { audio: [{ src: 'voice/intro.wav' }] })).includes('voice/intro.json'), 'a track with no scene has none');
  const server = await startServer({ specPath: writeFilm(dir, written), mode: 'preview' });
  try {
    assert.equal((await fetch(new URL('/assets/voice/intro.json', server.url))).status, 200);
  } finally { await server.close(); }
});

test('render: a voiced spec with no root beats is drawn from the resolved spec (the poster differs from the one drawn without the voice)', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  // Element "b" is pinned to sentence 3 (6 s). At 4 s a render that heard the narration has not started it; one that did not
  // has drawn it long ago (the pin would be ignored). So the posters differ only if the resolved spec reached the page.
  const small = { size: [640, 360] };
  const elements = (pin) => [rect('a', 160, { y: 180, width: 120, height: 80 }), rect('b', 480, { y: 180, width: 120, height: 80, ...(pin ? { drawAt: 'sentence:3' } : {}) })];
  const voiced = project();
  const unvoiced = project({ sidecar: null });
  const posters = [[voiced, true], [unvoiced, false]].map(([dir, pin]) => {
    const spec = writeFilm(dir, film(elements(pin), { duration: 12, spec: small }));
    const png = path.join(dir, 'p.png');
    const r = spawnSync(process.execPath, [RENDER, spec, '--poster', '4', '--poster-out', png], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return readFileSync(png);
  });
  assert.ok(!posters[0].equals(posters[1]), 'the narration reached the page: the pinned box is not drawn yet at 4 s');
});

// ---- check.mjs ---------------------------------------------------------------------------------------------------------------

const verdict = (file) => JSON.parse(spawnSync(process.execPath, [CHECK, file, '--json'], { encoding: 'utf8' }).stdout);
const textLine = (id, y = 540, extra = {}) => label(id, 960, y, { text: 'Five words to be read', fontSize: 96, ...extra });

test('check: writing still going at the scene\'s end in a voiced scene reaches unfinishedWriting and warns', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  // The track starts at 5 s and says its five sentences until 15 s; the one element has all of it, stretched to half pace
  // (about 1.9 s), so it is still being written when the 6 s scene ends. Validation accepts the spec (the drawing follows the voice).
  const dir = project();
  const file = writeFilm(dir, film([textLine('late')], { at: 5, duration: 6 }));
  assert.deepEqual(validated(JSON.parse(readFileSync(file, 'utf8')), dir), []);
  const found = verdict(file);
  const warning = (found.warnings ?? []).find((w) => /still being drawn/.test(w.message));
  assert.ok(warning, JSON.stringify(found));
  assert.equal(warning.path, 'scenes[0]');
  assert.match(warning.message, /^scene "s" ends at 6\.00s while text "late" is still being drawn; the drawing needs \d+\.\ds: lengthen the scene$/);
  // The same film with its voice file removed finishes the writing in time: no such warning
  const silent = project({ sidecar: null });
  const quiet = verdict(writeFilm(silent, film([textLine('late')], { at: 5, duration: 6 })));
  assert.deepEqual((quiet.warnings ?? []).filter((w) => /still being drawn/.test(w.message)), []);
});

test('check: a voiced drawing that cannot fit its sentence at twice pace is a problem naming the element and the seconds', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const words = 'This is a very long line of handwriting that goes on and on and on, far too long to be written in the two and a half seconds of one short sentence, even when the pencil flies at twice its usual pace';
  const long = textLine('crammed', 540, { text: words, fontSize: 60, maxWidth: 1700 });
  const dir = project({ sidecar: 'four.json' });
  // the box takes sentence 0 and "crammed" is pinned to the last one (2.5 s)
  const file = writeFilm(dir, film([rect('box', 400, { drawAt: 'sentence:0' }), { ...long, drawAt: 'sentence:3' }], { duration: 12 }));
  const found = verdict(file);
  assert.equal(found.ok, false, JSON.stringify(found));
  const hit = found.errors.find((e) => /cannot be drawn during the narration/.test(e.message));
  assert.ok(hit, JSON.stringify(found.errors));
  assert.equal(hit.path, 'scenes[0].elements[1]');
  assert.match(hit.message, /^text "crammed" cannot be drawn during the narration it is matched to, even at twice the pace: that lasts 2\.5s and the drawing needs \d+\.\ds;/);
});

test('check: a voiced still board is exempt from the dead-stretch audit while the narration plays; the same board without the voice is not', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const words = [textLine('title')];
  const voiced = verdict(writeFilm(project(), film(words, { duration: 14 })));
  assert.equal(voiced.ok, true, JSON.stringify(voiced));
  // the control: the board is the same, no voice file, and the audit fires on the finished board held for 6+ s
  const silent = verdict(writeFilm(project({ sidecar: null }), film(words, { duration: 14 })));
  assert.equal(silent.ok, false, JSON.stringify(silent));
  assert.match(silent.errors[0].message, /^nothing changes from \d+\.\d\ds to 11\.00s/);
});

// ---- loading -----------------------------------------------------------------------------------------------------------------

test('importing the voice step does not load the voice model, and the import cycle through voice.mjs loads from either end', () => {
  const source = readFileSync(path.join(root, 'scripts/lib/voice.mjs'), 'utf8');
  assert.deepEqual([...source.matchAll(/^import [^;]*from '([^']+)'/gm)].map((m) => m[1]).filter((m) => /kokoro|huggingface|onnx/.test(m)), [], 'voice.mjs has no static import of the model stack');
  for (const first of ['scripts/lib/sketch-voice.mjs', 'scripts/lib/voice.mjs', 'scripts/lib/spec.mjs']) {
    const url = pathToFileURL(path.join(root, first)).href;
    const voiceStep = pathToFileURL(path.join(root, 'scripts/lib/sketch-voice.mjs')).href;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(url)}); const m = await import(${JSON.stringify(voiceStep)}); console.log(typeof m.resolveSketchVoice)`], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${first}: ${r.stderr}`);
    assert.match(r.stdout, /^function\n/, first);
  }
});

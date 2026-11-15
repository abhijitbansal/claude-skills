// buildTimeline with measured words (a voice sidecar's shots) and without them. Without words the timeline must stay
// exactly what it was before measured words existed: the gate films are compared with their timelines as frozen before
// the change (fixtures/voice/timeline-gate-*.json, written by .scratch/voice/freeze-gate-timelines.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../scripts/v2/list.mjs'; // registers the looks, kinds, devices and cuts, as make.mjs does
import { loadFilm } from '../../scripts/v2/pipeline.mjs';
import { NARRATION_LEAD, buildTimeline, narrationStart } from '../../engine/script/timing.mjs';
import { anchorSeconds } from '../../engine/script/anchors.mjs';
import { registries } from '../../engine/registry.mjs';
import { validateSidecar } from '../../scripts/v2/voice/sidecar.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.resolve(HERE, '../..');
const FIXTURES = path.join(HERE, 'fixtures/voice');
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const FPS = 30;
const PRO_TAIL = registries.modes.get('pro').tail;
const FRAME_EPSILON = 1e-6;
const frameCeil = (seconds) => Math.ceil(seconds * FPS - FRAME_EPSILON) / FPS;

const FILM = readJson(path.join(FIXTURES, 'film-three-shots.json'));
const SIDECAR = readJson(path.join(FIXTURES, 'sidecar-three-shots.json'));
const flatWords = (sidecarShot) => sidecarShot.sentences.flatMap((s) => s.words);
const measured = (words = SIDECAR.shots) => buildTimeline(FILM, { fps: FPS, words });

// --- without words: byte-identical to before ---

for (const name of ['gate-desk', 'gate-pop']) {
  test(`without words the ${name} timeline deep-equals the one frozen before measured words existed`, () => {
    const { film } = loadFilm(path.join(SKILL, 'references/examples/v2', `${name}.json`));
    const frozen = readJson(path.join(FIXTURES, `timeline-${name}.json`));
    assert.deepEqual(buildTimeline(film, { fps: film.fps }), frozen);
    assert.deepEqual(buildTimeline(film, { fps: film.fps, words: undefined }), frozen);
    assert.equal(JSON.stringify(buildTimeline(film, { fps: film.fps, words: undefined })), JSON.stringify(frozen), 'same keys in the same order');
  });
}

// --- with words ---

test('the fixture sidecar is a valid sidecar of the fixture film', () => {
  assert.doesNotThrow(() => validateSidecar(SIDECAR, FILM));
});

test('with words the timeline is measured and each word time is the sidecar time from the shot start', () => {
  const tl = measured();
  assert.equal(tl.timed, 'measured');
  SIDECAR.shots.forEach((sidecarShot, i) => {
    const expected = flatWords(sidecarShot).map((w) => ({ text: w.text, start: w.start + NARRATION_LEAD, end: w.end + NARRATION_LEAD, emphasis: w.emphasis, aside: w.aside }));
    assert.deepEqual(tl.shots[i].words, expected, `shot ${sidecarShot.id}`);
  });
});

test('word:<n>, word:<text> and sentence:<n> anchors resolve to the measured times', () => {
  const [open, , close] = measured().shots;
  const openWords = flatWords(SIDECAR.shots[0]);
  assert.equal(anchorSeconds('word:3', open), openWords[3].start);
  assert.equal(anchorSeconds('word:answer', open), openWords.find((w) => w.text === 'answer').start);
  assert.equal(anchorSeconds('sentence:1', open), SIDECAR.shots[0].sentences[1].start);
  assert.equal(anchorSeconds('word:files', close), flatWords(SIDECAR.shots[2]).find((w) => w.text === 'files,').start);
  const estimated = buildTimeline(FILM, { fps: FPS }).shots[0];
  assert.notEqual(anchorSeconds('word:3', estimated), anchorSeconds('word:3', open), 'the fixture times differ from the estimate');
});

test('a narrated shot lasts its last measured word end plus the trailing pause and the tail, rounded up to a frame', () => {
  const tl = measured();
  const lastEnd = (i) => flatWords(SIDECAR.shots[i]).at(-1).end;
  assert.equal(tl.shots[0].duration, frameCeil(lastEnd(0) + PRO_TAIL));
  assert.equal(tl.shots[1].duration, FILM.shots[1].hold, 'a shot without say keeps its hold');
  assert.equal(tl.shots[2].duration, frameCeil(lastEnd(2) + PRO_TAIL));
  assert.equal(tl.shots[1].start, tl.shots[0].end);
  assert.equal(tl.frameCount, Math.round(tl.duration * FPS));
});

test('a trailing pause in the say is added after the last measured word, before the tail', () => {
  const film = { mode: 'pro', shots: [{ id: 'a', say: 'Two words. (1.0)' }] };
  const words = [{ id: 'a', wav: 'shot-0.wav', seconds: 0.9, sentences: [{ start: 0.1, end: 0.8, words: [
    { text: 'Two', start: 0.1, end: 0.4, emphasis: false, aside: false },
    { text: 'words.', start: 0.4, end: 0.8, emphasis: false, aside: false },
  ] }] }];
  assert.equal(buildTimeline(film, { fps: FPS, words }).shots[0].duration, frameCeil(0.8 + 1.0 + PRO_TAIL));
});

test('a shot is never shorter than its WAV, so its narration cannot run into the next shot', () => {
  const longWav = SIDECAR.shots.map((s, i) => (i === 0 ? { ...s, seconds: flatWords(s).at(-1).end + 2 } : s));
  const shot = measured(longWav).shots[0];
  assert.ok(shot.duration >= NARRATION_LEAD + longWav[0].seconds, `${shot.duration} covers ${longWav[0].seconds}`);
});

test('measured sentences carry start, end and the indexes of their first and last words', () => {
  const open = measured().shots[0];
  assert.deepEqual(open.sentences, SIDECAR.shots[0].sentences.map((s, k, all) => {
    const first = all.slice(0, k).reduce((n, x) => n + x.words.length, 0);
    return { start: s.start, end: s.end, first, last: first + s.words.length - 1 };
  }));
});

test('narrationStart is the film second a shot narration starts at: the shot start, estimated or measured', () => {
  assert.equal(NARRATION_LEAD, 0);
  for (const tl of [measured(), buildTimeline(FILM, { fps: FPS })]) {
    for (const shot of tl.shots) assert.equal(narrationStart(shot), shot.start + NARRATION_LEAD);
  }
});

test('words that do not match the film are an error, never a quiet fall back to the estimate', () => {
  assert.throws(() => measured(SIDECAR.shots.slice(0, 2)), /words: 2 shots, the film has 3/);
  const renamed = SIDECAR.shots.map((s, i) => (i === 2 ? { ...s, id: 'other' } : s));
  assert.throws(() => measured(renamed), /words\[2\]: shot "other", the film's shot is "close"/);
  const short = SIDECAR.shots.map((s, i) => (i === 0 ? { ...s, sentences: s.sentences.slice(0, 1) } : s));
  assert.throws(() => measured(short), /words\[0\]: 5 words, the say of shot "open" has 9/);
  assert.throws(() => buildTimeline(FILM, { fps: FPS, words: 'voice.json' }), TypeError);
});

test('buildTimeline does not change the words it is given', () => {
  const words = structuredClone(SIDECAR.shots);
  measured(words);
  assert.deepEqual(words, SIDECAR.shots);
});

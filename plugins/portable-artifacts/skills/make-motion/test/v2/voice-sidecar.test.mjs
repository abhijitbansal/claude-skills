// The voice sidecar: its shape (version 1), read and write, and the check against the film's narration.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  SIDECAR_VERSION, readSidecar, roundTime, sentencesOf, validateSidecar, writeSidecar,
} from '../../scripts/v2/voice/sidecar.mjs';

const scratch = () => mkdtempSync(path.join(os.tmpdir(), 'voice-sidecar-'));

const FILM = Object.freeze({
  mode: 'pro',
  shots: [
    { id: 'open', say: 'Every frame *counts*. Then it moves.' },
    { id: 'hold', hold: 1.5 },
    { id: 'close', say: 'Done, _quietly_.' },
  ],
});

const word = (text, start, end, extra = {}) => ({ text, start, end, emphasis: false, aside: false, ...extra });

function goodSidecar() {
  return {
    version: 1,
    model: { id: 'onnx-community/Kokoro-82M-v1.0-ONNX-timestamped', commit: 'dd4401a9add81ac692d20e240d22ec9dda82cc29', file: 'onnx/model_quantized.onnx', sha256: 'c0c02b3299fd97c34ea92a98e6d41eaa1a739c8f77bf685aac34bd7b34c1132c' },
    voice: 'af_heart',
    sampleRate: 24000,
    shots: [
      {
        id: 'open',
        wav: 'shot-0.wav',
        seconds: 2.5,
        sentences: [
          { start: 0, end: 0.9, words: [word('Every', 0, 0.3), word('frame', 0.3, 0.6), word('counts.', 0.6, 0.9, { emphasis: true })] },
          { start: 1.2, end: 2.4, words: [word('Then', 1.2, 1.5), word('it', 1.5, 1.7), word('moves.', 1.7, 2.4)] },
        ],
      },
      { id: 'hold', wav: null, seconds: 0, sentences: [] },
      {
        id: 'close',
        wav: 'shot-2.wav',
        seconds: 1.2,
        sentences: [{ start: 0, end: 1.1, words: [word('Done,', 0, 0.4), word('quietly.', 0.5, 1.1, { aside: true })] }],
      },
    ],
  };
}

test('SIDECAR_VERSION is 1', () => {
  assert.equal(SIDECAR_VERSION, 1);
});

test('a written sidecar reads back deep-equal and leaves no temporary file', () => {
  const dir = scratch();
  try {
    const file = path.join(dir, 'voice.json');
    writeSidecar(file, goodSidecar());
    assert.deepEqual(readSidecar(file), goodSidecar());
    assert.deepEqual(readdirSync(dir), ['voice.json']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readSidecar names the file when it is not JSON', () => {
  const dir = scratch();
  try {
    const file = path.join(dir, 'voice.json');
    writeFileSync(file, '{ not json');
    assert.throws(() => readSidecar(file), (err) => err.message.includes(file));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('validateSidecar accepts a sidecar that matches the film and returns it', () => {
  const data = goodSidecar();
  assert.equal(validateSidecar(data, FILM), data);
});

const rejects = (mutate, pathPrefix) => {
  const data = goodSidecar();
  mutate(data);
  assert.throws(() => validateSidecar(data, FILM), (err) => {
    assert.ok(err.message.startsWith(`${pathPrefix}: `), `expected "${pathPrefix}: ...", got "${err.message}"`);
    return true;
  });
};

test('validateSidecar rejects another version at version', () => {
  rejects((d) => { d.version = 2; }, 'version');
});

test('validateSidecar rejects another sample rate at sampleRate', () => {
  rejects((d) => { d.sampleRate = 22050; }, 'sampleRate');
});

test('validateSidecar rejects a different number of shots at shots', () => {
  rejects((d) => { d.shots.pop(); }, 'shots');
});

test('validateSidecar rejects a shot id that differs from the film at shots[i].id', () => {
  rejects((d) => { d.shots[2].id = 'end'; }, 'shots[2].id');
});

test('validateSidecar rejects a narrated shot without a wav, and a silent shot with one', () => {
  rejects((d) => { d.shots[0].wav = null; }, 'shots[0].wav');
  rejects((d) => { d.shots[1].wav = 'shot-1.wav'; }, 'shots[1].wav');
});

test('validateSidecar requires wav to be exactly shot-<index>.wav, so a sidecar can never name a file elsewhere', () => {
  rejects((d) => { d.shots[0].wav = '../../x.wav'; }, 'shots[0].wav');
  rejects((d) => { d.shots[2].wav = 'shot-0.wav'; }, 'shots[2].wav');
  rejects((d) => { d.shots[0].wav = 'shot-0.WAV'; }, 'shots[0].wav');
});

test('validateSidecar accepts a narrated shot with nothing speakable (wav null, 0 s, zero-length words)', () => {
  const film = { mode: 'pro', shots: [{ id: 'dash', say: '-' }] };
  const data = { ...goodSidecar(), shots: [{ id: 'dash', wav: null, seconds: 0, sentences: [{ start: 0, end: 0, words: [word('-', 0, 0)] }] }] };
  assert.equal(validateSidecar(data, film), data);
});

test('validateSidecar rejects a sentence without a words array at its path, not with a TypeError', () => {
  rejects((d) => { d.shots[0].sentences[1] = { start: 1.2, end: 2.4 }; }, 'shots[0].sentences[1].words');
});

test('validateSidecar rejects a word count that differs from the say at shots[i].sentences', () => {
  rejects((d) => { d.shots[0].sentences[1].words.pop(); }, 'shots[0].sentences');
  rejects((d) => { d.shots[1].sentences = [{ start: 0, end: 1, words: [word('extra', 0, 1)] }]; }, 'shots[1].sentences');
});

test('validateSidecar rejects a word text that differs from the say at its full path', () => {
  rejects((d) => { d.shots[0].sentences[1].words[2].text = 'moved.'; }, 'shots[0].sentences[1].words[2].text');
});

test('validateSidecar rejects a word that ends before it starts, or outside its wav', () => {
  rejects((d) => { d.shots[2].sentences[0].words[0].end = -1; }, 'shots[2].sentences[0].words[0].end');
  rejects((d) => { d.shots[2].sentences[0].words[1].end = 5; }, 'shots[2].sentences[0].words[1].end');
});

test('validateSidecar accepts a zero-length word and words that share a start (merged or clamped)', () => {
  const data = goodSidecar();
  const words = data.shots[2].sentences[0].words;
  words[0].end = words[0].start;
  words[1].start = words[0].start;
  assert.equal(validateSidecar(data, FILM), data);
});

test('roundTime rounds seconds to 1e-4', () => {
  assert.equal(roundTime(0.123456), 0.1235);
  assert.equal(roundTime(1 / 3), 0.3333);
  assert.equal(roundTime(2), 2);
});

test('sentencesOf groups words at sentence ends, a trailing run without one counting too', () => {
  const tokens = [
    { text: 'One.', sentenceEnd: true }, { text: 'Two', sentenceEnd: false }, { text: 'three', sentenceEnd: false },
  ];
  const words = [word('One.', 0, 0.4), word('Two', 0.6, 0.8), word('three', 0.8, 1.2)];
  assert.deepEqual(sentencesOf(tokens, words), [
    { start: 0, end: 0.4, words: [words[0]] },
    { start: 0.6, end: 1.2, words: [words[1], words[2]] },
  ]);
  assert.deepEqual(sentencesOf([], []), []);
});

test('writeSidecar writes JSON a person can read, ending in a newline', () => {
  const dir = scratch();
  try {
    const file = path.join(dir, 'voice.json');
    writeSidecar(file, goodSidecar());
    const text = readFileSync(file, 'utf8');
    assert.ok(text.endsWith('\n'));
    assert.ok(text.includes('\n  "version": 1'));
    assert.ok(existsSync(file));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

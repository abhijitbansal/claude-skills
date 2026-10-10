import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateSpec, withDefaults } from '../scripts/lib/spec.mjs';
import { resolveAudio } from '../template/audio.mjs';
import { writeWav } from './helpers/wav.mjs';

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'audio-'));
  writeWav(path.join(dir, 'music.wav'), { seconds: 0.5 });
  writeWav(path.join(dir, 'voice.wav'), { seconds: 0.2 });
  writeFileSync(path.join(dir, 'notes.txt'), 'not audio');
  return dir;
}
const base = (audio) => ({
  audio,
  scenes: [
    { id: 'intro', duration: 2, elements: [] },
    { id: 'body', duration: 3, elements: [] },
  ],
});
const errs = (spec, dir) => validateSpec(spec, { dir }).errors.map((e) => `${e.path}: ${e.message}`);

test('a spec with valid audio tracks is valid', () => {
  const dir = fixture();
  const spec = base([
    { src: 'music.wav', volume: 0.6, fadeOut: 1 },
    { src: 'voice.wav', scene: 'body', at: 0.5, fadeIn: 0.1, duration: 2 },
  ]);
  assert.deepEqual(errs(spec, dir), []);
});

test('a spec without audio is still valid and gets an empty audio default', () => {
  const spec = base(undefined);
  delete spec.audio;
  assert.deepEqual(errs(spec, process.cwd()), []);
  assert.deepEqual(withDefaults(spec).audio, []);
});

test('track defaults: at 0, volume 1, no fades', () => {
  const d = withDefaults(base([{ src: 'music.wav' }]));
  assert.deepEqual(d.audio[0], { src: 'music.wav', at: 0, volume: 1, fadeIn: 0, fadeOut: 0 });
});

test('unknown track property gets did-you-mean', () => {
  const dir = fixture();
  assert.deepEqual(errs(base([{ src: 'music.wav', volum: 1 }]), dir), ['audio[0].volum: unknown property; did you mean "volume"?']);
});

test('src is required and must be relative', () => {
  const dir = fixture();
  assert.deepEqual(errs(base([{ at: 1 }]), dir), ['audio[0].src: required']);
  assert.deepEqual(errs(base([{ src: '/etc/passwd' }]), dir), ['audio[0].src: must be a path relative to the spec file']);
});

test('src must exist inside the spec folder', () => {
  const dir = fixture();
  assert.deepEqual(errs(base([{ src: 'missing.wav' }]), dir), ['audio[0].src: file not found: missing.wav']);
  assert.deepEqual(errs(base([{ src: '../music.wav' }]), dir), ['audio[0].src: must stay inside the spec folder']);
});

test('src must have an audio extension', () => {
  const dir = fixture();
  assert.deepEqual(errs(base([{ src: 'notes.txt' }]), dir), ['audio[0].src: unsupported audio format ".txt"; use mp3, wav, m4a, aac, ogg or flac']);
});

test('scene must name an existing scene', () => {
  const dir = fixture();
  assert.deepEqual(errs(base([{ src: 'voice.wav', scene: 'outro' }]), dir), ['audio[0].scene: scene "outro" not found; scenes: intro, body']);
});

test('a track must start before the video ends', () => {
  const dir = fixture();
  assert.deepEqual(errs(base([{ src: 'voice.wav', at: 5 }]), dir), ['audio[0].at: starts at 5s, but the video ends at 5s']);
  assert.deepEqual(errs(base([{ src: 'voice.wav', scene: 'body', at: 3 }]), dir), ['audio[0].at: starts at 5s (scene "body" + 3s), but the video ends at 5s']);
});

test('volume, fades and duration are range-checked', () => {
  const dir = fixture();
  const e = errs(base([{ src: 'voice.wav', volume: 2, fadeIn: -1, duration: 0 }]), dir);
  assert.ok(e.some((x) => x.startsWith('audio[0].volume:')), e.join('\n'));
  assert.ok(e.some((x) => x.startsWith('audio[0].fadeIn:')), e.join('\n'));
  assert.ok(e.some((x) => x.startsWith('audio[0].duration:')), e.join('\n'));
});

test('at most 20 tracks', () => {
  const dir = fixture();
  const e = errs(base(Array.from({ length: 21 }, () => ({ src: 'music.wav' }))), dir);
  assert.ok(e.some((x) => x.startsWith('audio:')), e.join('\n'));
});

test('resolveAudio turns scene-relative starts into absolute seconds and anchors fades', () => {
  const spec = withDefaults(base([
    { src: 'music.wav', fadeOut: 1 },
    { src: 'voice.wav', scene: 'body', at: 0.5, duration: 2, fadeIn: 0.1, fadeOut: 0.25 },
  ]));
  assert.deepEqual(resolveAudio(spec), [
    { src: 'music.wav', start: 0, end: 5, volume: 1, fadeIn: 0, fadeOut: 1 },
    { src: 'voice.wav', start: 2.5, end: 4.5, volume: 1, fadeIn: 0.1, fadeOut: 0.25 },
  ]);
});

test('resolveAudio clamps a trimmed track to the video end', () => {
  const spec = withDefaults(base([{ src: 'voice.wav', scene: 'body', at: 2, duration: 10 }]));
  assert.equal(resolveAudio(spec)[0].end, 5);
});

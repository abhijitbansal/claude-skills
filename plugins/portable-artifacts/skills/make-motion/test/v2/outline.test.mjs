// --outline needs only Node: a voiced film's outline uses the word-count estimate (design 6.1) and says so, never the
// voice package or ffprobe; a film with music.snap and a beats file shows its cuts after the snap. No browser.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HERE } from './helpers/session.mjs';
import { writeBeatsFile } from '../../scripts/v2/sound/beats-file.mjs';
import { writeClicks } from './helpers/clicks.mjs';

const MAKE = path.resolve(HERE, '../../../scripts/make.mjs');
// No ffmpeg, no ffprobe, no browser and no voice package.
const BARE = { PATH: '', FFMPEG_PATH: '/nonexistent/ffmpeg', FFPROBE_PATH: '/nonexistent/ffprobe', PLAYWRIGHT_BROWSERS_PATH: '/nonexistent', MAKE_MOTION_VOICE_RUNTIME: '/nonexistent/voice', MAKE_MOTION_VOICE_MODEL: '/nonexistent/model' };
const make = (args) => spawnSync(process.execPath, [MAKE, ...args], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, ...BARE } });
const BAR = { type: 'path', id: 'bar', props: { d: 'M300 500H1620V580H300Z', fill: '#15130f' } };
const free = (id, hold, cut) => ({ id, show: 'free', hold, background: '#f3eee3', ...(cut ? { cut } : {}), nodes: [BAR] });
const SHOTS = [
  { id: 'hook', show: 'statement', say: 'Every row has a source.' },
  { id: 'rows', show: 'number', say: 'Four hundred rows.', value: 400, label: 'rows' },
];

let dir;
before(() => { dir = mkdtempSync(path.join(tmpdir(), 'mm-outline-')); });
after(() => rmSync(dir, { recursive: true, force: true }));
const writeFilm = (name, film) => {
  const file = path.join(dir, `${name}.json`);
  writeFileSync(file, JSON.stringify(film));
  return file;
};

test('a film with a synthesised voice: --outline makes no voice, needs nothing but Node, and says its times are estimated', () => {
  const run = make([writeFilm('voiced', { version: 2, voice: { name: 'af_heart' }, shots: SHOTS }), '--outline', '--json']);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(report.timed, 'estimated');
  assert.equal(report.voice, null);
  assert.deepEqual(report.stages.map((s) => s.name), ['validate', 'timeline']);
  assert.deepEqual(report.outline.map((s) => s.id), ['hook', 'rows']);
  assert.match(report.outlineNote, /estimated from the word count/);
});

test('the text form ends with the note', () => {
  const run = make([writeFilm('voiced-text', { version: 2, voice: { name: 'af_heart' }, shots: SHOTS }), '--outline']);
  assert.equal(run.status, 0, run.stderr);
  const lines = run.stdout.trim().split('\n');
  assert.equal(lines.length, SHOTS.length + 1);
  assert.match(lines.at(-1), /^note: .*estimated from the word count/);
});

test('a film with a recording of its own: --outline needs no ffprobe', () => {
  writeFileSync(path.join(dir, 'vo.wav'), 'not read by --outline');
  writeFileSync(path.join(dir, 'vo.json'), JSON.stringify({ segments: [] }));
  const run = make([writeFilm('recorded', { version: 2, voice: { src: 'vo.wav', words: 'vo.json' }, shots: SHOTS }), '--outline', '--json']);
  const report = JSON.parse(run.stdout);
  assert.ok(!/ffprobe/.test(JSON.stringify(report)), JSON.stringify(report));
  assert.notEqual(run.status, 2, 'never machine trouble: no ffprobe is needed');
});

test('a silent film keeps its plain outline: no note', () => {
  const run = make([writeFilm('silent', { version: 2, shots: [free('a', 2), free('b', 2, 'cut')] }), '--outline', '--json']);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).outlineNote, undefined);
});

test('music.snap with a beats file: the outline shows the cuts where the snap moves them', () => {
  writeClicks(path.join(dir, 'm.wav'), { bpm: 120, seconds: 1 });
  writeBeatsFile(path.join(dir, 'm.beats.json'), { source: 'm.wav', bpm: 120, confidence: 1, beats: Array.from({ length: 21 }, (_, k) => k / 2) });
  const shots = [free('a', 1.9), free('b', 2.3, 'cut'), free('c', 2.1, 'cut'), free('d', 1.7, 'cut')];
  const run = make([writeFilm('snap', { version: 2, fps: 30, music: { src: 'm.wav', beats: 'm.beats.json', snap: true }, shots }), '--outline', '--json']);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.deepEqual(JSON.parse(run.stdout).outline.map((s) => s.start), [0, 2, 4, 6.5]);
});

test('music.snap with no beats file: the outline says its cuts are shown before the snap', () => {
  writeClicks(path.join(dir, 'n.wav'), { bpm: 120, seconds: 1 });
  const run = make([writeFilm('snap-detect', { version: 2, fps: 30, music: { src: 'n.wav', snap: true }, shots: [free('a', 1.9), free('b', 2.3, 'cut')] }), '--outline', '--json']);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const report = JSON.parse(run.stdout);
  assert.deepEqual(report.outline.map((s) => s.start), [0, 1.9]);
  assert.match(report.outlineNote, /before music\.snap/);
});

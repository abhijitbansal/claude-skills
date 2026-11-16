// scripts/beats.mjs, rewritten for version 2 over scripts/lib/beats.mjs and scripts/v2/sound/beats-file.mjs: what it
// prints, writes and refuses, and the beats file reader a film's music.beats goes through. Tests that run ffmpeg skip
// without it (PA_REQUIRE_BROWSER=1 makes that a failure).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HERE, ffmpegOrNull } from './helpers/session.mjs';
import { writeClicks, writeNoise } from './helpers/clicks.mjs';
import { BeatsFileError, MAX_BEATS, MAX_BEATS_FILE_BYTES, isBeatsFile, readBeatsFile, writeBeatsFile } from '../../scripts/v2/sound/beats-file.mjs';

const BEATS = path.resolve(HERE, '../../../scripts/beats.mjs');
const run = (...args) => spawnSync(process.execPath, [BEATS, ...args], { encoding: 'utf8', timeout: 60_000 });

let dir;
before(() => { dir = mkdtempSync(path.join(tmpdir(), 'mm-beats-cli-')); });
after(() => rmSync(dir, { recursive: true, force: true }));

const folder = (name) => {
  const at = path.join(dir, name);
  mkdirSync(at, { recursive: true });
  return at;
};

async function needsFfmpeg(t) {
  if (await ffmpegOrNull()) return true;
  if (process.env.PA_REQUIRE_BROWSER === '1') throw new Error('ffmpeg is required');
  t.skip('no ffmpeg');
  return false;
}

// ---- the command ----

test('a 120 BPM click track: prints the path, then "<bpm> BPM, <n> beats", and writes a beats file beside it', async (t) => {
  if (!await needsFfmpeg(t)) return;
  const at = folder('clicks');
  writeClicks(path.join(at, 'song.wav'), { bpm: 120, seconds: 8 });
  const r = run(path.join(at, 'song.wav'));
  assert.equal(r.status, 0, r.stderr);
  const [printed, summary] = r.stdout.trim().split('\n');
  assert.equal(printed, path.join(at, 'song.beats.json'));
  assert.match(summary, /^\d+(\.\d+)? BPM, \d+ beats$/);
  const read = readBeatsFile('song.beats.json', at);
  assert.ok(Math.abs(read.bpm - 120) <= 1, `bpm ${read.bpm}`);
  assert.equal(summary, `${read.bpm} BPM, ${read.beats.length} beats`);
  assert.equal(JSON.parse(readFileSync(path.join(at, 'song.beats.json'), 'utf8')).source, 'song.wav');
});

test('--bpm forces the grid at that tempo', async (t) => {
  if (!await needsFfmpeg(t)) return;
  const at = folder('forced');
  writeClicks(path.join(at, 'song.wav'), { bpm: 120, seconds: 8 });
  const r = run(path.join(at, 'song.wav'), '--bpm', '120', '--out', path.join(at, 'grid.json'));
  assert.equal(r.status, 0, r.stderr);
  const { beats, bpm } = readBeatsFile('grid.json', at);
  assert.equal(bpm, 120);
  assert.ok(beats.every((b, i) => i === 0 || Math.abs(b - beats[i - 1] - 0.5) <= 0.002), 'one beat every half second (times are kept to the millisecond)');
});

test('noise has no steady beat: exit 1 with the message, and nothing written', async (t) => {
  if (!await needsFfmpeg(t)) return;
  const at = folder('noise');
  writeNoise(path.join(at, 'noise.wav'), { seconds: 8 });
  const r = run(path.join(at, 'noise.wav'));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /^no steady beat found in noise\.wav \(confidence \d\.\d\d; needs 0\.5\)\n$/);
  assert.equal(existsSync(path.join(at, 'noise.beats.json')), false);
});

test('an unknown flag is exit 2 with the accepted ones', () => {
  const r = run('song.wav', '--outt', 'x.json');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown option --outt; did you mean --out\? \(accepted: --out, --min-confidence, --bpm, --min-bpm, --max-bpm\)/);
});

test('the audio itself given as --out is refused, by name and through a link', async (t) => {
  if (!await needsFfmpeg(t)) return;
  const at = folder('clash');
  const wav = path.join(at, 'song.wav');
  writeClicks(wav, { bpm: 120, seconds: 2 });
  const before = readFileSync(wav);
  const named = run(wav, '--out', wav);
  assert.equal(named.status, 2);
  assert.match(named.stderr, /--out: song\.wav is a file this command reads \(the audio\)/);
  symlinkSync(wav, path.join(at, 'link.json'));
  const linked = run(wav, '--out', path.join(at, 'link.json'));
  assert.equal(linked.status, 2);
  assert.deepEqual(readFileSync(wav), before, 'the audio is unchanged');
});

test('the command imports nothing version 1 deletes', () => {
  const source = readFileSync(BEATS, 'utf8');
  for (const gone of ['lib/paths.mjs', 'lib/beats-file.mjs', 'lib/beat-refs.mjs', 'template/']) assert.ok(!source.includes(gone), `imports ${gone}`);
});

// ---- the beats file ----

const writeJson = (at, name, value) => writeFileSync(path.join(at, name), typeof value === 'string' ? value : JSON.stringify(value));

test('writeBeatsFile then readBeatsFile gives the grid back; isBeatsFile knows it', () => {
  const at = folder('roundtrip');
  writeBeatsFile(path.join(at, 'm.beats.json'), { source: 'm.wav', bpm: 120.004, confidence: 0.912, beats: [0.5, 1, 1.5] });
  assert.deepEqual(readBeatsFile('m.beats.json', at), { bpm: 120, beats: [0.5, 1, 1.5], confidence: 0.91 });
  assert.equal(isBeatsFile(path.join(at, 'm.beats.json')), true);
  writeJson(at, 'film.json', { version: 2, shots: [] });
  assert.equal(isBeatsFile(path.join(at, 'film.json')), false);
});

test('readBeatsFile refuses a file outside the folder, a non-JSON name, and every malformed shape, naming the file', () => {
  const at = folder('refused');
  const inner = folder('refused/film');
  writeJson(at, 'outside.json', { beats: [1] });
  writeJson(inner, 'notes.txt', { beats: [1] });
  writeJson(inner, 'broken.json', '{ not json');
  writeJson(inner, 'unsorted.json', { beats: [1, 0.5] });
  writeJson(inner, 'strings.json', { beats: ['1', '2'] });
  writeJson(inner, 'negative.json', { beats: [-1, 1] });
  writeJson(inner, 'empty.json', { beats: [] });
  writeJson(inner, 'one.json', { beats: [1] });
  writeJson(inner, 'many.json', { beats: Array.from({ length: MAX_BEATS + 1 }, (_, i) => i) });
  writeJson(inner, 'bpm.json', { bpm: 'fast', beats: [1, 2] });
  writeJson(inner, 'big.json', `{"beats":[1],"pad":"${'x'.repeat(MAX_BEATS_FILE_BYTES)}"}`);
  const cases = ['../outside.json', 'notes.txt', 'broken.json', 'unsorted.json', 'strings.json', 'negative.json', 'empty.json', 'one.json', 'many.json', 'bpm.json', 'big.json', 'missing.json'];
  for (const name of cases) {
    assert.throws(() => readBeatsFile(name, inner), (err) => err instanceof BeatsFileError && err.message.includes(JSON.stringify(name)), name);
  }
});

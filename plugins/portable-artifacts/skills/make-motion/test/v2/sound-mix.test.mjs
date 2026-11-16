// One mix (scripts/v2/voice/master.mjs with scripts/v2/sound/duck.mjs): the voice shaped as before, a music bed at
// BED_UNDER_VOICE_LU under the target (its loudness measured), ducked under every word, cues at their own gains, summed, then the one static gain and the same level
// judgement. Tests that need ffmpeg (or a browser) skip without them (PA_REQUIRE_BROWSER=1 makes that a failure).
// Run with --test-concurrency=1.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ffmpegOrNull, sessionOrNull } from './helpers/session.mjs';
import { registries } from '../../engine/registry.mjs';
import { duckEnvelope, DUCK_DEPTH_DB, DUCK_ATTACK, DUCK_RELEASE } from '../../scripts/v2/sound/duck.mjs';
import { BED_UNDER_VOICE_LU, NO_VOICE_NOTE, VOICE_RATE, encodeMaster, masterMix, mixArgs, masterTrack, measureFile, judgeLevel, muxArgs, muxVoice, recordingInput } from '../../scripts/v2/voice/master.mjs';
import { renderBed } from '../../scripts/v2/sound/bed.mjs';
import { mulberry32 } from '../../engine/seeded.mjs';
import { parseLoudness } from '../../scripts/lib/ffmpeg.mjs';
import { writeWav as writeStereoWav } from '../../scripts/v2/sound/wav.mjs';
import { renderCues } from '../../scripts/v2/sound/synth.mjs';
import { planCues } from '../../scripts/v2/sound/cues.mjs';
import { renderFilm } from '../../scripts/v2/render.mjs';

const RATE = 48000;
const FPS = 30;
const PRO = registries.modes.get('pro');
const VIRAL = registries.modes.get('viral');
const EPS = 1e-6;

let dir;
before(() => { dir = mkdtempSync(path.join(tmpdir(), 'mm-v2-sound-mix-')); });
after(() => rmSync(dir, { recursive: true, force: true }));

// ---- duckEnvelope: breakpoints in film time ----

const near = (a, b) => Math.abs(a - b) < EPS;
const assertPoints = (got, want) => {
  assert.equal(got.length, want.length, JSON.stringify(got));
  got.forEach((p, i) => assert.ok(near(p.t, want[i][0]) && near(p.gainDb, want[i][1]), `point ${i}: ${JSON.stringify(p)} vs ${want[i]}`));
};

test('the duck constants: -9 dB, 60 ms attack, 300 ms release; the bed sits 18 LU under the target', () => {
  assert.deepEqual([DUCK_DEPTH_DB, DUCK_ATTACK, DUCK_RELEASE, BED_UNDER_VOICE_LU], [-9, 0.06, 0.3, 18]);
});

test('two words 0.1 s apart make one dip: down over the attack before the first, up over the release after the last', () => {
  const points = duckEnvelope([{ start: 1, end: 1.4 }, { start: 1.5, end: 1.9 }], { seconds: 4 });
  assertPoints(points, [[0, 0], [0.94, 0], [1, -9], [1.9, -9], [2.2, 0], [4, 0]]);
  assert.ok(Object.isFrozen(points) && points.every(Object.isFrozen));
});

test('words further apart than the release make two dips; the envelope returns to 0 between them', () => {
  const points = duckEnvelope([{ start: 1, end: 1.4 }, { start: 3, end: 3.4 }], { seconds: 5 });
  assertPoints(points, [[0, 0], [0.94, 0], [1, -9], [1.4, -9], [1.7, 0], [2.94, 0], [3, -9], [3.4, -9], [3.7, 0], [5, 0]]);
});

test('when a release and the next attack overlap, the deeper of the two holds: they meet where they cross, never deeper than the depth', () => {
  // gap 0.32 s: the release runs 1.4 to 1.7, the next attack 1.66 to 1.72
  const points = duckEnvelope([{ start: 1, end: 1.4 }, { start: 1.72, end: 2 }], { seconds: 3 });
  const cross = points.find((p) => p.t > 1.6 && p.t < 1.72);
  assert.ok(cross && cross.gainDb < 0 && cross.gainDb > -9, JSON.stringify(points));
  assert.ok(points.every((p) => p.gainDb >= -9 - EPS && p.gainDb <= 0), 'never deeper than the depth');
});

test('the envelope stays inside the film: a word at 0 starts ducked, one at the end ends ducked', () => {
  const points = duckEnvelope([{ start: 0, end: 0.5 }, { start: 2.8, end: 3 }], { seconds: 3 });
  assert.ok(near(points[0].t, 0) && near(points[0].gainDb, -9), JSON.stringify(points[0]));
  assert.ok(near(points.at(-1).t, 3) && near(points.at(-1).gainDb, -9), JSON.stringify(points.at(-1)));
});

test('no words: no duck; bad input is an error', () => {
  assert.deepEqual(duckEnvelope([], { seconds: 3 }), []);
  assert.throws(() => duckEnvelope([{ start: 1, end: 2 }], { seconds: 0 }), /duckEnvelope: seconds must be a positive number/);
  assert.throws(() => duckEnvelope([{ start: 2, end: 1 }], { seconds: 3 }), /duckEnvelope: wordSpans\[0\] must be \{ start, end \} with start <= end/);
  assert.throws(() => duckEnvelope([{ start: 1, end: 2 }], { seconds: 3, depthDb: 3 }), /duckEnvelope: depthDb must be a number at or below 0/);
});

// ---- mixArgs: numbers and paths only ----

test('mixArgs: a music file of the user\'s own is opened through recordingInput; a bed WAV and the cues as plain files', () => {
  const args = mixArgs({ cues: { file: '/w/cues.wav' }, music: { file: '/film/track.mp3', recording: true, fadeFrom: 7, duck: [], lufs: -20 }, duration: 8, loudness: PRO.loudness });
  const joined = args.join(' ');
  assert.ok(joined.includes(recordingInput('/film/track.mp3').join(' ')), joined);
  assert.ok(args.includes('/w/cues.wav'));
  const graph = args[args.indexOf('-filter_complex') + 1];
  assert.match(graph, /\[1:a\]asetpts=PTS-STARTPTS,aresample/, 'the music is timed from its first sample, not its stream timestamps (review Minor 3)');
  assert.match(graph, /afade=t=out:st=7\.0000:d=1\.0000/);
  assert.match(graph, /volume=-14\.00dB/, 'from -20 LUFS to 18 LU under the -16 target');
  const measuring = mixArgs({ music: { file: '/w/bed.wav', recording: false, fadeFrom: null, duck: [] }, duration: 8, loudness: PRO.loudness });
  assert.match(measuring[measuring.indexOf('-filter_complex') + 1], /volume=0\.00dB/, 'without lufs: its own level, to be measured');
  assert.match(graph, /amix=inputs=2:normalize=0/);
});

test('mixArgs: the duck is volume expressions of t in film time (one for a short duck), its numbers formatted; NaN anywhere is refused', () => {
  const duck = duckEnvelope([{ start: 1, end: 1.4 }], { seconds: 4 });
  const graph = (args) => args[args.indexOf('-filter_complex') + 1];
  const args = mixArgs({ music: { file: '/w/bed.wav', recording: false, fadeFrom: null, duck }, duration: 4, loudness: PRO.loudness });
  assert.match(graph(args), /asetnsamples=n=48:p=0,volume='pow\(10,\(.*gte\(t,0\.9400\).*\)\/20\)':eval=frame/);
  assert.doesNotMatch(graph(args), /amix/, 'one input: no amix');
  assert.throws(() => mixArgs({ music: { file: '/w/bed.wav', recording: false, fadeFrom: null, duck: [{ t: 0, gainDb: 0 }, { t: NaN, gainDb: -9 }] }, duration: 4, loudness: PRO.loudness }), RangeError);
});

// ---- the real mix: tones in, PCM out ----

// A mono 16-bit WAV at `rate` (the voice shot WAVs are Kokoro's 24 kHz).
function writeMono(file, samples, rate) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(s * 32767))), i * 2));
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([head, data]));
}

// The first channel of a 16-bit PCM WAV, read by its chunks.
function readLeft(file) {
  const buf = readFileSync(file);
  let at = 12;
  let channels = 1;
  while (at < buf.length) {
    const id = buf.toString('ascii', at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === 'fmt ') channels = buf.readUInt16LE(at + 10);
    if (id === 'data') return Float32Array.from({ length: Math.floor(size / (2 * channels)) }, (_, i) => buf.readInt16LE(at + 8 + i * 2 * channels) / 32767);
    at += 8 + size + (size % 2);
  }
  throw new Error(`${file}: no data chunk`);
}

// The amplitude of the `hz` component of `xs` (at `rate`) between `from` and `to` seconds (Goertzel).
function toneLevel(xs, hz, from, to, rate = RATE) {
  const a = Math.round(from * rate);
  const n = Math.round(to * rate) - a;
  const w = (2 * Math.PI * hz) / rate;
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    const s = xs[a + i] + 2 * Math.cos(w) * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  return (2 * Math.sqrt(s1 * s1 + s2 * s2 - 2 * Math.cos(w) * s1 * s2)) / n;
}
const db = (ratio) => 20 * Math.log10(ratio);

const SECONDS = 6;
const SENTENCES = [{ start: 1, end: 2 }, { start: 3.5, end: 4.5 }];
const VOICE_HZ = 1000;
const BED_HZ = 100;

// A one-shot film of SECONDS whose voice is a VOICE_HZ tone at `amplitude` through SENTENCES (10 ms edges), and a
// BED_HZ tone bed at 0.5 for the whole film.
function toneFilm(name, amplitude) {
  const folder = path.join(dir, name);
  mkdirSync(folder, { recursive: true });
  const edge = (t, s) => Math.min(1, (t - s.start) / 0.01, (s.end - t) / 0.01);
  const voice = Array.from({ length: SECONDS * VOICE_RATE }, (_, i) => {
    const t = i / VOICE_RATE;
    const s = SENTENCES.find((x) => t >= x.start && t < x.end);
    return s ? amplitude * edge(t, s) * Math.sin(2 * Math.PI * VOICE_HZ * t) : 0;
  });
  writeMono(path.join(folder, 'shot-0.wav'), voice, VOICE_RATE);
  const words = SENTENCES.map((s, k) => ({ text: `w${k}`, start: s.start, end: s.end, emphasis: false, aside: false }));
  const sidecar = { shots: [{ id: 'a', wav: 'shot-0.wav', seconds: SECONDS, sentences: [{ words }] }] };
  const timeline = { fps: FPS, duration: SECONDS, frameCount: SECONDS * FPS, shots: [{ id: 'a', index: 0, start: 0, end: SECONDS, duration: SECONDS, words, sentences: [] }] };
  return { folder, voice: { dir: folder, sidecar }, timeline };
}

async function toneBed(file) {
  const tone = Float32Array.from({ length: SECONDS * RATE }, (_, i) => 0.5 * Math.sin((2 * Math.PI * BED_HZ * i) / RATE));
  await writeStereoWav(file, tone, tone);
}

const realRun = (ffmpeg) => async (args) => {
  const r = spawnSync(ffmpeg, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status, stderr: r.stderr ?? '' };
};

async function mixedTones(ffmpeg, name, amplitude) {
  const film = toneFilm(name, amplitude);
  const bed = path.join(film.folder, 'bed.wav');
  await toneBed(bed);
  const duck = duckEnvelope(SENTENCES, { seconds: SECONDS });
  const master = await masterTrack({ run: realRun(ffmpeg), voice: film.voice, timeline: film.timeline, loudness: PRO.loudness, workDir: film.folder,
    music: { file: bed, recording: false, fadeFrom: null, duck } });
  return readLeft(master);
}

test('in the real mix the bed under a word is 9 dB (within 1 dB) below the bed between sentences', async (t) => {
  const ffmpeg = await ffmpegOrNull();
  if (!ffmpeg) { t.skip('no ffmpeg'); return; }
  const xs = await mixedTones(ffmpeg, 'duck', 0.3);
  const under = toneLevel(xs, BED_HZ, 1.3, 1.7);
  const between = toneLevel(xs, BED_HZ, 2.6, 3.0);
  const dip = db(under / between);
  assert.ok(Math.abs(dip - DUCK_DEPTH_DB) <= 1, `the bed dips ${dip.toFixed(2)} dB under a word`);
});

test('the bed and cues are set relative to the voice: a quiet voice and a loud one give the same bed-to-voice ratio (within 1 dB)', async (t) => {
  const ffmpeg = await ffmpegOrNull();
  if (!ffmpeg) { t.skip('no ffmpeg'); return; }
  const ratio = async (name, amplitude) => {
    const xs = await mixedTones(ffmpeg, name, amplitude);
    return db(toneLevel(xs, BED_HZ, 2.6, 3.0) / toneLevel(xs, VOICE_HZ, 1.3, 1.7));
  };
  const quiet = await ratio('quiet', 0.03);
  const loud = await ratio('loud', 0.5);
  assert.ok(Math.abs(quiet - loud) <= 1, `bed-to-voice ${quiet.toFixed(2)} dB with a quiet voice, ${loud.toFixed(2)} dB with a loud one`);
});

test('with no voice the cues alone are mastered to the mode\'s target and pass the level judgement', async (t) => {
  const ffmpeg = await ffmpegOrNull();
  if (!ffmpeg) { t.skip('no ffmpeg'); return; }
  const folder = path.join(dir, 'cues-only');
  mkdirSync(folder, { recursive: true });
  const cues = path.join(folder, 'cues.wav');
  await renderCues([{ t: 0.5, cue: 'pop', gainDb: -12, pan: 0 }, { t: 2, cue: 'whoosh', gainDb: -12, pan: 0 }, { t: 4, cue: 'click', gainDb: -12, pan: 0 }], { seconds: 6, seed: 1, out: cues });
  const timeline = { fps: FPS, duration: 6, frameCount: 180, shots: [] };
  const run = realRun(ffmpeg);
  const master = await masterTrack({ run, timeline, loudness: VIRAL.loudness, workDir: folder, cues: { file: cues } });
  const level = judgeLevel(await measureFile({ run, file: master }), VIRAL.loudness, 'the cues');
  assert.ok(Math.abs(level.lufs - VIRAL.loudness.lufs) <= 1, `${level.lufs} LUFS`);
});

test('a level short of the target is refused, except for a film without a voice, which is said in the note; over the target or the ceiling is always refused', () => {
  const short = { lufs: VIRAL.loudness.lufs - 4, truePeakDb: -1.5, note: null };
  assert.throws(() => judgeLevel(short, VIRAL.loudness), /more than 1 LU under/);
  assert.deepEqual(judgeLevel(short, VIRAL.loudness, 'the cues', { noVoice: true }), { ...short, note: NO_VOICE_NOTE });
  assert.throws(() => judgeLevel({ ...short, lufs: VIRAL.loudness.lufs + 2 }, VIRAL.loudness, 'the cues', { noVoice: true }), /more than 1 LU over/);
  assert.throws(() => judgeLevel({ ...short, truePeakDb: 0 }, VIRAL.loudness, 'the cues', { noVoice: true }), /over the mode's ceiling/);
  const onTarget = { lufs: VIRAL.loudness.lufs, truePeakDb: -2, note: null };
  assert.deepEqual(judgeLevel(onTarget, VIRAL.loudness, 'the cues', { noVoice: true }), onTarget, 'no note when the cues reach the target');
});

test('a duck of a hundred dips runs through ffmpeg (the expression is not too long to parse)', async (t) => {
  const ffmpeg = await ffmpegOrNull();
  if (!ffmpeg) { t.skip('no ffmpeg'); return; }
  const seconds = 120;
  const spans = Array.from({ length: 100 }, (_, k) => ({ start: 1 + k * 1.15, end: 1.5 + k * 1.15 }));
  const duck = duckEnvelope(spans, { seconds });
  assert.ok(duck.length >= 400, `${duck.length} breakpoints`);
  const bed = path.join(dir, 'long-bed.wav');
  const tone = new Float32Array(seconds * RATE).fill(0.1);
  await writeStereoWav(bed, tone, tone);
  const args = mixArgs({ music: { file: bed, recording: false, fadeFrom: null, duck }, duration: seconds, loudness: PRO.loudness });
  const r = spawnSync(ffmpeg, args, { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr.slice(-400));
});

// ---- final review I3: the AAC the film ships is the AAC that was judged ----

// The reviewer's noise-even voice (probe-c): full-band noise at 48 kHz in 0.33 s words every 0.45 s, as a hissy
// recording of the author's own might be, with the word spans it ducks the bed under.
function noiseVoice(file, seconds) {
  const rng = mulberry32(5);
  const xs = Float32Array.from({ length: seconds * RATE }, (_, i) => {
    const t = i / RATE;
    const n = rng() * 2 - 1;
    return t - Math.floor(t / 0.45) * 0.45 < 0.33 ? 0.2 * n : 0;
  });
  writeMono(file, xs, RATE);
  return Array.from({ length: Math.ceil(seconds / 0.45) }, (_, w) => ({ start: w * 0.45, end: Math.min(seconds, w * 0.45 + 0.33) }));
}

const blackVideo = (ffmpeg, file, seconds) => spawnSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=black:s=64x64:r=${FPS}:d=${seconds}`,
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file], { encoding: 'utf8' });

for (const [name, mode] of [['viral', VIRAL], ['pro', PRO]]) {
  test(`I3 (${name}): a noise voice over the tape bed is encoded to AAC before capture, raised by what AAC took, judged at 1 LU, and that same stream is muxed`, async (t) => {
    const ffmpeg = await ffmpegOrNull();
    if (!ffmpeg) { t.skip('no ffmpeg'); return; }
    const folder = path.join(dir, `aac-${name}`);
    mkdirSync(folder, { recursive: true });
    const seconds = 12;
    const run = realRun(ffmpeg);
    const spans = noiseVoice(path.join(folder, 'voice.wav'), seconds);
    const tape = await renderBed({ bed: 'tape', grid: { bpm: 100, offset: 0 }, seconds, seed: 3, out: path.join(folder, 'tape.wav') });
    const master = path.join(folder, 'master.wav');
    await masterMix({ run, out: master, loudness: mode.loudness, duration: seconds, voice: { wav: path.join(folder, 'voice.wav'), filter: '' },
      music: { file: tape, recording: false, fadeFrom: null, duck: duckEnvelope(spans, { seconds }) } });
    const encoded = await encodeMaster({ run, master, out: path.join(folder, 'master.m4a'), duration: seconds, loudness: mode.loudness });
    assert.ok(encoded.gainDb > 0.5, `AAC took ${encoded.gainDb} dB, given back before capture`);
    judgeLevel(encoded.level, mode.loudness, 'the encoded sound'); // the finished file's rule: within 1 LU, under the ceiling
    assert.equal(blackVideo(ffmpeg, path.join(folder, 'video.mp4'), seconds).status, 0);
    const shipped = await muxVoice({ run, video: path.join(folder, 'video.mp4'), audio: encoded.file, out: path.join(folder, 'film.mp4'), duration: seconds });
    assert.deepEqual([shipped.lufs, shipped.truePeakDb], [encoded.level.lufs, encoded.level.truePeakDb], 'what was judged is what ships');
    assert.deepEqual(muxArgs({ video: 'v.mp4', audio: 'a.m4a', out: 'o.mp4', duration: seconds }).filter((a, k, all) => all[k - 1] === '-c:a'), ['copy'], 'the mux copies the audio');
  });
}

// ---- final review I4: the bed's level is a loudness against the target, not a gain on its samples ----

// The integrated loudness of `file` between `from` and `to` seconds.
function windowLufs(ffmpeg, file, from, to) {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-af', `atrim=${from}:${to},ebur128=peak=true`, '-f', 'null', '-'], { encoding: 'utf8' });
  return parseLoudness(r.stderr).lufs;
}

test('I4: pulse, drift and tape sit within 1 LU of each other under the same voice, about BED_UNDER_VOICE_LU under the target', async (t) => {
  const ffmpeg = await ffmpegOrNull();
  if (!ffmpeg) { t.skip('no ffmpeg'); return; }
  assert.equal(BED_UNDER_VOICE_LU, 18);
  const seconds = 12;
  const levels = {};
  for (const bed of ['pulse', 'drift', 'tape']) {
    const film = toneFilm(`bed-${bed}`, 0.3);
    const timeline = { ...film.timeline, duration: seconds, frameCount: seconds * FPS };
    const file = await renderBed({ bed, grid: { bpm: 100, offset: 0 }, seconds, seed: 3, out: path.join(film.folder, 'bed.wav') });
    const master = await masterTrack({ run: realRun(ffmpeg), voice: film.voice, timeline, loudness: PRO.loudness, workDir: film.folder,
      music: { file, recording: false, fadeFrom: null, duck: duckEnvelope(SENTENCES, { seconds }) } });
    levels[bed] = windowLufs(ffmpeg, master, 5, 10.5); // after the last word's release, before the bed's fade
  }
  const spread = Math.max(...Object.values(levels)) - Math.min(...Object.values(levels));
  t.diagnostic(`beds in the mix: ${JSON.stringify(levels)} LUFS`);
  assert.ok(spread <= 1, `beds at ${JSON.stringify(levels)} LUFS: ${spread.toFixed(1)} LU apart`);
  for (const [bed, lufs] of Object.entries(levels)) {
    assert.ok(Math.abs(lufs - (PRO.loudness.lufs - BED_UNDER_VOICE_LU)) <= 2, `${bed} at ${lufs} LUFS, the target less 18 is ${PRO.loudness.lufs - BED_UNDER_VOICE_LU}`);
  }
});

// ---- the finished film: browser render, cues muxed, video untouched ----

const ffprobeJson = (file, entries) => JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-show_entries', entries, '-of', 'json', file], { encoding: 'utf8' }).stdout);
const audioStreams = (file) => (ffprobeJson(file, 'stream=codec_type').streams ?? []).filter((s) => s.codec_type === 'audio').length;
const videoHash = (ffmpeg, file) => spawnSync(ffmpeg, ['-v', 'error', '-i', file, '-map', '0:v:0', '-c', 'copy', '-f', 'md5', '-'], { encoding: 'utf8' }).stdout.trim();
function decodedAudio(ffmpeg, file) {
  const r = spawnSync(ffmpeg, ['-v', 'error', '-i', file, '-map', '0:a:0', '-ac', '1', '-ar', String(RATE), '-f', 'f32le', 'pipe:1'], { maxBuffer: 256 * 1024 * 1024 });
  return new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length / 4);
}

const VIRAL_FILM = { version: 2, mode: 'viral', look: 'pop', format: '9:16', fps: FPS, seed: 4, shots: [
  { id: 'one', show: 'statement', say: 'Every chart is a question.' },
  { id: 'two', show: 'statement', cut: 'cut', say: 'Then the *answer* arrives.' },
] };

test('a film with cues and no voice renders with one audio stream, the first cue heard within one frame of its plan; with nothing, no audio stream and the same video bytes', async (t) => {
  const ffmpeg = await ffmpegOrNull();
  if (!ffmpeg) { t.skip('no ffmpeg'); return; }
  const session = await sessionOrNull(VIRAL_FILM);
  if (!session) { t.skip('no browser'); return; }
  try {
    const plan = planCues(VIRAL_FILM, session.timeline);
    assert.ok(plan.length >= 2, JSON.stringify(plan));
    const cues = path.join(dir, 'film-cues.wav');
    await renderCues(plan, { seconds: session.timeline.duration, seed: VIRAL_FILM.seed, out: cues });
    const withCues = path.join(dir, 'with-cues.mp4');
    const rendered = await renderFilm({ session, out: withCues, exact: true, sound: { cues: { file: cues, count: plan.length }, music: null } });
    assert.equal(audioStreams(withCues), 1);
    assert.equal(rendered.audio.cues, plan.length);
    assert.equal(rendered.audio.music, null);
    // Sparse cues alone peak at the ceiling before they reach the target: raised that far, never crushed, and said so.
    assert.ok(rendered.audio.lufs <= VIRAL.loudness.lufs + 1, `${rendered.audio.lufs} LUFS`);
    assert.ok(rendered.audio.truePeakDb <= VIRAL.loudness.truePeakDb, `${rendered.audio.truePeakDb} dBTP`);
    if (rendered.audio.lufs < VIRAL.loudness.lufs - 1) assert.equal(rendered.audio.note, NO_VOICE_NOTE);
    const xs = decodedAudio(ffmpeg, withCues);
    const planned = plan[0].t;
    let onset = Math.max(0, Math.round((planned - 2 / FPS) * RATE));
    while (onset < xs.length && Math.abs(xs[onset]) < 0.01) onset++;
    assert.ok(Math.abs(onset / RATE - planned) <= 1 / FPS, `first cue heard at ${(onset / RATE).toFixed(4)} s, planned at ${planned} s`);
    const silent = path.join(dir, 'silent.mp4');
    const plain = await renderFilm({ session, out: silent, exact: true });
    assert.equal(plain.audio, null);
    assert.equal(audioStreams(silent), 0);
    assert.equal(videoHash(ffmpeg, withCues), videoHash(ffmpeg, silent), 'the mux leaves the video stream as it was');
  } finally {
    await session.close();
  }
});

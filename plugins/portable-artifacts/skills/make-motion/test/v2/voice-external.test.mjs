// A film narrated by the author's own recording: `voice: { src, words }`. One file for the whole film, its word times
// from a Whisper word-timestamp JSON (fromWhisper) or a version 1 sidecar; the timeline follows the file (each word's
// time in the film is its time in the file); the file is mixed at film time 0 through the same master and mux. No model,
// no network; the tests that run ffmpeg skip without it. Run with --test-concurrency=1.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HERE, browserAvailable, ffmpegOrNull } from './helpers/session.mjs';
import { registries } from '../../engine/registry.mjs';
import '../../scripts/v2/list.mjs'; // registers the looks, kinds, devices and cuts, as make.mjs does
import { PlacementError, RECORDING_LEAD, buildTimeline } from '../../engine/script/timing.mjs';
import { RecordingWordsError, fromWhisper, sentencesOf } from '../../scripts/v2/voice/sidecar.mjs';
import { parseSay } from '../../engine/script/say.mjs';
import { validateFilm } from '../../scripts/v2/spec.mjs';
import { runMake } from '../../scripts/v2/run.mjs';
import { TRACK_RATE, masterTrack, muxVoice } from '../../scripts/v2/voice/master.mjs';

const FIXTURES = path.join(HERE, '..', 'fixtures', 'voice');
const readJson = (name) => JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8'));
const FILM = readJson('film-recording.json');
const WHISPER = readJson('whisper-recording.json');
const FPS = 30;
const FRAME = 1 / FPS;
const PRO = registries.modes.get('pro');
const wordsOf = (shot) => shot.sentences.flatMap((s) => s.words);
const spans = (shot) => wordsOf(shot).map((w) => [w.text, w.start, w.end]);
// The fixture's words as one list for `edit` to change (index k is the k-th word of the recording), in one segment.
const withWords = (edit) => {
  const json = structuredClone(WHISPER);
  const words = json.segments.flatMap((s) => s.words);
  edit(words);
  return { ...json, segments: [{ id: 0, words }] };
};

let dir;
before(() => { dir = mkdtempSync(path.join(tmpdir(), 'mm-v2-voice-external-')); });
after(() => rmSync(dir, { recursive: true, force: true }));

// ---- fromWhisper: the recording's words onto the film's say tokens ----

test('fromWhisper maps each say token to its word in the recording, tolerant of case, punctuation and split or joined numbers', () => {
  const sidecar = fromWhisper(WHISPER, FILM);
  assert.deepEqual([sidecar.version, sidecar.model, sidecar.voice], [1, null, null]);
  assert.deepEqual(sidecar.shots.map((s) => [s.id, s.wav]), [['open', null], ['breath', null], ['close', null], ['cost', null]]);
  assert.deepEqual(spans(sidecar.shots[0]), [
    ['Every', 0.42, 0.7], ['chart', 0.74, 1.05], ['is', 1.1, 1.25], ['a', 1.28, 1.33], ['question.', 1.36, 1.9],
    ['Then,', 2.3, 2.55], ['the', 2.62, 2.7], ['answer', 2.74, 3.1], ['arrives.', 3.14, 3.7],
  ]);
  assert.deepEqual(wordsOf(sidecar.shots[1]), [], 'a shot without say has no words');
  assert.deepEqual(spans(sidecar.shots[2]), [
    ['In', 6, 6.12], ['2024', 6.16, 6.9], ['we', 6.95, 7.05], ['shipped', 7.08, 7.4],
    ['12,500', 7.45, 8.1], // " 12" and ",500": one token, the run's span
    ['files', 8.15, 8.55], ['—', 8.55, 8.55], // a spaced dash has no word: a zero-length span where the last word ended
    ['quietly', 8.8, 9.3], ['—', 9.3, 9.3], ['on', 9.45, 9.55], ['time.', 9.58, 10],
  ]);
  assert.deepEqual(spans(sidecar.shots[3]), [
    ['It', 10.6, 10.7], ['costs', 10.74, 11.1], ['$5', 11.15, 11.9], ['million.', 11.15, 11.9], // " $5 million.": two tokens, one word
  ]);
  assert.deepEqual(sidecar.shots.map((s) => s.seconds), [3.7, 0, 10, 11.9], 'seconds: the last word end in the file');
});

test('the film\'s say decides emphasis, asides and the sentences, not the recording', () => {
  const [open] = fromWhisper(WHISPER, FILM).shots;
  assert.deepEqual(wordsOf(open).map((w) => w.emphasis), [false, false, true, false, false, false, false, false, false]);
  const { tokens } = parseSay(FILM.shots[0].say);
  assert.deepEqual(open.sentences, sentencesOf(tokens, wordsOf(open)));
  assert.equal(open.sentences.length, 2);
});

test('a misheard word keeps its place: one word for one token, at the recording\'s time', () => {
  const misheard = withWords((words) => { words[7].word = ' Ansa'; });
  assert.deepEqual(spans(fromWhisper(misheard, FILM).shots[0])[7], ['answer', 2.74, 3.1]);
});

const mismatch = (json, pattern) => assert.throws(() => fromWhisper(json, FILM), (err) => {
  assert.ok(err instanceof RecordingWordsError, err.stack);
  assert.equal(err.path, 'voice.words');
  assert.match(err.message, pattern);
  return true;
});

test('an extra word in the recording is an invalid film at voice.words, naming the shot and both counts, never a silent shift', () => {
  const extra = withWords((words) => { words.splice(13, 0, { word: ' um', start: 7.41, end: 7.44 }); });
  mismatch(extra, /^shot "close": its say has 9 words and the words file has 11 for it/);
});

test('a word missing from the recording is an invalid film at voice.words, naming the shot and both counts', () => {
  const missing = withWords((words) => { words.splice(15, 1); }); // " files,"
  mismatch(missing, /^shot "close": its say has 9 words and the words file has 9 for it/);
});

test('words left over after the last narrated shot are an error at that shot', () => {
  const extra = withWords((words) => { words.push({ word: ' Thanks.', start: 12.4, end: 12.9 }); });
  mismatch(extra, /^shot "cost": its say has 4 words and the words file has 4 for it/);
});

test('a words file without word times, or with a time that is not a number, says what is wrong', () => {
  mismatch({ segments: [{ text: 'Every chart' }] }, /word times/);
  mismatch({ text: 'Every chart' }, /segments/);
  mismatch(withWords((words) => { words[3].start = 'soon'; }), /segments\[0\]\.words\[3\]\.start/);
  mismatch(withWords((words) => { words[3].end = 1.0; }), /segments\[0\]\.words\[3\]\.end/);
  mismatch(withWords((words) => { words[5].start = 0.1; words[5].end = 0.2; }), /out of order/);
});

test('only Whisper\'s word-timestamp JSON is accepted: one of our own sidecars is refused, naming the accepted shape', () => {
  const own = fromWhisper(WHISPER, FILM);
  mismatch(own, /the JSON Whisper writes with word timestamps: \{ "segments": \[\{ "words": \[\{ "word", "start", "end" \}\] \}\] \}/);
});

// ---- the timeline follows the recording ----

const recorded = (film = FILM, json = WHISPER) => buildTimeline(film, { fps: FPS, words: fromWhisper(json, film).shots, recording: true });
const fileWords = (film = FILM, json = WHISPER) => fromWhisper(json, film).shots.map(wordsOf);

test('every word is heard in its own shot at its time in the recording, and shown then too, but for each shot\'s first word', () => {
  const tl = recorded();
  assert.equal(tl.timed, 'measured');
  const file = fileWords();
  tl.shots.forEach((shot, i) => {
    assert.equal(shot.words.length, file[i].length);
    file[i].forEach((heard, k) => {
      assert.ok(heard.start >= shot.start - FRAME && heard.end <= shot.end + FRAME, `${shot.id} word ${k} is heard inside its shot`);
      const shown = shot.start + shot.words[k].start;
      if (k > 0) assert.ok(Math.abs(shown - heard.start) < 1e-9, `${shot.id} word ${k} is shown when it is heard`);
      // The film's first shot starts at 0 whenever its first word is heard; any later one at most a lead before it.
      else assert.ok(shown === shot.start && (i === 0 || heard.start - shown <= RECORDING_LEAD + FRAME), `${shot.id}: the first word is shown from the shot's first frame, heard within the lead`);
    });
  });
});

test('shots are whole frames back to back: a narrated shot starts RECORDING_LEAD before its first word, a say-less one just before the next', () => {
  assert.equal(RECORDING_LEAD, 0.15);
  const tl = recorded();
  const frames = tl.shots.map((s) => [Math.round(s.start * FPS), Math.round(s.end * FPS)]);
  assert.deepEqual(frames, [
    [0, 130], // the first shot starts the film; it runs until the held shot
    [130, 175], // "breath" holds its 1.5 s just before "close"
    [175, 313], // floor((6.0 - 0.15) * 30)
    [313, 375], // floor((10.6 - 0.15) * 30), to the last word end plus the tail, ceil((11.9 + 0.6) * 30)
  ]);
  assert.equal(tl.frameCount, 375);
  assert.equal(tl.shots[3].end, tl.duration);
});

test('the lead never reaches back before the last word of the shot before', () => {
  const tight = withWords((words) => { // "It" 0.05 s after "time." ends: the lead is clamped to that end, 10.0 s
    words[19].start = 10.05; words[19].end = 10.1;
  });
  const tl = recorded(FILM, tight);
  assert.equal(Math.round(tl.shots[3].start * FPS), Math.ceil(10 * FPS));
});

const placement = (film, json, pattern, at) => assert.throws(() => recorded(film, json), (err) => {
  assert.ok(err instanceof PlacementError, err.stack);
  assert.deepEqual(err.errors.map((e) => e.path), [at]);
  assert.match(err.errors[0].message, pattern);
  return true;
});

const withShot = (index, edit) => ({ ...FILM, shots: FILM.shots.map((s, i) => (i === index ? { ...s, ...edit } : s)) });

test('a say-less shot that does not fit in the recording\'s pause is an error at that shot, not a shifted word', () => {
  placement(withShot(1, { hold: 3 }), WHISPER, /"breath" needs 3 s, but the recording leaves 2\.\d+ s between the last word of "open" \(3\.7 s\) and the start of "close"/, 'shots[1]');
});

test('say-less shots before the first word need room before it in the recording', () => {
  const film = { ...FILM, shots: [{ id: 'intro', show: 'statement', hold: 2 }, ...FILM.shots] };
  placement(film, WHISPER, /"intro" needs 2 s, but the recording's first word is at 0\.42 s/, 'shots[0]');
});

test('a cut longer than the shot it opens is an error at that cut', () => {
  // "now" runs from floor((0.9 - 0.15) * 30) = frame 22 to "stop" at ceil(0.95 * 30) = frame 29: 7 frames, under a slide.
  const film = { version: 2, mode: 'pro', voice: FILM.voice, shots: [
    { id: 'go', show: 'statement', say: 'Go.' },
    { id: 'now', show: 'statement', cut: 'slide', say: 'Now.' },
    { id: 'stop', show: 'statement', cut: 'cut', say: 'Stop.' },
  ] };
  const json = { segments: [{ words: [
    { word: ' Go.', start: 0.5, end: 0.7 }, { word: ' Now.', start: 0.9, end: 0.95 }, { word: ' Stop.', start: 1.1, end: 1.3 },
  ] }] };
  placement(film, json, /the "slide" cut into "now" lasts 0\.4 s, but the shot lasts 0\.23 s/, 'shots[1].cut');
});

// ---- validation: the two files, inside the film's folder ----

function specFolder(name, { words = WHISPER } = {}) {
  const folder = path.join(dir, name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, 'recording.wav'), 'RIFF');
  writeFileSync(path.join(folder, 'recording.words.json'), typeof words === 'string' ? words : JSON.stringify(words));
  return folder;
}
const errorsOf = (spec, folder) => validateFilm(spec, { specDir: folder }).errors;
const withVoice = (voice) => ({ ...FILM, voice });

test('a film with its recording and words inside its folder validates', () => {
  assert.deepEqual(errorsOf(FILM, specFolder('ok')), []);
});

test('a src or words path that leaves the film\'s folder, is absolute, or is a symlink out is refused at its own path', () => {
  const folder = specFolder('contain');
  writeFileSync(path.join(dir, 'x.wav'), 'RIFF');
  const outside = errorsOf(withVoice({ src: '../x.wav', words: 'recording.words.json' }), folder);
  assert.deepEqual(outside.map((e) => e.path), ['voice.src']);
  assert.match(outside[0].message, /outside the spec folder/);
  assert.match(errorsOf(withVoice({ src: path.join(dir, 'x.wav'), words: 'recording.words.json' }), folder)[0].message, /absolute path/);
  symlinkSync(path.join(dir, 'x.wav'), path.join(folder, 'link.wav'));
  assert.match(errorsOf(withVoice({ src: 'link.wav', words: 'recording.words.json' }), folder)[0].message, /outside the spec folder/);
  assert.deepEqual(errorsOf(withVoice({ src: 'recording.wav', words: '../w.json' }), folder).map((e) => e.path), ['voice.words']);
});

test('a missing recording or words file, or words that are not JSON, is an invalid film at voice.src or voice.words', () => {
  const folder = specFolder('missing', { words: '{ not json' });
  const missing = errorsOf(withVoice({ src: 'nope.wav', words: 'recording.words.json' }), folder);
  assert.deepEqual(missing.map((e) => e.path), ['voice.src', 'voice.words']);
  assert.match(missing[0].message, /file not found: "nope\.wav"/);
  assert.match(missing[1].message, /not valid JSON/);
  assert.match(errorsOf(withVoice({ src: 'recording.wav', words: 'gone.json' }), folder)[0].message, /file not found: "gone\.json"/);
});

test('words that cannot be matched to the say are an invalid film at voice.words', () => {
  const folder = specFolder('mismatch', { words: withWords((words) => { words.splice(15, 1); }) });
  const errors = errorsOf(FILM, folder);
  assert.deepEqual(errors.map((e) => e.path), ['voice.words']);
  assert.match(errors[0].message, /shot "close"/);
});

// ---- through make ----

const makeOutline = (folder, film = FILM) => {
  const specPath = path.join(folder, 'film.json');
  writeFileSync(specPath, JSON.stringify(film));
  return runMake({ specPath, out: path.join(folder, 'out', 'film.mp4'), exact: false, noRender: true, outline: true }, {
    synthesise: () => { throw new Error('an own recording is never synthesised'); },
  });
};

test('make on a film with its own recording synthesises nothing and reports timed: "measured", voice.model null', async () => {
  const { report, exitCode, outline } = await makeOutline(specFolder('make-ok'));
  assert.equal(exitCode, 0, JSON.stringify(report));
  assert.equal(report.timed, 'measured');
  assert.deepEqual(report.voice, { cached: false, seconds: 11.9, model: null });
  assert.deepEqual(report.stages.map((s) => [s.name, s.ok]), [['validate', true], ['voice', true], ['timeline', true]]);
  assert.equal(outline[2].start, 175 / FPS, 'the outline follows the recording');
});

test('a say-less shot that cannot be placed is an invalid film from make: exit 1 at that shot, nothing after the timeline', async () => {
  const { report, exitCode } = await makeOutline(specFolder('make-place'), withShot(1, { hold: 3 }));
  assert.equal(exitCode, 1, JSON.stringify(report));
  assert.deepEqual(report.findings.map((f) => [f.kind, f.path]), [['mechanical', 'shots[1]']]);
  assert.deepEqual(report.stages.map((s) => [s.name, s.ok]), [['validate', true], ['voice', true], ['timeline', false]]);
});

// ---- alignment: a generated recording through the real timeline, master and mux ----

const PCM_MAX = 32767;
const WAV_HEADER = 44;
function writeWav(file, samples, rate) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(Math.max(-PCM_MAX, Math.min(PCM_MAX, Math.round(s * PCM_MAX))), i * 2));
  const head = Buffer.alloc(WAV_HEADER);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([head, data]));
}
function readWav(file) {
  const buf = readFileSync(file);
  let at = 12;
  let channels = 1;
  let rate = 0;
  while (at < buf.length) {
    const id = buf.toString('ascii', at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === 'fmt ') { channels = buf.readUInt16LE(at + 10); rate = buf.readUInt32LE(at + 12); }
    if (id === 'data') {
      const count = Math.floor(size / (2 * channels));
      return { samples: Float32Array.from({ length: count }, (_, i) => buf.readInt16LE(at + 8 + i * 2 * channels) / PCM_MAX), rate };
    }
    at += 8 + size + (size % 2);
  }
  throw new Error(`${file}: no data chunk`);
}
// The seconds at which the signal rises over `threshold` after at least `quiet` seconds under it.
function onsets(samples, rate, threshold, quiet = 0.05) {
  const found = [];
  let last = -Infinity;
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) < threshold) continue;
    if (i - last > quiet * rate) found.push(i / rate);
    last = i;
  }
  return found;
}

// A film with a say-less shot between two narrated ones, and a recording of it: a voice-like tone burst over each
// word's span (clicks alone are too peaky for the limiter: voice-master.test.mjs), the words JSON matching it.
const ALIGN_FILM = { version: 2, mode: 'pro', voice: { src: 'take.wav', words: 'take.json' }, shots: [
  { id: 'one', show: 'statement', say: 'Every chart is a question.' },
  { id: 'breath', show: 'statement', cut: 'cut', hold: 1.3, text: 'A breath.' },
  { id: 'two', show: 'statement', cut: 'cut', say: 'The answer arrives on time.' },
] };
// Words 0.22 s long with at least 0.16 s of silence between them, so each onset is found on its own.
const ALIGN_WORDS = [
  [' Every', 0.31], [' chart', 0.69], [' is', 1.07], [' a', 1.45], [' question.', 1.83],
  [' The', 4.12], [' answer', 4.5], [' arrives', 4.9], [' on', 5.3], [' time.', 5.7],
].map(([word, start]) => ({ word, start, end: Math.round((start + 0.22) * 100) / 100 }));
const RECORDING_RATE = 44100; // neither Kokoro's rate nor the track's: the file is resampled once
const RECORDING_SECONDS = 6.4;

function writeRecording(file) {
  const samples = new Float32Array(Math.round(RECORDING_SECONDS * RECORDING_RATE));
  for (const w of ALIGN_WORDS) {
    for (let i = Math.round(w.start * RECORDING_RATE); i < Math.round(w.end * RECORDING_RATE); i++) {
      const t = i / RECORDING_RATE;
      samples[i] = 0.12 * Math.sin(2 * Math.PI * 180 * t) + 0.06 * Math.sin(2 * Math.PI * 360 * t) + 0.03 * Math.sin(2 * Math.PI * 1100 * t);
    }
  }
  writeWav(file, samples, RECORDING_RATE);
}

const ffmpegRun = (ffmpeg, args) => spawnSync(ffmpeg, args, { encoding: 'utf8' });
const realRun = (ffmpeg) => async (args) => {
  const r = ffmpegRun(ffmpeg, args);
  return { code: r.status, stderr: r.stderr ?? '' };
};
const ONSET_FRACTION = 0.05;

test('alignment: each word onset decoded from the finished MP4, and each word on the timeline, lies within one frame of its time in the recording', async (t) => {
  const ffmpeg = await ffmpegOrNull();
  if (!ffmpeg) { t.skip('no ffmpeg'); return; }
  const work = path.join(dir, 'align');
  mkdirSync(work, { recursive: true });
  const recording = path.join(work, 'take.wav');
  writeRecording(recording);
  const sidecar = fromWhisper({ segments: [{ words: ALIGN_WORDS }] }, ALIGN_FILM);
  const timeline = buildTimeline(ALIGN_FILM, { fps: FPS, words: sidecar.shots, recording: true });
  const fileStarts = ALIGN_WORDS.map((w) => w.start); // from the generated file itself, not from the code under test
  // Each timeline word with its shot, in film order: shown at shot start + its start; heard at its time in the file.
  const placed = timeline.shots.flatMap((shot) => shot.words.map((w, k) => ({ shot, first: k === 0, shown: shot.start + w.start })));
  placed.forEach(({ shot, first, shown }, k) => {
    const heard = fileStarts[k];
    assert.ok(heard >= shot.start - FRAME && heard <= shot.end + FRAME, `word ${k}, heard at ${heard} s, lies inside "${shot.id}" (${shot.start.toFixed(3)} to ${shot.end.toFixed(3)} s)`);
    if (!first) assert.ok(Math.abs(shown - heard) <= FRAME, `timeline word ${k} at ${shown.toFixed(4)} s, the recording has it at ${heard} s`);
    else assert.ok(shown === shot.start && (shot.index === 0 || heard - shown <= RECORDING_LEAD + FRAME), `word ${k} opens "${shot.id}": shown from its first frame, heard ${(heard - shown).toFixed(3)} s later`);
  });
  assert.ok(timeline.shots[1].duration >= 1.3 - 1e-9 && timeline.shots[1].start > ALIGN_WORDS[4].end, 'the say-less shot sits in the pause');
  const video = path.join(work, 'video.mp4');
  const made = ffmpegRun(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=gray:s=320x180:r=${FPS}:d=${timeline.duration}`, '-c:v', 'mpeg4', video]);
  assert.equal(made.status, 0, made.stderr);
  const run = realRun(ffmpeg);
  const master = await masterTrack({ run, voice: { recording, sidecar }, timeline, loudness: PRO.loudness, workDir: work });
  const out = path.join(work, 'film.mp4');
  await muxVoice({ run, video, audio: master, out, duration: timeline.duration });
  const decoded = path.join(work, 'decoded.wav');
  const r = ffmpegRun(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', out, '-map', '0:a:0', '-ac', '1', '-ar', String(TRACK_RATE), '-c:a', 'pcm_s16le', decoded]);
  assert.equal(r.status, 0, r.stderr);
  const { samples, rate } = readWav(decoded);
  const peak = samples.reduce((m, s) => Math.max(m, Math.abs(s)), 0);
  const heard = onsets(samples, rate, peak * ONSET_FRACTION);
  assert.equal(heard.length, fileStarts.length, `onsets at ${heard.map((s) => s.toFixed(3))}`);
  heard.forEach((s, k) => assert.ok(Math.abs(s - fileStarts[k]) <= FRAME, `onset ${k} at ${s.toFixed(4)} s, its word in the recording at ${fileStarts[k]} s`));
  heard.forEach((s, k) => {
    if (!placed[k].first) assert.ok(Math.abs(s - placed[k].shown) <= FRAME, `onset ${k} at ${s.toFixed(4)} s, its word shown at ${placed[k].shown.toFixed(4)} s`);
  });
  t.diagnostic(`largest onset offset: ${(Math.max(...heard.map((s, k) => Math.abs(s - fileStarts[k]))) * 1000).toFixed(2)} ms from the recording`);
});

test('make renders a film with its own recording: one audio stream at the mode\'s loudness, nothing synthesised', async (t) => {
  if (!await browserAvailable()) { t.skip('no browser'); return; }
  const ffmpeg = await ffmpegOrNull();
  if (!ffmpeg) { t.skip('no ffmpeg'); return; }
  const folder = path.join(dir, 'make-render');
  mkdirSync(folder, { recursive: true });
  writeRecording(path.join(folder, 'take.wav'));
  // One narrated shot: the say-less statement of ALIGN_FILM ("breath", text only) opens on an empty frame in any film,
  // silent ones too (a review finding older than the voice, see the task 8 report), and the alignment test above
  // already covers a say-less shot in the middle.
  writeFileSync(path.join(folder, 'take.json'), JSON.stringify({ segments: [{ words: ALIGN_WORDS.slice(0, 5) }] }));
  const specPath = path.join(folder, 'film.json');
  writeFileSync(specPath, JSON.stringify({ ...ALIGN_FILM, shots: ALIGN_FILM.shots.slice(0, 1) }));
  const out = path.join(folder, 'out', 'film.mp4');
  const { report, exitCode } = await runMake({ specPath, out, exact: false, noRender: false, outline: false }, {
    synthesise: () => { throw new Error('an own recording is never synthesised'); },
  });
  assert.equal(exitCode, 0, JSON.stringify(report.error ?? report.findings));
  assert.equal(report.timed, 'measured');
  assert.equal(report.voice.model, null);
  assert.ok(Math.abs(report.audio.lufs - PRO.loudness.lufs) <= 1, `${report.audio.lufs} LUFS`);
  const streams = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', out], { encoding: 'utf8' }).stdout).streams;
  assert.deepEqual(streams.map((s) => s.codec_type), ['video', 'audio']);
});

test('a copied recording keeps working: the words are read from the folder the film is in', () => {
  const folder = specFolder('copied');
  copyFileSync(path.join(folder, 'recording.words.json'), path.join(folder, 'again.json'));
  assert.deepEqual(errorsOf(withVoice({ src: 'recording.wav', words: 'again.json' }), folder), []);
});

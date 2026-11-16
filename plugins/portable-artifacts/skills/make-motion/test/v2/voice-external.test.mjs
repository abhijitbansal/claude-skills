// A film narrated by the author's own recording: `voice: { src, words }`. One file for the whole film, its word times
// from a Whisper word-timestamp JSON (fromWhisper, the only words file accepted); the timeline follows the file (each
// word's time in the film is its time in the file); the file is probed (plain audio only) and mixed at film time 0
// through the same master and mux, ffmpeg limited to the accepted audio demuxers. No model, no network; the tests that
// run ffmpeg or ffprobe skip without them. Run with --test-concurrency=1.
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
import { WORDS_MAX_BYTES, validateFilm } from '../../scripts/v2/spec.mjs';
import { runMake } from '../../scripts/v2/run.mjs';
import { TRACK_RATE, masterTrack, muxVoice, recordingProblem, voiceTrackArgs } from '../../scripts/v2/voice/master.mjs';
import { findFfprobe } from '../../scripts/lib/ffmpeg.mjs';

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

// ffmpeg and the ffprobe beside it, or null after skipping `t` when either is missing.
async function mediaTools(t) {
  const ffmpeg = await ffmpegOrNull();
  const ffprobe = ffmpeg ? findFfprobe({ ffmpeg }) : null;
  if (!ffmpeg || !ffprobe) { t.skip('no ffmpeg or ffprobe'); return null; }
  return { ffmpeg, ffprobe };
}

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
  const misheard = withWords((words) => { words[7].word = ' Anser'; });
  assert.deepEqual(spans(fromWhisper(misheard, FILM).shots[0])[7], ['answer', 2.74, 3.1]);
});

const mismatch = (json, pattern, film = FILM) => assert.throws(() => fromWhisper(json, film), (err) => {
  assert.ok(err instanceof RecordingWordsError, err.stack);
  assert.equal(err.path, 'voice.words');
  assert.match(err.message, pattern);
  return true;
});
// No message about unmatched words prints two counts: it lists the words.
const NO_COUNTS = /has \d+ words? and the words file has \d+/;

test('an extra word in the recording is an invalid film at voice.words, naming the shot and the word, never a silent shift', () => {
  const extra = withWords((words) => { words.splice(13, 0, { word: ' um', start: 7.41, end: 7.44 }); });
  mismatch(extra, /^shot "close": the words file has "um" \(7\.41 s\), which the say does not/);
  assert.throws(() => fromWhisper(extra, FILM), (err) => !NO_COUNTS.test(err.message));
});

test('a word missing from the recording is an invalid film at voice.words, naming the shot and the say\'s word', () => {
  const missing = withWords((words) => { words.splice(15, 1); }); // " files,"
  mismatch(missing, /^shot "close": the say has "files", which the words file does not/);
  assert.throws(() => fromWhisper(missing, FILM), (err) => !NO_COUNTS.test(err.message));
});

test('words left over after the last narrated shot are an error at that shot, naming them', () => {
  const extra = withWords((words) => { words.push({ word: ' Thanks.', start: 12.4, end: 12.9 }); });
  mismatch(extra, /^shot "cost": the words file has "Thanks\." \(12\.4 s\), which the say does not/);
});

// One narrated shot `say`, and a words file of `text` spoken a word every 0.4 s from 0.5 s.
const oneShot = (say) => ({ version: 2, mode: 'pro', voice: FILM.voice, shots: [{ id: 'only', show: 'statement', say }] });
const spoken = (text) => ({ segments: [{ words: text.split(' ').map((word, k) => ({
  word: ` ${word}`, start: Math.round((0.5 + 0.4 * k) * 100) / 100, end: Math.round((0.8 + 0.4 * k) * 100) / 100,
})) }] });

test('an extra word and a missing one in the same sentence are both named, never moved onto a neighbour\'s time (review probe A)', () => {
  const film = oneShot('Every chart is a quiet question today.');
  mismatch(spoken('Every um chart is a question today.'), /^shot "only": the words file has "um" \(0\.9 s\), which the say does not, and the say has "quiet", which the words file does not/, film);
});

test('an extra word right before a missing one is named too: two substitutions never beat one word added and one left out', () => {
  const film = oneShot('Every chart is a quiet question.');
  mismatch(spoken('Every chart is um a question.'), /the words file has "um" \(1\.7 s\), which the say does not, and the say has "quiet", which the words file does not/, film);
});

const startsOf = (json, say) => spans(fromWhisper(json, oneShot(say)).shots[0]).map(([text, start]) => [text, start]);

test('a word close to its say word (two edits, at most 40% of the longer) keeps its place, however many in a row', () => {
  assert.deepEqual(startsOf(spoken('The color of there favorite theater.'), 'The colour of their favourite theatre.'), [
    ['The', 0.5], ['colour', 0.9], ['of', 1.3], ['their', 1.7], ['favourite', 2.1], ['theatre.', 2.5],
  ]);
  assert.deepEqual(startsOf(spoken('There color flavor favorite theater.'), 'Their colour, flavour, favourite theatre.'), [
    ['Their', 0.5], ['colour,', 0.9], ['flavour,', 1.3], ['favourite', 1.7], ['theatre.', 2.1],
  ], 'five close words in a row: no cap on a run');
});

test('the same number written differently keeps its place: digits against a number word, leading zeros aside', () => {
  assert.deepEqual(startsOf(spoken('Ten steps to 7 doors.'), '10 steps to 007 doors.'), [
    ['10', 0.5], ['steps', 0.9], ['to', 1.3], ['007', 1.7], ['doors.', 2.1],
  ]);
  mismatch(spoken('Eleven steps.'), /the words file has "Eleven" \(0\.5 s\), which the say does not, and the say has "10"/, oneShot('10 steps.'));
});

test('a word that is not close to its say word is named on both sides, never timed in its place', () => {
  mismatch(spoken('Every graph was the question.'), /^shot "only": the words file has "graph" \(0\.9 s\), "was" \(1\.3 s\), "the" \(1\.7 s\), which the say does not, and the say has "chart", "is", "a", which the words file does not/, oneShot('Every chart is a question.'));
  mismatch(withWords((words) => { words[7].word = ' Ansa'; }), /^shot "open": the words file has "Ansa" \(2\.74 s\), which the say does not, and the say has "answer", which the words file does not/);
  mismatch(spoken('Every from.'), /the words file has "from\." \(0\.9 s\).*the say has "form\."/, oneShot('Every form.'));
});

test('an extra word next to a missing one is never one substitution: the neighbour keeps its own time (review I4 probes)', () => {
  mismatch(spoken('we really like like it'), /^shot "only": the words file has "like" \(1\.[37] s\), which the say does not, and the say has "really", which the words file does not/, oneShot('we really really like it'));
  mismatch(spoken('p q r'), /^shot "only": the words file has "p" \(0\.5 s\), "q" \(0\.9 s\), "r" \(1\.3 s\), which the say does not, and the say has "aa", "bb", "cc"/, oneShot('aa bb cc'));
  mismatch(spoken('p q r the s t u the v w x the'), /"p" \(0\.5 s\), "q" \(0\.9 s\), "r" \(1\.3 s\), "s" \(2\.1 s\)/, oneShot('aa bb cc the dd ee ff the gg hh ii the'));
});

// `count` distinct words, and Whisper's words for a list of texts: word k from 0.3 k s, 0.2 s long.
const manyWords = (count, word = (k) => `w${k}x`) => Array.from({ length: count }, (_, k) => word(k));
const roundTo = (index) => Math.round(index * 0.3 * 1e4) / 1e4;
const whisperOf = (texts) => ({ segments: [{ words: texts.map((w, k) => ({ word: ` ${w}`, start: roundTo(k), end: roundTo(k) + 0.2 })) }] });

test('a long film aligns: 5000 say words against 5500 file words, one misheard, 500 numbers split in two', () => {
  const says = manyWords(5000, (k) => (k % 10 === 0 ? `${k},500` : `w${k}x`));
  const file = says.flatMap((w, k) => (k % 10 === 0 ? [`${k}`, ',500'] : [k === 2501 ? 'w2501y' : w]));
  const film = oneShot(says.join(' '));
  const words = wordsOf(fromWhisper(whisperOf(file), film).shots[0]);
  assert.equal(words.length, 5000);
  assert.deepEqual([words[2501].text, words[2501].start], ['w2501x', roundTo(2501 + 251)]);
  assert.deepEqual([words[4990].text, words[4990].start], ['4990,500', roundTo(4990 + 499)], 'the last split number keeps its own time');
});

test('the worst crafted alignment (7800 tokens "aa" against 4200 words "a") is an error within seconds, not a minute', () => {
  const film = { ...FILM, shots: Array.from({ length: 60 }, (_, s) => ({ id: `s${s}`, show: 'statement', say: Array(130).fill('aa').join(' ') })) };
  const started = performance.now();
  assert.throws(() => fromWhisper(whisperOf(Array(4200).fill('a')), film), (err) => err instanceof RecordingWordsError);
  assert.ok(performance.now() - started < 5000, `${Math.round(performance.now() - started)} ms`);
});

test('a words file too large to align against the says is an invalid film at voice.words that says so', () => {
  const film = oneShot(manyWords(3000).join(' '));
  mismatch(whisperOf(manyWords(9000, (k) => `v${k}`)), /too many to align/, film);
});

test('a symbol on its own has no sound: the error says to write the spoken word', () => {
  mismatch(spoken('Salt and pepper.'), /"and" \(0\.9 s\), which the say does not.*"&" has no sound of its own/, oneShot('Salt & pepper.'));
});

test('a words file for a film with no narrated shot is an invalid film at voice.words, not ignored', () => {
  const silent = { ...FILM, shots: [{ id: 'still', show: 'statement', hold: 2, text: 'Quiet.' }] };
  mismatch(WHISPER, /no shot has a say/, silent);
});

test('word times that overlap across two shots are an invalid film at voice.words naming both shots', () => {
  const overlap = withWords((words) => { words[8].end = 6.05; }); // " arrives." (open) runs past " In" (close) at 6.0 s
  mismatch(overlap, /"close".*6 s.*"open".*6\.05 s/);
});

test('a words file without word times, or with a time that is not a number, says what is wrong', () => {
  mismatch({ segments: [{ text: 'Every chart' }] }, /word times/);
  mismatch({ text: 'Every chart' }, /segments/);
  mismatch(withWords((words) => { words[3].start = 'soon'; }), /segments\[0\]\.words\[3\]\.start/);
  mismatch(withWords((words) => { words[3].start = -0.5; }), /segments\[0\]\.words\[3\]\.start/);
  mismatch(withWords((words) => { words[3].end = 1.0; }), /segments\[0\]\.words\[3\]\.end/);
  mismatch(withWords((words) => { words[5].start = 0.1; words[5].end = 0.2; }), /segments\[0\]\.words\[5\]\.start: 0\.1 s is out of order/);
});

test('a huge non-string word is named by its type, not echoed whole into the message', () => {
  const huge = withWords((words) => { words[2].word = { text: 'x'.repeat(100000) }; });
  assert.throws(() => fromWhisper(huge, FILM), (err) => {
    assert.match(err.message, /segments\[0\]\.words\[2\]\.word: must be the word's text, got an object/);
    assert.ok(err.message.length < 300, `${err.message.length} characters`);
    return true;
  });
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

test('a shot opening on a run of tokens that share one word shows all of them from its first frame, not apart', () => {
  const film = { version: 2, mode: 'pro', voice: FILM.voice, shots: [
    { id: 'go', show: 'statement', say: 'Go.' },
    { id: 'cost', show: 'statement', cut: 'cut', say: '$5 million is a lot.' },
  ] };
  const json = { segments: [{ words: [
    { word: ' Go.', start: 0.3, end: 0.6 }, { word: ' $5 million', start: 1.5, end: 2.1 }, { word: ' is', start: 2.15, end: 2.3 },
    { word: ' a', start: 2.35, end: 2.4 }, { word: ' lot.', start: 2.45, end: 2.8 },
  ] }] };
  const cost = recorded(film, json).shots[1];
  assert.deepEqual(cost.words.slice(0, 2).map((w) => [w.text, w.start]), [['$5', 0], ['million', 0]]);
  assert.ok(cost.words[2].start > 0, 'the next word keeps its own time');
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

// A silent WAV recording, long enough for the fixture's words (the last ends at 11.9 s).
const SILENT_RATE = 8000;
const FILM_RECORDING_SECONDS = 12.5;
const writeSilence = (file, seconds = FILM_RECORDING_SECONDS) => writeWav(file, new Float32Array(Math.round(seconds * SILENT_RATE)), SILENT_RATE);

function specFolder(name, { words = WHISPER } = {}) {
  const folder = path.join(dir, name);
  mkdirSync(folder, { recursive: true });
  writeSilence(path.join(folder, 'recording.wav'));
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

test('a src that is a FIFO is refused at voice.src: not a regular file', (t) => {
  if (process.platform === 'win32') { t.skip('no FIFOs'); return; }
  const folder = specFolder('fifo-src');
  assert.equal(spawnSync('mkfifo', [path.join(folder, 'pipe.wav')]).status, 0);
  const errors = errorsOf(withVoice({ src: 'pipe.wav', words: 'recording.words.json' }), folder);
  assert.deepEqual(errors.map((e) => e.path), ['voice.src']);
  assert.match(errors[0].message, /"pipe\.wav" is not a regular file/);
});

test('a words file that is a FIFO is refused at voice.words without waiting on it', (t) => {
  if (process.platform === 'win32') { t.skip('no FIFOs'); return; }
  const folder = specFolder('fifo-words');
  assert.equal(spawnSync('mkfifo', [path.join(folder, 'pipe.json')]).status, 0);
  const errors = errorsOf(withVoice({ src: 'recording.wav', words: 'pipe.json' }), folder);
  assert.deepEqual(errors.map((e) => e.path), ['voice.words']);
  assert.match(errors[0].message, /"pipe\.json" is not a regular file/);
});

test('a words file over the 16 MB cap is refused at voice.words before it is parsed', () => {
  const folder = specFolder('words-cap');
  writeFileSync(path.join(folder, 'big.json'), Buffer.alloc(WORDS_MAX_BYTES + 1, 0x20));
  const errors = errorsOf(withVoice({ src: 'recording.wav', words: 'big.json' }), folder);
  assert.deepEqual(errors.map((e) => e.path), ['voice.words']);
  assert.match(errors[0].message, new RegExp(`a words file can be at most ${WORDS_MAX_BYTES} bytes`));
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

test('make on a film with its own recording synthesises nothing and reports timed: "measured", voice.model null', async (t) => {
  if (!await mediaTools(t)) return;
  const { report, exitCode, outline } = await makeOutline(specFolder('make-ok'));
  assert.equal(exitCode, 0, JSON.stringify(report));
  assert.equal(report.timed, 'measured');
  assert.deepEqual(report.voice, { cached: false, seconds: 11.9, model: null });
  assert.deepEqual(report.stages.map((s) => [s.name, s.ok]), [['validate', true], ['voice', true], ['timeline', true]]);
  assert.equal(outline[2].start, 175 / FPS, 'the outline follows the recording');
});

test('a say-less shot that cannot be placed is an invalid film from make: exit 1 at that shot, nothing after the timeline', async (t) => {
  if (!await mediaTools(t)) return;
  const { report, exitCode } = await makeOutline(specFolder('make-place'), withShot(1, { hold: 3 }));
  assert.equal(exitCode, 1, JSON.stringify(report));
  assert.deepEqual(report.findings.map((f) => [f.kind, f.path]), [['mechanical', 'shots[1]']]);
  assert.deepEqual(report.stages.map((s) => [s.name, s.ok]), [['validate', true], ['voice', true], ['timeline', false]]);
});

// ---- the recording itself: plain audio only, and ffmpeg may open nothing else (review probes C3 and C4) ----

// A folder for the film, with an MPEG-TS of 2 s outside it and the review's two hostile recordings inside: an HLS
// playlist naming the outside segment by its absolute path, and a file named cat.wav holding an ffconcat list whose
// entry is a symlink inside the folder that points outside.
function hostileFolder(name, ffmpeg) {
  const folder = path.join(dir, name);
  const outside = path.join(dir, `${name}-outside`);
  mkdirSync(folder, { recursive: true });
  mkdirSync(outside, { recursive: true });
  const segment = path.join(outside, 'seg.ts');
  const made = ffmpegRun(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=440:d=2', '-c:a', 'aac', '-f', 'mpegts', segment]);
  assert.equal(made.status, 0, made.stderr);
  writeFileSync(path.join(folder, 'vo.m3u8'), `#EXTM3U\n#EXT-X-TARGETDURATION:3\n#EXTINF:2.0,\n${segment}\n#EXT-X-ENDLIST\n`);
  symlinkSync(segment, path.join(folder, 'seg.ts'));
  writeFileSync(path.join(folder, 'cat.wav'), 'ffconcat version 1.0\nfile seg.ts\n');
  const words = { segments: [{ words: [{ word: ' Go.', start: 0.2, end: 0.5 }] }] };
  writeFileSync(path.join(folder, 'take.json'), JSON.stringify(words));
  return folder;
}
const goFilm = (src) => ({ version: 2, mode: 'pro', voice: { src, words: 'take.json' }, shots: [{ id: 'go', show: 'statement', say: 'Go.' }] });

test('a playlist or a concat script as the recording is an invalid film at voice.src naming its format, found before any decode', async (t) => {
  const tools = await mediaTools(t);
  if (!tools) return;
  const folder = hostileFolder('hostile-make', tools.ffmpeg);
  for (const [src, format] of [['vo.m3u8', 'hls'], ['cat.wav', 'concat']]) {
    const { report, exitCode } = await makeOutline(folder, goFilm(src));
    assert.equal(exitCode, 1, `${src}: ${JSON.stringify(report)}`);
    assert.deepEqual(report.findings.map((f) => f.path), ['voice.src'], src);
    assert.match(report.findings[0].message, new RegExp(`"${src.replace('.', '\\.')}" is in the "${format}" format, not plain audio`));
    assert.deepEqual(report.stages.map((s) => [s.name, s.ok]), [['validate', true], ['voice', false]]);
  }
});

test('with the probe bypassed, ffmpeg itself refuses to open a playlist or a concat script: the format whitelist', async (t) => {
  const tools = await mediaTools(t);
  if (!tools) return;
  const folder = hostileFolder('hostile-mix', tools.ffmpeg);
  for (const name of ['vo.m3u8', 'cat.wav']) {
    const args = voiceTrackArgs({ shots: [], timeline: { duration: 2, shots: [] }, out: path.join(folder, `${name}.track.wav`), recording: path.join(folder, name) });
    const r = ffmpegRun(tools.ffmpeg, args);
    assert.notEqual(r.status, 0, `${name}: ffmpeg decoded it`);
    assert.match(r.stderr, /Format not on whitelist/, name);
  }
});

test('recordingProblem: one audio stream (a cover picture beside it is fine) with a readable length, or it says what is wrong', () => {
  const audio = { type: 'audio', attachedPic: false };
  const probe = (edit) => ({ format: 'mp3', duration: 12, streams: [audio], ...edit });
  assert.equal(recordingProblem(probe({}), 11.9), null);
  assert.equal(recordingProblem(probe({ streams: [audio, { type: 'video', attachedPic: true }] }), 11.9), null);
  assert.equal(recordingProblem(probe({ duration: 11.86 }), 11.9), null, 'within the end tolerance');
  assert.match(recordingProblem(probe({ duration: NaN }), 11.9), /has no length ffmpeg can read/);
  assert.match(recordingProblem(probe({ streams: [audio, audio] }), 11.9), /has 2 audio streams/);
  assert.match(recordingProblem(probe({ streams: [audio, { type: 'video', attachedPic: false }] }), 11.9), /has a video stream besides its audio/);
  assert.match(recordingProblem({ format: 'dash', error: 'its format is not on the whitelist' }, 1), /is in the "dash" format, not plain audio/);
  assert.match(recordingProblem({ format: null, error: 'Invalid data found when processing input' }, 1), /cannot be read as audio \(Invalid data found/);
});

// A 12.5 s tone in `file` encoded with `codec` (null: ffmpeg's default for the extension); null when this ffmpeg lacks it.
function writeTone(ffmpeg, file, codec) {
  const r = ffmpegRun(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `sine=f=220:d=${FILM_RECORDING_SECONDS}`, ...(codec ? ['-c:a', codec] : []), file]);
  return r.status === 0 ? file : null;
}

test('a plain WAV, MP3 or FLAC recording passes the probe, and the whitelisted mix decodes it', async (t) => {
  const tools = await mediaTools(t);
  if (!tools) return;
  const folder = specFolder('formats');
  const files = [['recording.wav', path.join(folder, 'recording.wav')], ['take.mp3', writeTone(tools.ffmpeg, path.join(folder, 'take.mp3'), 'libmp3lame')],
    ['take.flac', writeTone(tools.ffmpeg, path.join(folder, 'take.flac'), null)]];
  for (const [src, file] of files) {
    if (file === null) { t.diagnostic(`${src}: this ffmpeg cannot encode it; not checked`); continue; }
    const { report, exitCode } = await makeOutline(folder, withVoice({ src, words: 'recording.words.json' }));
    assert.equal(exitCode, 0, `${src}: ${JSON.stringify(report.findings)}`);
    const r = ffmpegRun(tools.ffmpeg, voiceTrackArgs({ shots: [], timeline: { duration: 12, shots: [] }, out: path.join(folder, `${src}.track.wav`), recording: file }));
    assert.equal(r.status, 0, `${src}: ${r.stderr}`);
  }
});

test('a recording shorter than its words, or with no audio stream, is an invalid film at voice.src', async (t) => {
  const tools = await mediaTools(t);
  if (!tools) return;
  const folder = specFolder('short');
  writeSilence(path.join(folder, 'short.wav'), 5);
  const short = await makeOutline(folder, withVoice({ src: 'short.wav', words: 'recording.words.json' }));
  assert.equal(short.exitCode, 1, JSON.stringify(short.report));
  assert.deepEqual(short.report.findings.map((f) => f.path), ['voice.src']);
  assert.match(short.report.findings[0].message, /"short\.wav" lasts 5 s, but the words file's last word ends at 11\.9 s/);
  const video = path.join(folder, 'picture.mp4');
  assert.equal(ffmpegRun(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=gray:s=64x64:r=10:d=13', '-c:v', 'mpeg4', video]).status, 0);
  const silent = await makeOutline(folder, withVoice({ src: 'picture.mp4', words: 'recording.words.json' }));
  assert.equal(silent.exitCode, 1, JSON.stringify(silent.report));
  assert.deepEqual(silent.report.findings.map((f) => f.path), ['voice.src']);
  assert.match(silent.report.findings[0].message, /"picture\.mp4" has no audio stream/);
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

// A film that opens on a say-less shot (so its first narrated shot does not start at 0: a recording delayed by that
// shot's start would show), with a say-less shot between two narrated ones, and a recording of it: a voice-like tone
// burst over each word's span (clicks alone are too peaky for the limiter: voice-master.test.mjs), the words JSON
// matching it.
const ALIGN_FILM = { version: 2, mode: 'pro', voice: { src: 'take.wav', words: 'take.json' }, shots: [
  { id: 'intro', show: 'statement', hold: 1, text: 'Charts.' },
  { id: 'one', show: 'statement', cut: 'cut', say: 'Every chart is a question.' },
  { id: 'breath', show: 'statement', cut: 'cut', hold: 1.3, text: 'A breath.' },
  { id: 'two', show: 'statement', cut: 'cut', say: 'The answer arrives on time.' },
] };
// Words 0.22 s long with at least 0.16 s of silence between them, so each onset is found on its own; the first 1.31 s
// in, after the intro's 1 s and the lead.
const ALIGN_WORDS = [
  [' Every', 1.31], [' chart', 1.69], [' is', 2.07], [' a', 2.45], [' question.', 2.83],
  [' The', 5.12], [' answer', 5.5], [' arrives', 5.9], [' on', 6.3], [' time.', 6.7],
].map(([word, start]) => ({ word, start, end: Math.round((start + 0.22) * 100) / 100 }));
const RECORDING_RATE = 44100; // neither Kokoro's rate nor the track's: the file is resampled once
const RECORDING_SECONDS = 7.4;
const ONSET_TOLERANCE = 0.002; // a decoded onset may miss its word's time by 2 ms (measured: under 0.1 ms)

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

test('alignment: each word onset decoded from the finished MP4 lies within 2 ms of its time in the recording, and each word on the timeline within one frame', async (t) => {
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
  assert.ok(timeline.shots[0].duration >= 1 - 1e-9 && timeline.shots[1].start > 1, 'the film opens on the say-less shot');
  assert.ok(timeline.shots[2].duration >= 1.3 - 1e-9 && timeline.shots[2].start > ALIGN_WORDS[4].end, 'the say-less shot sits in the pause');
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
  heard.forEach((s, k) => assert.ok(Math.abs(s - fileStarts[k]) <= ONSET_TOLERANCE, `onset ${k} at ${s.toFixed(4)} s, its word in the recording at ${fileStarts[k]} s`));
  heard.forEach((s, k) => {
    if (!placed[k].first) assert.ok(Math.abs(s - placed[k].shown) <= ONSET_TOLERANCE, `onset ${k} at ${s.toFixed(4)} s, its word shown at ${placed[k].shown.toFixed(4)} s`);
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
  writeFileSync(specPath, JSON.stringify({ ...ALIGN_FILM, shots: ALIGN_FILM.shots.filter((s) => s.id === 'one').map(({ cut, ...s }) => s) }));
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

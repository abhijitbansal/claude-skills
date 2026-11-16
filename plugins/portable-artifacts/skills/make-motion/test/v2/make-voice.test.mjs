// scripts/make.mjs on a voiced film: the voice stage, through runMake with a fake synthesiser (in process, since the CLI
// cannot take one). Moved out of make.test.mjs unchanged when that file passed 800 lines. Tests that need a browser skip
// without one (PA_REQUIRE_BROWSER=1 makes that a failure). Run with --test-concurrency=1.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { HERE, browserAvailable, ffmpegOrNull } from './helpers/session.mjs';
import { findFfprobe } from '../../scripts/lib/ffmpeg.mjs';
import { registries } from '../../engine/registry.mjs';
import '../../scripts/v2/list.mjs'; // registers the looks, kinds, devices and cuts, as make.mjs does
import { timedAnchorErrors, validateFilm } from '../../scripts/v2/spec.mjs';
import { runMake } from '../../scripts/v2/run.mjs';
import { formatText } from '../../scripts/v2/report.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { parseSay } from '../../engine/script/say.mjs';
import { roundTime, sentencesOf } from '../../scripts/v2/voice/sidecar.mjs';
import { ERROR_MARKER, INSTALL_HINT, classifyError } from '../../scripts/v2/voice/worker.mjs';
import { VoiceSynthError, synthesiseFilm } from '../../scripts/v2/voice/synth.mjs';
import { VoiceTextError } from '../../scripts/v2/voice/tokens.mjs';
import { UsageError } from '../../scripts/lib/spec.mjs';

const FPS = 30;
// The report's keys on every path (make.test.mjs checks the same list through the CLI).
const REPORT_KEYS = ['audio', 'bytes', 'captured', 'capture', 'findings', 'frames', 'mbps', 'msPerFrame', 'ok', 'output', 'post', 'seconds', 'sheets', 'stages', 'timed', 'voice'];

const FILMS = {
  gate: { version: 2, mode: 'pro', shots: [
    { id: 'hook', show: 'statement', say: 'Most dashboards cannot tell you *where a number came from*.' },
    { id: 'rows', show: 'number', cut: 'slide', say: 'Four hundred fifty nine rows. One file.', value: 459, label: 'in one file' },
  ] },
};

let dir;
before(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'mm-v2-make-voice-'));
  for (const [name, film] of Object.entries(FILMS)) writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(film));
});
after(() => rmSync(dir, { recursive: true, force: true }));

const filmPath = (name) => path.join(dir, `${name}.json`);
const outPath = (name, file = 'film.mp4') => path.join(dir, `out-${name}`, file);

async function needs(t) {
  if (!await browserAvailable()) { t.skip('no browser'); return false; }
  return true;
}

// ---- a voiced film: the voice stage, through runMake with a fake synthesiser ----

const VOICED_SHOTS = [
  { id: 'hook', show: 'statement', say: 'Every row has a source.' },
  { id: 'rows', show: 'number', say: 'Four hundred rows.', value: 400, label: 'rows' },
];
const FAKE_MODEL = { id: 'fake-model', commit: 'c0ffee', file: 'model.onnx', sha256: 'abc' };
const FAKE_STEP = 0.12;
const FAKE_SPAN = 0.1;
const FAKE_PAD = 0.025;

// The sidecar a synthesiser would return for `film`: word k at k * FAKE_STEP, far quicker than the estimate.
function fakeSidecar(film) {
  const shots = film.shots.map((shot, index) => {
    if (shot.say === undefined) return { id: shot.id, wav: null, seconds: 0, sentences: [] };
    const { tokens } = parseSay(shot.say);
    const words = tokens.map((t, k) => ({ text: t.text, start: k * FAKE_STEP, end: k * FAKE_STEP + FAKE_SPAN, emphasis: t.emphasis, aside: t.aside }));
    return { id: shot.id, wav: `shot-${index}.wav`, seconds: words.at(-1).end + FAKE_PAD, sentences: sentencesOf(tokens, words) };
  });
  return { version: 1, model: FAKE_MODEL, voice: 'af_heart', sampleRate: 24000, shots };
}

function fakeSynthesiser({ fail = null, sidecarOf = fakeSidecar } = {}) {
  const calls = [];
  const synthesise = async (film, options) => {
    calls.push({ film, options });
    if (fail) throw fail;
    return { dir: path.join(options.outDir, '.voice', 'fake'), sidecar: sidecarOf(film), cached: false };
  };
  return { synthesise, calls };
}

const writeVoiced = (name, extra = {}, shots = VOICED_SHOTS) => {
  writeFileSync(filmPath(name), JSON.stringify({ version: 2, mode: 'pro', voice: { name: 'af_heart' }, shots, ...extra }));
  return filmPath(name);
};
const runVoiced = (specPath, synthesise, flags = {}, signal = undefined) => runMake(
  { specPath, out: outPath(path.basename(specPath, '.json')), exact: false, noRender: true, outline: false, ...flags },
  { synthesise, signal },
);
const stagesOf = (report) => report.stages.map((s) => [s.name, s.ok]);

test('a voiced film runs the voice stage before the timeline and its timeline is measured (no browser: --outline)', async () => {
  const fake = fakeSynthesiser();
  const specPath = writeVoiced('voiced-outline');
  const { report, exitCode, outline } = await runVoiced(specPath, fake.synthesise, { outline: true });
  assert.equal(exitCode, 0, JSON.stringify(report));
  assert.deepEqual(Object.keys(report).sort(), [...REPORT_KEYS].sort());
  assert.equal(report.timed, 'measured');
  assert.deepEqual(stagesOf(report), [['validate', true], ['voice', true], ['timeline', true]]);
  const sidecar = fakeSidecar({ shots: VOICED_SHOTS });
  assert.deepEqual(report.voice, { cached: false, seconds: roundTime(sidecar.shots.reduce((n, s) => n + s.seconds, 0)), model: FAKE_MODEL });
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].options.voice, 'af_heart');
  assert.equal(fake.calls[0].options.outDir, path.dirname(outPath('voiced-outline')), 'the voice cache sits beside the video');
  const measured = Math.ceil((sidecar.shots[0].sentences[0].words.at(-1).end + registries.modes.get('pro').tail) * FPS - 1e-6) / FPS;
  assert.equal(outline[1].start, Math.max(1, measured), 'the second shot starts where the measured first one ends');
});

test('a silent film has no voice stage and reports voice: null', async () => {
  const fake = fakeSynthesiser();
  const { report, exitCode } = await runVoiced(filmPath('gate'), fake.synthesise, { outline: true });
  assert.equal(exitCode, 0);
  assert.equal(report.voice, null);
  assert.equal(report.timed, 'estimated');
  assert.deepEqual(stagesOf(report), [['validate', true], ['timeline', true]]);
  assert.equal(fake.calls.length, 0);
});

test('make --no-render on a voiced film with a fake synthesiser reports timed: "measured"', async (t) => {
  if (!await needs(t)) return;
  const fake = fakeSynthesiser();
  const { report, exitCode } = await runVoiced(writeVoiced('voiced-review'), fake.synthesise);
  assert.equal(exitCode, 0, JSON.stringify(report.findings));
  assert.equal(report.ok, true);
  assert.equal(report.timed, 'measured');
  assert.deepEqual(report.stages.map((s) => s.name), ['validate', 'voice', 'timeline', 'review']);
  assert.equal(report.output, null);
});

// The real synthesiseFilm, its worker replaced by a fake child that fails with `classified` (worker.mjs classifyError's
// output) as its last stderr line: the error reaches run.mjs exactly as synth.mjs builds it.
function failingWorker(classified) {
  const runtime = mkdtempSync(path.join(tmpdir(), 'mm-v2-voice-rt-'));
  writeFileSync(path.join(runtime, 'package-lock.json'), '{}');
  const spawn = () => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => {} });
    setImmediate(() => {
      child.stderr.end(`${ERROR_MARKER}${JSON.stringify(classified)}\n`);
      child.stdout.end();
      setImmediate(() => child.emit('close', 1, null));
    });
    return child;
  };
  return (film, options) => synthesiseFilm(film, { ...options, runtime, spawn, ensureModel: async () => {} });
}

test('a missing voice install is exit 2, ok false, with the install hint; nothing after the voice stage runs', async () => {
  const synthesise = failingWorker(classifyError(new UsageError(INSTALL_HINT), 'runtime'));
  const { report, exitCode } = await runVoiced(writeVoiced('voiced-missing'), synthesise);
  assert.equal(exitCode, 2);
  assert.equal(report.ok, false);
  assert.equal(report.error.message, 'the optional voice package is not installed', 'the hint is not said twice');
  assert.match(report.error.hint, /^Run: .+/);
  assert.deepEqual(stagesOf(report), [['validate', true], ['voice', false]]);
  assert.equal(report.timed, null, 'no silent fall back to estimated times');
  assert.equal(report.voice, null);
  assert.equal(report.output, null);
  assert.deepEqual(report.findings, []);
  assert.equal(formatText(report, { sheetsDir: null }).split('\n')[0], 'failed', 'machine trouble: never valid, and not the film\'s fault');
});

test('a hint is dropped only when the message is exactly the hint, never because the message mentions it', async () => {
  const fail = new VoiceSynthError('the voice worker said: run again later did not help', { kind: 'machine', hint: 'run again' });
  const { report, exitCode } = await runVoiced(writeVoiced('voiced-hint-inside'), fakeSynthesiser({ fail }).synthesise);
  assert.equal(exitCode, 2);
  assert.deepEqual(report.error, { message: 'the voice worker said: run again later did not help', hint: 'run again' });
});

test('an interrupt that races a film voice error is an interruption: exit 130, not an invalid film', async () => {
  const controller = new AbortController();
  const synthesise = async () => {
    controller.abort();
    throw new VoiceSynthError('shot "hook": the narration has a character the voice cannot say', { kind: 'film', hint: 'h', shot: 'hook' });
  };
  const { report, exitCode } = await runVoiced(writeVoiced('voiced-race'), synthesise, {}, controller.signal);
  assert.equal(exitCode, 130, JSON.stringify(report));
  assert.deepEqual(report.error, { message: 'interrupted', hint: '' });
  assert.deepEqual(report.findings, []);
});

test('machine trouble keeps its own hint; a timeout is machine trouble even when marked film', async () => {
  const fail = new VoiceSynthError('the voice worker did not finish within 600 s and was killed', { kind: 'machine', hint: 'run again', timedOut: true });
  const { report, exitCode } = await runVoiced(writeVoiced('voiced-timeout'), fakeSynthesiser({ fail }).synthesise);
  assert.equal(exitCode, 2);
  assert.deepEqual(report.error, { message: 'the voice worker did not finish within 600 s and was killed', hint: 'run again' });
  const odd = new VoiceSynthError('the voice worker did not finish within 600 s and was killed', { kind: 'film', hint: 'run again', timedOut: true });
  assert.equal((await runVoiced(writeVoiced('voiced-film-timeout'), fakeSynthesiser({ fail: odd }).synthesise)).exitCode, 2);
});

test('a film voice error from the worker is an invalid film at the say of the shot it names: exit 1, text invalid', async () => {
  const classified = classifyError(new VoiceTextError('narration of 600 tokens in one clause, over the 512 the voice takes'), 'synth', 'rows');
  const { report, exitCode } = await runVoiced(writeVoiced('voiced-film-error'), failingWorker(classified));
  assert.equal(exitCode, 1, JSON.stringify(report));
  assert.equal(report.ok, false);
  assert.equal(report.error, undefined, 'the film\'s fault is a finding, not a machine error');
  assert.deepEqual(report.findings, [{ kind: 'mechanical', shot: null, path: 'shots[1].say', message: `${classified.message}; ${classified.hint}` }]);
  assert.deepEqual(stagesOf(report), [['validate', true], ['voice', false]]);
  assert.equal(report.timed, null);
  assert.equal(formatText(report, { sheetsDir: null }).split('\n')[0], 'invalid');
});

test('a film voice error naming no shot is reported at voice, whatever its message says', async () => {
  const fail = new VoiceSynthError('shot "rows": looks like a shot, but the error names none', { kind: 'film', hint: 'h' });
  const { report, exitCode } = await runVoiced(writeVoiced('voiced-film-wide'), fakeSynthesiser({ fail }).synthesise);
  assert.equal(exitCode, 1);
  assert.deepEqual(report.findings.map((f) => f.path), ['voice']);
});

// The words of VOICED_SHOTS as Whisper would write them for a recording of the whole film.
const OWN_WORDS = { segments: [{ words: [
  [' Every', 0.3], [' row', 0.6], [' has', 0.9], [' a', 1.1], [' source.', 1.3], [' Four', 2.6], [' hundred', 2.9], [' rows.', 3.3],
].map(([word, start]) => ({ word, start, end: Math.round((start + 0.25) * 100) / 100 })) }] };

// A silent 16-bit mono PCM WAV of `seconds` at 8 kHz: a recording the voice stage's probe accepts.
const SILENT_RATE = 8000;
function silentWav(seconds) {
  const data = Buffer.alloc(Math.round(seconds * SILENT_RATE) * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(SILENT_RATE, 24); head.writeUInt32LE(SILENT_RATE * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

test('a voice from your own recording ({ src, words }) is never synthesised: its words time the film; a missing words file is an invalid film', async (t) => {
  const ffmpeg = await ffmpegOrNull();
  if (!ffmpeg || !findFfprobe({ ffmpeg })) { t.skip('no ffmpeg or ffprobe: the voice stage probes the recording'); return; }
  const fake = fakeSynthesiser();
  writeFileSync(path.join(dir, 'vo.wav'), silentWav(4));
  writeFileSync(path.join(dir, 'vo.json'), JSON.stringify(OWN_WORDS));
  const own = await runVoiced(writeVoiced('voiced-own', { voice: { src: 'vo.wav', words: 'vo.json' } }), fake.synthesise, { outline: true });
  assert.equal(own.exitCode, 0, JSON.stringify(own.report));
  assert.equal(own.report.timed, 'measured');
  assert.deepEqual(own.report.voice, { cached: false, seconds: 3.55, model: null });
  assert.equal(fake.calls.length, 0, 'nothing is synthesised');
  const missing = await runVoiced(writeVoiced('voiced-own-missing', { voice: { src: 'vo.wav', words: 'gone.json' } }), fake.synthesise);
  assert.equal(missing.exitCode, 1);
  assert.deepEqual(missing.report.findings.map((f) => f.path), ['voice.words']);
  assert.deepEqual(stagesOf(missing.report), [['validate', false]]);
  writeFileSync(path.join(dir, 'vo-stub.wav'), 'RIFF'); // four bytes: a name, not a recording
  const stub = await runVoiced(writeVoiced('voiced-own-stub', { voice: { src: 'vo-stub.wav', words: 'vo.json' } }), fake.synthesise, { outline: true });
  assert.equal(stub.exitCode, 1, JSON.stringify(stub.report));
  assert.deepEqual(stub.report.findings.map((f) => f.path), ['voice.src']);
  assert.match(stub.report.findings[0].message, /"vo-stub\.wav" cannot be read as audio/);
  assert.deepEqual(stagesOf(stub.report), [['validate', true], ['voice', false]]);
});

test('a narrated statement shot after a hard cut opens on its first word, though the voice starts a little after the shot', async (t) => {
  if (!await needs(t)) return;
  const lateStart = (film) => {
    const sidecar = fakeSidecar(film);
    const shifted = (w) => ({ ...w, start: w.start + 0.075, end: w.end + 0.075 }); // the lead-in a real voice keeps
    return { ...sidecar, shots: sidecar.shots.map((s) => ({ ...s, seconds: s.seconds + 0.075, sentences: s.sentences.map((x) => ({ ...x, start: x.start + 0.075, end: x.end + 0.075, words: x.words.map(shifted) })) })) };
  };
  const shots = [
    { id: 'one', show: 'statement', say: 'Every chart is a question.' },
    { id: 'two', show: 'statement', cut: 'cut', say: 'The answer arrives on time.' },
  ];
  const { report, exitCode } = await runVoiced(writeVoiced('voiced-first-frame', {}, shots), fakeSynthesiser({ sidecarOf: lateStart }).synthesise);
  assert.deepEqual(report.findings.filter((f) => /opens on an empty frame/.test(f.message)), []);
  assert.equal(exitCode, 0, JSON.stringify(report.findings));
});

test('an anchor valid on estimated times but outside its shot on measured ones is an invalid film: exit 1, path form', async () => {
  const say = 'Every row has a source, and every source has a file.';
  const estimated = buildTimeline({ mode: 'pro', shots: [{ id: 'hook', say }] }, { fps: FPS }).shots[0].duration;
  const at = Math.round((estimated - 0.1) * 100) / 100;
  const shots = [{ id: 'hook', show: 'statement', say, on: [{ at, do: 'underline', target: 'text' }] }];
  const specPath = writeVoiced('voiced-late', {}, shots);
  const { report, exitCode } = await runVoiced(specPath, fakeSynthesiser().synthesise);
  assert.equal(exitCode, 1, JSON.stringify(report));
  assert.equal(report.ok, false);
  assert.deepEqual(report.findings.map((f) => [f.kind, f.path]), [['mechanical', 'shots[0].on[0].at']]);
  assert.match(report.findings[0].message, /outside the shot/);
  assert.deepEqual(stagesOf(report), [['validate', true], ['voice', true], ['timeline', false]]);
  assert.equal(report.output, null);
  assert.equal(report.timed, 'measured', 'the report says which timeline was built');
  assert.ok(report.frames > 0);
  assert.deepEqual(formatText(report, { sheetsDir: null }).split('\n'), ['invalid', `mechanical: shots[0].on[0].at: ${report.findings[0].message}`]);
  assert.match(report.findings[0].message, /end its say with a pause/, 'a narrated shot is lengthened through its say');
});

test('a sidecar that does not match the film is machine trouble, whoever made it: exit 2, nothing timed', async () => {
  const wrong = (film) => {
    const sidecar = fakeSidecar(film);
    sidecar.shots[0].sentences[0].words[0].text = 'Other';
    return sidecar;
  };
  const { report, exitCode } = await runVoiced(writeVoiced('voiced-mismatch'), fakeSynthesiser({ sidecarOf: wrong }).synthesise);
  assert.equal(exitCode, 2);
  assert.match(report.error.message, /^the voice does not match the film: shots\[0\]\.sentences\[0\]\.words\[0\]\.text/);
  assert.match(report.error.hint, /delete the \.voice folder/);
  assert.deepEqual(stagesOf(report), [['validate', true], ['voice', false]]);
  assert.equal(report.timed, null);
});

// ---- an interrupt during the voice stage ----

const abortError = () => Object.assign(new Error('voice synthesis was interrupted'), { name: 'AbortError' });
const MODES = [['--outline', { outline: true }], ['--no-render (and --sheets-only)', { noRender: true }], ['a full run', { noRender: false }]];

const assertInterrupted = (report, exitCode, stages) => {
  assert.equal(exitCode, 130);
  assert.equal(report.ok, false);
  assert.deepEqual(report.error, { message: 'interrupted', hint: '' });
  assert.deepEqual(stagesOf(report), stages);
  assert.deepEqual([report.timed, report.output, report.frames], [null, null, 0], 'nothing after the voice stage ran');
};

for (const [name, flags] of MODES) {
  test(`${name}: an interrupt while the voice is made reaches the synthesiser and the run ends 130`, async () => {
    const controller = new AbortController();
    let given = null;
    const synthesise = (film, options) => new Promise((resolve, reject) => {
      given = options.signal;
      options.signal.addEventListener('abort', () => reject(abortError()), { once: true });
      setImmediate(() => controller.abort());
    });
    const { report, exitCode } = await runVoiced(writeVoiced(`voiced-abort-${flags.outline ? 'o' : flags.noRender ? 'n' : 'f'}`), synthesise, flags, controller.signal);
    assert.equal(given, controller.signal, 'the run passes its own signal to the synthesiser');
    assertInterrupted(report, exitCode, [['validate', true], ['voice', false]]);
  });

  test(`${name}: an interrupt the synthesiser does not see (a cache hit) still stops the run after the voice stage`, async () => {
    const controller = new AbortController();
    const synthesise = async (film, options) => {
      controller.abort();
      return { dir: path.join(options.outDir, '.voice', 'fake'), sidecar: fakeSidecar(film), cached: true };
    };
    const { report, exitCode } = await runVoiced(writeVoiced(`voiced-late-abort-${flags.outline ? 'o' : flags.noRender ? 'n' : 'f'}`), synthesise, flags, controller.signal);
    assertInterrupted(report, exitCode, [['validate', true], ['voice', true]]);
  });
}

// ---- kind rules that resolve anchors judge a voiced film on its measured timeline ----

// A clipping shot in pop, a look that cuts to region close-ups, with an event on each of two regions.
const clippingFilm = (say, ats, extra = {}) => ({ version: 2, mode: 'viral', look: 'pop', ...extra, shots: [{
  id: 'proof', show: 'clipping', src: 'clipping.png', say,
  regions: { a: [0.58, 0.14, 0.37, 0.24], b: [0.58, 0.5, 0.37, 0.2] }, crop: [0.57, 0.1, 0.405, 0.885],
  on: ats.map((at, j) => ({ at, do: 'highlight', target: j === 0 ? 'region:a' : 'region:b' })),
}] });
// A sidecar for a one-shot film whose words start at `starts` and whose WAV lasts `seconds`.
const sidecarWith = (starts, seconds) => (film) => {
  const { tokens } = parseSay(film.shots[0].say);
  const words = tokens.map((t, k) => ({ text: t.text, start: starts[k], end: starts[k] + FAKE_SPAN, emphasis: t.emphasis, aside: t.aside }));
  return { version: 1, model: FAKE_MODEL, voice: 'af_heart', sampleRate: 24000, shots: [{ id: film.shots[0].id, wav: 'shot-0.wav', seconds, sentences: sentencesOf(tokens, words) }] };
};
const writeClipping = (name, film) => {
  writeFileSync(path.join(dir, 'clipping.png'), readFileSync(path.resolve(HERE, '../../../references/examples/v2/clipping.png')));
  writeFileSync(filmPath(name), JSON.stringify(film));
  return filmPath(name);
};
const SAME_TIME = /at the same time as on\[0\]/;

test('two region events past the estimated end are not a false "same time" clash in a voiced film', async () => {
  const silent = clippingFilm('Costs rose.', [2, 3]);
  writeClipping('clip-silent', silent);
  const estimated = validateFilm(silent, { specDir: dir }).errors;
  assert.ok(estimated.some((e) => e.path === 'shots[0].on[1].at' && SAME_TIME.test(e.message)), `both clamp to the estimated end: ${JSON.stringify(estimated)}`);
  const voiced = clippingFilm('Costs rose.', [2, 3], { voice: { name: 'af_heart' } });
  assert.deepEqual(validateFilm(voiced, { specDir: dir }).errors, [], 'not judged on estimated times');
  const fake = fakeSynthesiser({ sidecarOf: sidecarWith([0.1, 0.5], 4) });
  const { report, exitCode } = await runVoiced(writeClipping('clip-late', voiced), fake.synthesise, { outline: true });
  assert.equal(exitCode, 0, JSON.stringify(report.findings));
  assert.deepEqual(report.findings, []);
});

test('two region events on a word pair the voice says as one are the real "same time" clash, at the timeline stage', async () => {
  const film = clippingFilm('It costs $5 million.', ['word:2', 'word:3'], { voice: { name: 'af_heart' } });
  assert.deepEqual(validateFilm(clippingFilm('It costs $5 million.', ['word:2', 'word:3']), { specDir: dir }).errors, [], 'apart on estimated times');
  const fake = fakeSynthesiser({ sidecarOf: sidecarWith([0.1, 0.3, 0.6, 0.6], 1.5) });
  const { report, exitCode } = await runVoiced(writeClipping('clip-merged', film), fake.synthesise, { outline: true });
  assert.equal(exitCode, 1, JSON.stringify(report));
  assert.deepEqual(report.findings.map((f) => [f.kind, f.path]), [['mechanical', 'shots[0].on[1].at']]);
  assert.match(report.findings[0].message, SAME_TIME);
  assert.deepEqual(stagesOf(report), [['validate', true], ['voice', true], ['timeline', false]]);
});

test('timedAnchorErrors takes the look as the validator does: a film that names none gets its mode\'s, so no rule is skipped', () => {
  const { look, ...unnamed } = clippingFilm('It costs $5 million.', ['word:2', 'word:3'], { voice: { name: 'af_heart' } });
  assert.equal(look, 'pop', 'pop is viral\'s default look');
  const timeline = buildTimeline(unnamed, { fps: FPS, words: sidecarWith([0.1, 0.3, 0.6, 0.6], 1.5)(unnamed).shots });
  const errors = timedAnchorErrors(unnamed, timeline);
  assert.deepEqual(errors.map((e) => e.path), ['shots[0].on[1].at']);
  assert.match(errors[0].message, SAME_TIME);
});

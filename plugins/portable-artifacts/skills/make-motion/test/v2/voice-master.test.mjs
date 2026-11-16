// The voice put into the film (scripts/v2/voice/master.mjs): each shot's narration placed where the timeline says,
// emphasis and asides shaped in film time, the track mastered to the mode's loudness in two loudnorm passes, and muxed
// into the MP4 without touching the video. No speech model anywhere: the WAVs are clicks and tone bursts made here.
// Tests that need ffmpeg (or a browser) skip without them (PA_REQUIRE_BROWSER=1 makes that a failure).
// Run with --test-concurrency=1.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HERE, browserAvailable, ffmpegOrNull } from './helpers/session.mjs';
import { registries } from '../../engine/registry.mjs';
import { buildTimeline, narrationStart } from '../../engine/script/timing.mjs';
import { parseSay } from '../../engine/script/say.mjs';
import {
  LEVELS, RAMP_SECONDS, VOICE_RATE, TRACK_RATE, AAC_AUDIO, gainStages, shapingFilter, masterArgs, masterVoice, voiceTrackArgs, muxArgs, masterTrack, muxVoice,
  judgeLevel,
} from '../../scripts/v2/voice/master.mjs';
import { runMake } from '../../scripts/v2/run.mjs';
import { renderFilm } from '../../scripts/v2/render.mjs';

const FIXTURES = path.join(HERE, '..', 'fixtures', 'voice');
const FILM = JSON.parse(readFileSync(path.join(FIXTURES, 'film-three-shots.json'), 'utf8'));
const SIDECAR = JSON.parse(readFileSync(path.join(FIXTURES, 'sidecar-three-shots.json'), 'utf8'));
const FPS = 30;
const PRO = registries.modes.get('pro');
const VIRAL = registries.modes.get('viral');
const TIMELINE = buildTimeline(FILM, { fps: FPS, words: SIDECAR.shots });
const MEASURED = Object.freeze({ input_i: '-27.31', input_tp: '-19.80', input_lra: '4.20', input_thresh: '-37.60', target_offset: '0.12' });
const MEASURE_STDERR = `[Parsed_loudnorm_0 @ 0x1] \n{\n\t"input_i" : "-27.31",\n\t"input_tp" : "-19.80",\n\t"input_lra" : "4.20",\n\t"input_thresh" : "-37.60",\n\t"output_i" : "-16.0",\n\t"target_offset" : "0.12"\n}\n`;
const APPLY_LINEAR = '[Parsed_loudnorm_1 @ 0x2] \n{\n\t"input_i" : "-27.31",\n\t"output_i" : "-16.02",\n\t"normalization_type" : "linear",\n\t"target_offset" : "0.12"\n}\n';
const TIME_TOLERANCE = 1e-9;

let dir;
before(() => { dir = mkdtempSync(path.join(tmpdir(), 'mm-v2-master-')); });
after(() => rmSync(dir, { recursive: true, force: true }));

// ---- PCM helpers: WAVs written and read here, 16-bit mono ----

const WAV_HEADER = 44;
function writeWav(file, samples, rate = VOICE_RATE) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(s * 32767))), i * 2));
  const head = Buffer.alloc(WAV_HEADER);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([head, data]));
}

// The first channel of a 16-bit PCM WAV as floats, read by its chunks (ffmpeg writes a LIST chunk before data).
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
      const samples = new Float32Array(count);
      for (let i = 0; i < count; i++) samples[i] = buf.readInt16LE(at + 8 + i * 2 * channels) / 32767;
      return { samples, rate };
    }
    at += 8 + size + (size % 2);
  }
  throw new Error(`${file}: no data chunk`);
}

const ffmpegRun = (ffmpeg, args) => spawnSync(ffmpeg, args, { encoding: 'utf8' });
const realRun = (ffmpeg) => async (args) => {
  const r = ffmpegRun(ffmpeg, args);
  return { code: r.status, stderr: r.stderr ?? '' };
};
const sayTokens = (shot) => parseSay(shot.say).tokens;
const flatWords = (shot) => shot.sentences.flatMap((s) => s.words);

// ---- gain stages and the shaping filter: film times, no ffmpeg ----

test('LEVELS lifts emphasis 2 dB and lowers an aside 3 dB, with a 20 ms ramp', () => {
  assert.deepEqual(LEVELS, { emphasisDb: 2, asideDb: -3 });
  assert.equal(RAMP_SECONDS, 0.02);
  assert.ok(Object.isFrozen(LEVELS));
});

test('one emphasised word and one aside give exactly two gain stages, at the sidecar times plus their shot\'s narration start', () => {
  const stages = gainStages(SIDECAR, TIMELINE);
  assert.equal(stages.length, 2);
  const open = narrationStart(TIMELINE.shots[0]);
  const close = narrationStart(TIMELINE.shots[2]);
  assert.ok(close > 4, 'the third shot starts after the first and the held middle one');
  assert.equal(stages[0].db, 2);
  assert.ok(Math.abs(stages[0].start - (open + 0.7067)) < TIME_TOLERANCE && Math.abs(stages[0].end - (open + 0.9478)) < TIME_TOLERANCE);
  assert.equal(stages[1].db, -3);
  assert.ok(Math.abs(stages[1].start - (close + 1.9575)) < TIME_TOLERANCE && Math.abs(stages[1].end - (close + 2.1986)) < TIME_TOLERANCE);
  const filter = shapingFilter(SIDECAR, TIMELINE);
  assert.equal(filter.match(/volume=/g).length, 2, filter);
  assert.match(filter, /\b2\.00\b/);
  assert.match(filter, /-3\.00\b/);
  const ramped = (t) => t.toFixed(4);
  for (const s of stages) {
    assert.ok(filter.includes(ramped(s.start - RAMP_SECONDS)) && filter.includes(ramped(s.end + RAMP_SECONDS)), `ramps of ${JSON.stringify(s)} in ${filter}`);
  }
});

// A sidecar of one shot whose words are given as [text, start, end, emphasis, aside].
function oneShot(words, id = 'a') {
  const list = words.map(([text, start, end, emphasis = false, aside = false]) => ({ text, start, end, emphasis, aside }));
  return { version: 1, sampleRate: VOICE_RATE, shots: [{ id, wav: 'shot-0.wav', seconds: 5, sentences: [{ start: list[0].start, end: list.at(-1).end, words: list }] }] };
}
const TIMELINE_AT = (start) => ({ fps: FPS, duration: start + 6, shots: [{ id: 'a', start }] });

test('contiguous aside words share one stage; a zero-length emphasised word gets none; stages whose ramps would meet are merged', () => {
  const asides = oneShot([['one', 0.1, 0.3], ['two', 0.35, 0.6, false, true], ['three', 0.62, 0.9, false, true], ['four', 1.0, 1.2]]);
  assert.deepEqual(gainStages(asides, TIMELINE_AT(1)), [{ db: -3, start: 1.35, end: 1.9 }]);
  const zero = oneShot([['one', 0.1, 0.1, true], ['two', 0.5, 0.7]]);
  assert.deepEqual(gainStages(zero, TIMELINE_AT(0)), []);
  assert.equal(shapingFilter(zero, TIMELINE_AT(0)), '');
  const close = oneShot([['one', 0.1, 0.3, true], ['two', 0.32, 0.5, true], ['three', 1.0, 1.2, true]]);
  assert.deepEqual(gainStages(close, TIMELINE_AT(0)), [{ db: 2, start: 0.1, end: 0.5 }, { db: 2, start: 1.0, end: 1.2 }]);
});

// ---- the mastering arguments and the two passes ----

test('masterArgs: high-pass at 80 Hz, a compressor, a de-esser, then loudnorm at the mode\'s targets; pass 1 measures, pass 2 applies', () => {
  const measure = masterArgs({ wav: '/w/voice.wav', out: '/w/master.wav', filter: '', loudness: PRO.loudness });
  const af = measure[measure.indexOf('-af') + 1];
  assert.match(af, /highpass=f=80/);
  assert.match(af, /acompressor=/);
  assert.match(af, /deesser/);
  assert.match(af, /loudnorm=I=-16:TP=-2:LRA=11:print_format=json/, 'the true peak aims 0.5 dB under the target for the AAC encode');
  assert.ok(af.indexOf('highpass') < af.indexOf('acompressor') && af.indexOf('acompressor') < af.indexOf('deesser') && af.indexOf('deesser') < af.indexOf('loudnorm'));
  assert.deepEqual(measure.slice(-3), ['-f', 'null', '-']);
  const apply = masterArgs({ wav: '/w/voice.wav', out: '/w/master.wav', filter: '', loudness: VIRAL.loudness, measured: MEASURED });
  const af2 = apply[apply.indexOf('-af') + 1];
  assert.match(af2, /loudnorm=I=-14:TP=-1.5:LRA=9:measured_I=-27.31:measured_TP=-19.80:measured_LRA=4.20:measured_thresh=-37.60:offset=0.12:linear=true:print_format=json/);
  assert.equal(apply.at(-1), '/w/master.wav');
  assert.ok(apply.includes('48000'), 'the master is written at 48 kHz, never left at loudnorm\'s 192 kHz');
  const wide = masterArgs({ wav: '/w/voice.wav', out: '/w/master.wav', filter: '', loudness: VIRAL.loudness, measured: { ...MEASURED, input_lra: '12.30' } });
  assert.match(wide[wide.indexOf('-af') + 1], /LRA=13:measured_I/, 'a range wider than the mode\'s is let through, so loudnorm stays linear');
  const unmeasured = masterArgs({ wav: '/w/voice.wav', out: '/w/master.wav', filter: '', loudness: PRO.loudness, measured: null });
  assert.doesNotMatch(unmeasured[unmeasured.indexOf('-af') + 1], /loudnorm/, 'a track loudnorm cannot measure is not normalised');
});

test('the shaping comes after the compressor and the de-esser and before loudnorm, so neither takes back the lift', () => {
  const shaped = masterArgs({ wav: '/w/voice.wav', out: '/w/master.wav', filter: shapingFilter(SIDECAR, TIMELINE), loudness: PRO.loudness, measured: MEASURED });
  const af = shaped[shaped.indexOf('-af') + 1];
  assert.ok(af.indexOf('deesser') < af.indexOf('volume=') && af.indexOf('volume=') < af.indexOf('loudnorm'), af);
});

test('input metadata never reaches a measurement: the track and both passes drop it', () => {
  const track = voiceTrackArgs({ shots: [{ wav: '/v/shot-0.wav' }], timeline: TIMELINE_AT(0), out: '/v/t.wav' });
  const measure = masterArgs({ wav: '/w/v.wav', out: '/w/m.wav', filter: '', loudness: PRO.loudness });
  const apply = masterArgs({ wav: '/w/v.wav', out: '/w/m.wav', filter: '', loudness: PRO.loudness, measured: MEASURED });
  for (const args of [track, measure, apply]) assert.ok(args.join(' ').includes('-map_metadata -1'), args.join(' '));
});

test('no film string reaches an argument: a word text with a quote and a filter separator is never written', () => {
  const evil = "x';volume=99:'\"[a]";
  const film = { mode: 'pro', shots: [{ id: "a';b", say: `Say *${evil}* now.` }] };
  const words = [{ text: 'Say', start: 0.1, end: 0.3, emphasis: false, aside: false }, { text: evil, start: 0.35, end: 0.6, emphasis: true, aside: false }, { text: 'now.', start: 0.65, end: 0.9, emphasis: false, aside: false }];
  const sidecar = { version: 1, sampleRate: VOICE_RATE, shots: [{ id: "a';b", wav: 'shot-0.wav', seconds: 1, sentences: [{ start: 0.1, end: 0.9, words }] }] };
  const timeline = { fps: FPS, duration: 2, shots: [{ id: "a';b", start: 0.5 }] };
  const filter = shapingFilter(sidecar, timeline);
  const all = [
    ...masterArgs({ wav: '/w/v.wav', out: '/w/m.wav', filter, loudness: PRO.loudness }),
    ...masterArgs({ wav: '/w/v.wav', out: '/w/m.wav', filter, loudness: PRO.loudness, measured: MEASURED }),
    ...voiceTrackArgs({ shots: [{ wav: '/w/shot-0.wav' }], timeline, out: '/w/v.wav' }),
  ];
  assert.equal(film.shots.length, 1);
  for (const arg of all) {
    assert.ok(!arg.includes(evil) && !arg.includes("';") && !arg.includes('"') && !arg.includes("a';b"), arg);
  }
  assert.match(filter, /^[\w=.,:'()+\-*/ ]*$/, 'only numbers, names and expression syntax');
});

// A fake ffmpeg that answers each pass with the stderr in `answers`, in order, and records the arguments.
function fakeRunner(answers) {
  const calls = [];
  const run = async (args) => {
    calls.push(args);
    return { code: 0, stderr: answers[calls.length - 1] ?? '' };
  };
  return { run, calls };
}

test('masterVoice runs the measure pass, then the apply pass with the measured values, and checks that loudnorm stayed linear', async () => {
  const { run, calls } = fakeRunner([MEASURE_STDERR, APPLY_LINEAR]);
  const result = await masterVoice({ run, wav: '/w/v.wav', out: '/w/m.wav', filter: '', loudness: PRO.loudness });
  assert.equal(calls.length, 2);
  assert.match(calls[0].join(' '), /print_format=json/);
  assert.match(calls[1].join(' '), /measured_I=-27.31:measured_TP=-19.80:measured_LRA=4.20:measured_thresh=-37.60:offset=0.12/);
  assert.deepEqual(result, { measured: MEASURED, limited: false });
});

test('masterVoice refuses a pass 2 in which loudnorm fell back to dynamic mode: the emphasis and aside levels would not survive', async () => {
  const { run } = fakeRunner([MEASURE_STDERR, APPLY_LINEAR.replace('"linear"', '"dynamic"')]);
  await assert.rejects(masterVoice({ run, wav: '/w/v.wav', out: '/w/m.wav', filter: '', loudness: PRO.loudness }),
    (err) => /dynamic/.test(err.message) && err.hint.length > 0);
});

test('a track whose peaks the gain would push over the ceiling is limited first and measured again, then applied linear through the limiter', async () => {
  const peaky = MEASURE_STDERR.replace('"-19.80"', '"-3.10"');
  const limited = MEASURE_STDERR.replace('"-27.31"', '"-17.90"').replace('"-19.80"', '"-5.00"');
  const { run, calls } = fakeRunner([peaky, limited, APPLY_LINEAR]);
  const result = await masterVoice({ run, wav: '/w/v.wav', out: '/w/m.wav', filter: '', loudness: PRO.loudness });
  assert.equal(calls.length, 3);
  assert.doesNotMatch(calls[0].join(' '), /alimiter/);
  assert.match(calls[1].join(' '), /volume=11\.31dB,alimiter=.*loudnorm=.*print_format=json/, 'the gain to the target, then the limiter, then loudnorm measures');
  assert.match(calls[2].join(' '), /alimiter=.*loudnorm=.*measured_I=-17.90:measured_TP=-5.00/);
  assert.equal(result.limited, true);
});

test('masterVoice fails with ffmpeg\'s own words and a hint when a pass fails or prints no measurement', async () => {
  const failing = async () => ({ code: 1, stderr: 'line one\nNo such filter: deesser\n' });
  await assert.rejects(masterVoice({ run: failing, wav: '/w/v.wav', out: '/w/m.wav', filter: '', loudness: PRO.loudness }),
    (err) => /ffmpeg failed \(exit 1\): No such filter: deesser/.test(err.message) && typeof err.hint === 'string' && err.hint.length > 0);
  const mute = async () => ({ code: 0, stderr: 'nothing\n' });
  await assert.rejects(masterVoice({ run: mute, wav: '/w/v.wav', out: '/w/m.wav', filter: '', loudness: PRO.loudness }), /no loudness measurement/);
});

test('a track loudnorm cannot measure (too short or too quiet) is written without normalisation, never failed or forced', async () => {
  const { run, calls } = fakeRunner([MEASURE_STDERR.replace('"-27.31"', '"-inf"'), '']);
  const result = await masterVoice({ run, wav: '/w/v.wav', out: '/w/m.wav', filter: '', loudness: PRO.loudness });
  assert.deepEqual(result, { measured: null, limited: false });
  assert.equal(calls.length, 2);
  assert.doesNotMatch(calls[1].join(' '), /loudnorm/);
  assert.equal(calls[1].at(-1), '/w/m.wav');
});

test('judgeLevel: more than 1 LU from the target, or a true peak over the ceiling, is machine trouble with a hint; an unmeasurable track passes with its note', () => {
  const ok = { lufs: -16.6, truePeakDb: -2.1, note: null };
  assert.deepEqual(judgeLevel(ok, PRO.loudness), ok);
  assert.throws(() => judgeLevel({ ...ok, lufs: -17.2 }, PRO.loudness), (err) => /-17\.2 LUFS.*1 LU.*-16/.test(err.message) && err.hint.length > 0);
  assert.throws(() => judgeLevel({ ...ok, lufs: -14.8 }, PRO.loudness), /-14\.8 LUFS/);
  assert.throws(() => judgeLevel({ ...ok, truePeakDb: -1.2 }, PRO.loudness), (err) => /true peak of -1\.2 dBTP.*-1\.5/.test(err.message) && err.hint.length > 0);
  const quiet = { lufs: null, truePeakDb: -60, note: 'x' };
  assert.deepEqual(judgeLevel(quiet, PRO.loudness), quiet);
});

// ---- the voice track and the mux arguments ----

test('voiceTrackArgs places each narrated WAV at its shot\'s narration start in whole 48 kHz samples, mixes without normalising, pads to the film', () => {
  const shots = [{ wav: '/v/shot-0.wav' }, { wav: null }, { wav: '/v/shot-2.wav' }];
  const args = voiceTrackArgs({ shots, timeline: TIMELINE, out: '/v/track.wav' });
  const graph = args[args.indexOf('-filter_complex') + 1];
  const inputs = args.filter((a, i) => args[i - 1] === '-i');
  assert.deepEqual(inputs, ['/v/shot-0.wav', '/v/shot-2.wav'], 'a shot without narration is no input');
  assert.equal(TRACK_RATE, 48000);
  assert.equal(graph.match(/aformat=sample_rates=48000:channel_layouts=mono/g).length, 2, 'each WAV resampled once, to 48 kHz');
  const delays = [...graph.matchAll(/adelay=delays=(\d+)S:all=1/g)].map((m) => Number(m[1]));
  assert.deepEqual(delays, [Math.round(narrationStart(TIMELINE.shots[0]) * TRACK_RATE), Math.round(narrationStart(TIMELINE.shots[2]) * TRACK_RATE)]);
  assert.match(graph, /amix=inputs=2:duration=longest:normalize=0/);
  assert.ok(args.join(' ').includes(`-ar ${TRACK_RATE} -ac 1`));
  const length = Math.round(TIMELINE.duration * TRACK_RATE);
  assert.match(graph, new RegExp(`apad=whole_len=${length}`));
  assert.match(graph, new RegExp(`atrim=end_sample=${length}`));
  assert.equal(args.at(-1), '/v/track.wav');
});

test('muxArgs copies the video and encodes the voice as AAC 48 kHz at 160 kbit/s, capped at the film length', () => {
  assert.deepEqual(AAC_AUDIO, ['-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2']);
  const args = muxArgs({ video: '/o/v.mp4', audio: '/o/m.wav', out: '/o/f.mp4', duration: 8.4 });
  const joined = args.join(' ');
  assert.match(joined, /-map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 160k -ar 48000 -ac 2/);
  assert.match(joined, /-t 8\.4000/);
  assert.equal(args.at(-1), '/o/f.mp4');
});

// ---- with ffmpeg: alignment, shaping in film time, mastering and the mux ----

const needFfmpeg = async (t) => {
  const ffmpeg = await ffmpegOrNull();
  if (!ffmpeg) t.skip('no ffmpeg');
  return ffmpeg;
};

// A film with a long held first shot and a held shot between two narrated ones, and a fake synthesiser's sidecar for
// it: word k of a shot at WORD_FIRST + k * WORD_STEP in that shot's WAV.
const ALIGN_FILM = { version: 2, mode: 'pro', shots: [
  { id: 'intro', show: 'statement', hold: 2.4 },
  { id: 'one', show: 'statement', cut: 'cut', say: 'Every chart is a question.' },
  { id: 'breath', show: 'statement', cut: 'cut', hold: 1.3 },
  { id: 'two', show: 'statement', cut: 'cut', say: 'The answer *arrives* on time.' },
] };
const WORD_FIRST = 0.11;
const WORD_STEP = 0.37;
const WORD_LENGTH = 0.3;
const CLICK_SECONDS = 0.005;
const CLICK_LEVEL = 0.8;

function fakeSidecar(film) {
  const shots = film.shots.map((shot, index) => {
    if (shot.say === undefined) return { id: shot.id, wav: null, seconds: 0, sentences: [] };
    const words = sayTokens(shot).map((token, k) => {
      const start = Math.round((WORD_FIRST + k * WORD_STEP) * 1e4) / 1e4;
      return { text: token.text, start, end: Math.round((start + WORD_LENGTH) * 1e4) / 1e4, emphasis: token.emphasis, aside: token.aside };
    });
    return { id: shot.id, wav: `shot-${index}.wav`, seconds: Math.round((words.at(-1).end + 0.2) * 1e4) / 1e4, sentences: [{ start: words[0].start, end: words.at(-1).end, words }] };
  });
  return { version: 1, model: { id: 'fake', commit: 'fake', file: 'fake', sha256: 'fake' }, voice: 'af_heart', sampleRate: VOICE_RATE, shots };
}

// Per-shot WAVs that are silent but for a 5 ms click at each word start.
function writeClickWavs(voiceDir, sidecar) {
  mkdirSync(voiceDir, { recursive: true });
  for (const shot of sidecar.shots) {
    if (shot.wav === null) continue;
    const samples = new Float32Array(Math.round(shot.seconds * VOICE_RATE));
    for (const w of flatWords(shot)) {
      const from = Math.round(w.start * VOICE_RATE);
      for (let i = 0; i < CLICK_SECONDS * VOICE_RATE; i++) samples[from + i] = CLICK_LEVEL;
    }
    writeWav(path.join(voiceDir, shot.wav), samples);
  }
}

// The seconds at which the signal rises over `threshold` after at least `quiet` seconds under it.
function onsets(samples, rate, threshold = 0.3, quiet = 0.05) {
  const found = [];
  let last = -Infinity;
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) < threshold) continue;
    if (i - last > quiet * rate) found.push(i / rate);
    last = i;
  }
  return found;
}

const wavPaths = (voiceDir, sidecar) => sidecar.shots.map((s) => ({ wav: s.wav === null ? null : path.join(voiceDir, s.wav) }));

// Track samples are placed exactly; 1 ms allows one 24 kHz sample of rounding plus the resampler.
const RAW_TOLERANCE = 0.001;

// The word starts of a timeline in film seconds, from the timeline itself (shot start plus measured word).
const filmStarts = (timeline) => timeline.shots.flatMap((shot) => shot.words.map((w) => shot.start + w.start));

// Asserts each onset within `tolerance` of its word; returns the largest offset, in seconds.
function assertClicksAt(heard, expected, tolerance) {
  assert.equal(heard.length, expected.length, `onsets heard at ${heard.map((s) => s.toFixed(4))}`);
  heard.forEach((s, k) => assert.ok(Math.abs(s - expected[k]) <= tolerance, `onset ${k} at ${s.toFixed(4)} s, its word at ${expected[k].toFixed(4)} s`));
  return Math.max(...heard.map((s, k) => Math.abs(s - expected[k])));
}

test('alignment: every click of the voice track lies within 1 ms of its word\'s time on the measured timeline', async (t) => {
  const ffmpeg = await needFfmpeg(t);
  if (!ffmpeg) return;
  const sidecar = fakeSidecar(ALIGN_FILM);
  const voiceDir = path.join(dir, 'align');
  writeClickWavs(voiceDir, sidecar);
  const timeline = buildTimeline(ALIGN_FILM, { fps: FPS, words: sidecar.shots });
  const out = path.join(voiceDir, 'track.wav');
  const r = ffmpegRun(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...voiceTrackArgs({ shots: wavPaths(voiceDir, sidecar), timeline, out })]);
  assert.equal(r.status, 0, r.stderr);
  const { samples, rate } = readWav(out);
  assert.equal(rate, TRACK_RATE);
  assert.ok(Math.abs(samples.length / rate - timeline.duration) < 1 / TRACK_RATE + 1e-9, 'the track is exactly the film long');
  const expected = filmStarts(timeline);
  assert.ok(expected[0] > 2.4, 'the first word waits for the long held shot');
  const worst = assertClicksAt(onsets(samples, rate), expected, RAW_TOLERANCE);
  t.diagnostic(`largest click offset in the raw track: ${(worst * 1000).toFixed(3)} ms`);
});

// Through the compressor, the limiter, loudnorm's 192 kHz round trip, the AAC encode and its decode: the largest offset
// measured on ffmpeg 8.1.1 was 0.06 ms (the test prints it), so 1 ms leaves room for AAC pre-echo and nothing more.
const ALIGN_TOLERANCE = 0.001;
const ONSET_FRACTION = 0.05;

// Word onsets are tone bursts here, not clicks: a track of 5 ms clicks in silence is so peaky that the limiter cannot
// bring it to the target in three rounds (measured: -28.3, -27.1, -23.4 LUFS for a -16 target), which no voice is.
test('alignment after the whole chain: the word onsets decoded from the finished MP4 lie within 1 ms of their words on the timeline', async (t) => {
  const ffmpeg = await needFfmpeg(t);
  if (!ffmpeg) return;
  const sidecar = fakeSidecar(ALIGN_FILM);
  const work = path.join(dir, 'align-mux');
  const voiceDir = path.join(work, 'voice');
  writeBurstWavs(voiceDir, sidecar);
  const timeline = buildTimeline(ALIGN_FILM, { fps: FPS, words: sidecar.shots });
  const video = testVideo(ffmpeg, work, timeline.duration);
  const run = realRun(ffmpeg);
  const master = await masterTrack({ run, voice: { dir: voiceDir, sidecar }, timeline, loudness: PRO.loudness, workDir: work });
  const out = path.join(work, 'film.mp4');
  await muxVoice({ run, video, audio: master, out, duration: timeline.duration });
  const decoded = path.join(work, 'decoded.wav');
  const r = ffmpegRun(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', out, '-map', '0:a:0', '-ac', '1', '-ar', String(TRACK_RATE), '-c:a', 'pcm_s16le', decoded]);
  assert.equal(r.status, 0, r.stderr);
  const { samples, rate } = readWav(decoded);
  const peak = samples.reduce((m, s) => Math.max(m, Math.abs(s)), 0);
  // 5% of the peak: the gaps between bursts are silent, and a higher threshold is crossed partway up a burst's first
  // cycle (half the peak read 3.5 ms late on one word: the detector's bias, not the track's).
  const worst = assertClicksAt(onsets(samples, rate, peak * ONSET_FRACTION), filmStarts(timeline), ALIGN_TOLERANCE);
  t.diagnostic(`largest onset offset after master and mux: ${(worst * 1000).toFixed(2)} ms`);
});

test('a 48 kHz recording keeps its top octave: a 15 kHz tone comes through the voice track at its own level', async (t) => {
  const ffmpeg = await needFfmpeg(t);
  if (!ffmpeg) return;
  const work = path.join(dir, 'top-octave');
  mkdirSync(work, { recursive: true });
  const input = path.join(work, 'shot-0.wav');
  const high = Float32Array.from({ length: TRACK_RATE }, (_, i) => 0.25 * Math.sin((2 * Math.PI * 15000 * i) / TRACK_RATE));
  writeWav(input, high, TRACK_RATE);
  const out = path.join(work, 'track.wav');
  const r = ffmpegRun(ffmpeg, voiceTrackArgs({ shots: [{ wav: input }], timeline: TIMELINE_AT(0), out }));
  assert.equal(r.status, 0, r.stderr);
  const { samples, rate } = readWav(out);
  const level = db(rms(samples, rate, 0.1, 0.9) / rms(high, TRACK_RATE, 0.1, 0.9));
  assert.ok(Math.abs(level) < 0.5, `15 kHz at ${level.toFixed(2)} dB of its input`);
});

// RMS of `samples` between from and to seconds.
function rms(samples, rate, from, to) {
  let sum = 0;
  const a = Math.round(from * rate);
  const b = Math.round(to * rate);
  for (let i = a; i < b; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / (b - a));
}
const db = (ratio) => 20 * Math.log10(ratio);

// A steady 440 Hz tone at the track rate, `amplitude` peak, `seconds` long.
const toneOf = (amplitude, seconds) => Float32Array.from({ length: Math.round(seconds * TRACK_RATE) }, (_, i) => amplitude * Math.sin((2 * Math.PI * 440 * i) / TRACK_RATE));

// The emphasised and the aside word of the fixture film, in film seconds, from the timeline itself (its shot start plus
// the measured word), not from the code under test.
function shapedWords() {
  const filmWord = (flag) => TIMELINE.shots.flatMap((shot) => shot.words.filter((w) => w[flag]).map((w) => ({ start: shot.start + w.start, end: shot.start + w.end })));
  return { emphasis: filmWord('emphasis')[0], aside: filmWord('aside')[0] };
}

// A short test video, mpeg4 (a codec the mux would never pick, so a re-encode cannot hide), `seconds` long.
function testVideo(ffmpeg, work, seconds) {
  mkdirSync(work, { recursive: true });
  const video = path.join(work, 'video.mp4');
  const made = ffmpegRun(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=gray:s=320x180:r=${FPS}:d=${seconds}`, '-c:v', 'mpeg4', '-q:v', '5', video]);
  assert.equal(made.status, 0, made.stderr);
  return video;
}

// A tone at -12 dBFS RMS: speech level, over the compressor's -18 dBFS threshold.
const LOUD_TONE_PEAK = Math.SQRT2 * 10 ** (-12 / 20);
const LEVEL_TOLERANCE_DB = 0.3;

test('the emphasis lift and the aside cut survive the whole mastering chain: +2 and -3 dB on a tone at -12 dBFS RMS', async (t) => {
  const ffmpeg = await needFfmpeg(t);
  if (!ffmpeg) return;
  const work = path.join(dir, 'levels');
  mkdirSync(work, { recursive: true });
  const wav = path.join(work, 'track.wav');
  const out = path.join(work, 'master.wav');
  writeWav(wav, toneOf(LOUD_TONE_PEAK, TIMELINE.duration), TRACK_RATE);
  const result = await masterVoice({ run: realRun(ffmpeg), wav, out, filter: shapingFilter(SIDECAR, TIMELINE), loudness: PRO.loudness });
  assert.equal(result.limited, false);
  const { samples, rate } = readWav(out);
  const base = rms(samples, rate, 0.3, 0.6);
  const { emphasis, aside } = shapedWords();
  const inside = (s) => db(rms(samples, rate, s.start + 0.01, s.end - 0.01) / base);
  assert.ok(Math.abs(inside(emphasis) - LEVELS.emphasisDb) <= LEVEL_TOLERANCE_DB, `emphasis ${inside(emphasis).toFixed(2)} dB`);
  assert.ok(Math.abs(inside(aside) - LEVELS.asideDb) <= LEVEL_TOLERANCE_DB, `aside ${inside(aside).toFixed(2)} dB`);
});

test('shaping in film time: a steady tone is 2 dB up inside the emphasised word, 3 dB down inside the aside, unchanged outside', async (t) => {
  const ffmpeg = await needFfmpeg(t);
  if (!ffmpeg) return;
  const tone = toneOf(0.25, TIMELINE.duration);
  const input = path.join(dir, 'tone.wav');
  const out = path.join(dir, 'tone-shaped.wav');
  writeWav(input, tone, TRACK_RATE);
  const r = ffmpegRun(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-af', shapingFilter(SIDECAR, TIMELINE), '-c:a', 'pcm_s16le', out]);
  assert.equal(r.status, 0, r.stderr);
  const { samples, rate } = readWav(out);
  const base = rms(tone, rate, 0.1, 0.5);
  const { emphasis, aside } = shapedWords();
  assert.ok(aside.start > 4, 'the aside is in the third shot, after the held one');
  const inside = (s) => db(rms(samples, rate, s.start + 0.01, s.end - 0.01) / base);
  const outside = (s) => db(rms(samples, rate, s.start - RAMP_SECONDS - 0.06, s.start - RAMP_SECONDS - 0.01) / base);
  assert.ok(Math.abs(inside(emphasis) - 2) < 0.15, `emphasis ${inside(emphasis).toFixed(2)} dB`);
  assert.ok(Math.abs(inside(aside) + 3) < 0.15, `aside ${inside(aside).toFixed(2)} dB`);
  assert.ok(Math.abs(outside(emphasis)) < 0.1 && Math.abs(outside(aside)) < 0.1, 'no gain before the ramp');
  const mid = (s) => db(rms(samples, rate, s.start - RAMP_SECONDS / 2 - 0.002, s.start - RAMP_SECONDS / 2 + 0.002) / base);
  assert.ok(mid(emphasis) > 0.3 && mid(emphasis) < 1.7, `half way up the ramp: ${mid(emphasis).toFixed(2)} dB`);
});

// Tone bursts for each word of each narrated shot of `sidecar`, a voice-like level with headroom.
function writeBurstWavs(voiceDir, sidecar) {
  mkdirSync(voiceDir, { recursive: true });
  for (const shot of sidecar.shots) {
    if (shot.wav === null) continue;
    const samples = new Float32Array(Math.round(shot.seconds * VOICE_RATE));
    for (const w of flatWords(shot)) {
      for (let i = Math.round(w.start * VOICE_RATE); i < Math.round(w.end * VOICE_RATE); i++) {
        const t = i / VOICE_RATE;
        samples[i] = 0.12 * Math.sin(2 * Math.PI * 180 * t) + 0.06 * Math.sin(2 * Math.PI * 360 * t) + 0.03 * Math.sin(2 * Math.PI * 1100 * t);
      }
    }
    writeWav(path.join(voiceDir, shot.wav), samples);
  }
}

const probe = (file) => JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8' }).stdout);
const videoMd5 = (ffmpeg, file) => ffmpegRun(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:v:0', '-c', 'copy', '-f', 'md5', '-']).stdout.trim();
function integratedLoudness(ffmpeg, file) {
  const r = ffmpegRun(ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-map', '0:a:0', '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const lufs = [...r.stderr.matchAll(/\bI:\s+(-?[\d.]+) LUFS/g)].at(-1);
  const peak = [...r.stderr.matchAll(/True peak:\s+Peak:\s+(-?[\d.]+) dBFS/g)].at(-1);
  return { lufs: Number(lufs[1]), truePeak: Number(peak[1]) };
}

test('masterTrack and muxVoice master tone bursts to the mode\'s loudness and mux one AAC stream, the film long, without re-encoding the video', async (t) => {
  const ffmpeg = await needFfmpeg(t);
  if (!ffmpeg) return;
  if (spawnSync('ffprobe', ['-version']).status !== 0) { t.skip('no ffprobe'); return; }
  const work = path.join(dir, 'mux');
  const voiceDir = path.join(work, 'voice');
  writeBurstWavs(voiceDir, SIDECAR);
  const video = testVideo(ffmpeg, work, TIMELINE.duration);
  const out = path.join(work, 'film.mp4');
  const run = realRun(ffmpeg);
  const master = await masterTrack({ run, voice: { dir: voiceDir, sidecar: SIDECAR }, timeline: TIMELINE, loudness: PRO.loudness, workDir: work });
  assert.equal(master, path.join(work, 'voice-master.wav'));
  const audio = await muxVoice({ run, video, audio: master, out, duration: TIMELINE.duration });
  const { streams, format } = probe(out);
  const sound = streams.filter((s) => s.codec_type === 'audio');
  assert.equal(sound.length, 1);
  assert.deepEqual([sound[0].codec_name, sound[0].sample_rate, sound[0].channels], ['aac', '48000', 2]);
  const videoStream = streams.find((s) => s.codec_type === 'video');
  assert.equal(videoStream.codec_name, 'mpeg4');
  assert.ok(Math.abs(Number(sound[0].duration) - Number(videoStream.duration)) <= 0.05, `audio ${sound[0].duration} s, video ${videoStream.duration} s`);
  assert.ok(Math.abs(Number(format.duration) - TIMELINE.duration) <= 0.05);
  assert.equal(videoMd5(ffmpeg, out), videoMd5(ffmpeg, video), 'the video packets are the encode\'s own');
  const level = integratedLoudness(ffmpeg, out);
  assert.ok(Math.abs(level.lufs - PRO.loudness.lufs) <= 1, `integrated ${level.lufs} LUFS, target ${PRO.loudness.lufs}`);
  assert.ok(level.truePeak <= PRO.loudness.truePeakDb + 0.1, `true peak ${level.truePeak}`);
  assert.ok(Math.abs(audio.lufs - level.lufs) < 0.05 && Math.abs(audio.truePeakDb - level.truePeak) < 0.05, 'what is reported is what the file measures');
  assert.equal(audio.note, null);
  assert.deepEqual(judgeLevel(audio, PRO.loudness), audio, 'on target: judged fine');
});

test('a narration too quiet to measure is muxed, not failed: audio.lufs null with a note, and judgeLevel lets it through', async (t) => {
  const ffmpeg = await needFfmpeg(t);
  if (!ffmpeg) return;
  const work = path.join(dir, 'quiet');
  const voiceDir = path.join(work, 'voice');
  const sidecar = fakeSidecar(ALIGN_FILM);
  mkdirSync(voiceDir, { recursive: true });
  for (const shot of sidecar.shots.filter((s) => s.wav !== null)) {
    writeWav(path.join(voiceDir, shot.wav), Float32Array.from({ length: Math.round(shot.seconds * VOICE_RATE) }, (_, i) => 0.0001 * Math.sin((2 * Math.PI * 200 * i) / VOICE_RATE)));
  }
  const timeline = buildTimeline(ALIGN_FILM, { fps: FPS, words: sidecar.shots });
  const run = realRun(ffmpeg);
  const master = await masterTrack({ run, voice: { dir: voiceDir, sidecar }, timeline, loudness: PRO.loudness, workDir: work });
  const out = path.join(work, 'film.mp4');
  const audio = await muxVoice({ run, video: testVideo(ffmpeg, work, timeline.duration), audio: master, out, duration: timeline.duration });
  assert.equal(audio.lufs, null);
  assert.match(audio.note, /too short or too quiet/);
  assert.deepEqual(judgeLevel(audio, PRO.loudness), audio);
  assert.equal(probe(out).streams.filter((s) => s.codec_type === 'audio').length, 1);
});

test('masterTrack of a voiced film whose shots have no WAV at all is null: there is no voice to put in, and ffmpeg is not run', async () => {
  const calls = [];
  const sidecar = { version: 1, sampleRate: VOICE_RATE, shots: [{ id: 'a', wav: null, seconds: 0, sentences: [] }] };
  const master = await masterTrack({ run: async (args) => { calls.push(args); return { code: 0, stderr: '' }; }, voice: { dir: '/v', sidecar }, timeline: TIMELINE_AT(0), loudness: PRO.loudness, workDir: '/w' });
  assert.equal(master, null);
  assert.equal(calls.length, 0);
});

test('a sidecar WAV name that is not a bare file name beside it (a path, ".", "..", empty) is refused before ffmpeg runs', async () => {
  for (const wav of ['../elsewhere.wav', '.', '..', '', 'a/b.wav']) {
    const sidecar = { version: 1, sampleRate: VOICE_RATE, shots: [{ id: 'a', wav, seconds: 1, sentences: [] }] };
    await assert.rejects(masterTrack({ run: async () => assert.fail('ffmpeg must not run'), voice: { dir: '/v', sidecar }, timeline: TIMELINE_AT(0), loudness: PRO.loudness, workDir: '/w' }),
      (err) => /not a file beside it/.test(err.message) && err.hint.length > 0, JSON.stringify(wav));
  }
});

test('renderFilm refuses a voiced film given without its voice, before any frame or file, rather than render it silent', async (t) => {
  if (!await needFfmpeg(t)) return;
  const session = { film: { mode: 'pro', voice: { name: 'af_heart' }, shots: [] }, timeline: TIMELINE, info: { post: '2d' }, page: null };
  const out = path.join(dir, 'refused', 'film.mp4');
  await assert.rejects(renderFilm({ out, session }), /the film has a voice; pass the voice stage's result/);
  assert.equal(existsSync(path.dirname(out)), false, 'nothing was written');
});

test('renderFilm fails fast on a voice ffmpeg cannot mix: before any frame is captured, with ffmpeg\'s words and a hint, and leaves no file', async (t) => {
  if (!await needFfmpeg(t)) return;
  const page = { evaluate: () => assert.fail('no frame may be captured'), screenshot: () => assert.fail('no frame may be captured') };
  const session = { film: FILM, timeline: TIMELINE, info: { post: '2d' }, page };
  const out = path.join(dir, 'broken-voice', 'film.mp4');
  const voice = { dir: path.join(dir, 'no-such-voice'), sidecar: SIDECAR };
  await assert.rejects(renderFilm({ out, session, voice }), (err) => /^voice mix: ffmpeg failed \(exit \d+\)/.test(err.message) && err.hint.length > 0);
  assert.deepEqual(readdirSync(path.dirname(out)), [], 'no output and no partial file');
});

// ---- through make: a voiced film renders with its voice, a silent one exactly as before ----

const filmFile = (name, film) => {
  const file = path.join(dir, `${name}.json`);
  writeFileSync(file, JSON.stringify(film));
  return file;
};

test('make renders a voiced film with its mastered voice (report.audio measured), and a silent film with no audio stream (audio null)', async (t) => {
  if (!await browserAvailable()) { t.skip('no browser'); return; }
  const ffmpeg = await needFfmpeg(t);
  if (!ffmpeg) return;
  if (spawnSync('ffprobe', ['-version']).status !== 0) { t.skip('no ffprobe'); return; }
  const voiced = { version: 2, mode: 'pro', voice: { name: 'af_heart' }, shots: [
    { id: 'hook', show: 'statement', say: 'Every chart is a *question* worth asking.' },
  ] };
  const synthesise = async (film, options) => {
    const sidecar = fakeSidecar(film);
    const voiceDir = path.join(options.outDir, '.voice', 'fake');
    writeBurstWavs(voiceDir, sidecar);
    return { dir: voiceDir, sidecar, cached: false };
  };
  const out = path.join(dir, 'make-voiced', 'film.mp4');
  const { report, exitCode } = await runMake({ specPath: filmFile('voiced', voiced), out, exact: false, noRender: false, outline: false }, { synthesise });
  assert.equal(exitCode, 0, JSON.stringify(report.error ?? report.findings));
  assert.equal(report.output, out);
  assert.deepEqual(probe(out).streams.map((s) => s.codec_type), ['video', 'audio'], 'the voiced film has its voice');
  const level = integratedLoudness(ffmpeg, out);
  assert.ok(Math.abs(report.audio.lufs - level.lufs) < 0.05 && Math.abs(report.audio.truePeakDb - level.truePeak) < 0.05);
  assert.equal(report.audio.note, null);
  assert.ok(Math.abs(level.lufs - PRO.loudness.lufs) <= 1, `${level.lufs} LUFS`);
  assert.deepEqual(readdirSync(path.dirname(out)).filter((name) => name.includes('.partial-')), [], 'no partial file is left');

  const silent = { version: 2, mode: 'pro', shots: [{ id: 'hook', show: 'statement', say: 'Every chart is a question.' }] };
  const quiet = path.join(dir, 'make-silent', 'film.mp4');
  const plain = await runMake({ specPath: filmFile('silent', silent), out: quiet, exact: false, noRender: false, outline: false });
  assert.equal(plain.exitCode, 0, JSON.stringify(plain.report.error ?? plain.report.findings));
  assert.equal(plain.report.audio, null);
  assert.deepEqual(probe(quiet).streams.map((s) => s.codec_type), ['video']);
});

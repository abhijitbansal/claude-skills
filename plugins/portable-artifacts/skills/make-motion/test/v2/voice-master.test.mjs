// The voice put into the film (scripts/v2/voice/master.mjs): each shot's narration placed where the timeline says,
// emphasis and asides shaped in film time, the track mastered to the mode's loudness with one static gain (a limiter
// first only when the peaks demand it), and muxed into the MP4 without touching the video. No speech model anywhere: the WAVs are clicks and tone bursts made here.
// Tests that need ffmpeg (or a browser) skip without them (PA_REQUIRE_BROWSER=1 makes that a failure).
// Run with --test-concurrency=1.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HERE, browserAvailable, ffmpegOrNull } from './helpers/session.mjs';
import { registries } from '../../engine/registry.mjs';
import { buildTimeline, narrationStart } from '../../engine/script/timing.mjs';
import { parseSay } from '../../engine/script/say.mjs';
import {
  LEVELS, RAMP_SECONDS, VOICE_RATE, TRACK_RATE, AAC_AUDIO, gainStages, shapingFilter, masterArgs, masterVoice, voiceTrackArgs, muxArgs, masterTrack, muxVoice,
  judgeLevel, measureFile, AUDIO_HINT, MASTER_AIM_LU, mixArgs, recordingInput, encodeArgs, encodeMaster, ceilingFor,
} from '../../scripts/v2/voice/master.mjs';
import * as voiceMaster from '../../scripts/v2/voice/master.mjs';
import { runMake } from '../../scripts/v2/run.mjs';
import { renderFilm } from '../../scripts/v2/render.mjs';
import { renderCues } from '../../scripts/v2/sound/synth.mjs';

const FIXTURES = path.join(HERE, '..', 'fixtures', 'voice');
const FILM = JSON.parse(readFileSync(path.join(FIXTURES, 'film-three-shots.json'), 'utf8'));
const SIDECAR = JSON.parse(readFileSync(path.join(FIXTURES, 'sidecar-three-shots.json'), 'utf8'));
const FPS = 30;
const PRO = registries.modes.get('pro');
const VIRAL = registries.modes.get('viral');
const TIMELINE = buildTimeline(FILM, { fps: FPS, words: SIDECAR.shots });
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

// The case of version 1's test/loudness.test.mjs, which held ceilingFor until it moved here (cut-over plan, Task 1).
test('ceilingFor aims 0.5 dB under the true peak, so the AAC encode cannot push the file over it, and rounds to hundredths', () => {
  assert.deepEqual([-1, -1.5, 0, -3, -1.3].map(ceilingFor), [-1.5, -2, -0.5, -3.5, -1.8]);
  assert.equal(ceilingFor(-1.23456), -1.73, 'two decimals, not float noise');
});

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

// ---- the mastering arguments and the static gain ----

// An ffmpeg ebur128 summary on stderr, as a measuring pass prints it.
const ebur = (lufs, peak) => `[Parsed_ebur128_0 @ 0x1] Summary:\n\n  Integrated loudness:\n    I:         ${lufs} LUFS\n    Threshold: -40.0 LUFS\n\n  Loudness range:\n    LRA:         4.0 LU\n\n  True peak:\n    Peak:      ${peak} dBFS\n`;
const afOf = (args) => args[args.indexOf('-af') + 1];

test('masterArgs: high-pass at 80 Hz, a compressor, a de-esser, the shaping, stereo, then a measuring pass (ebur128) or the static gain; no loudnorm', () => {
  const shaping = shapingFilter(SIDECAR, TIMELINE);
  const measure = masterArgs({ wav: '/w/voice.wav', filter: shaping });
  const af = afOf(measure);
  const order = ['highpass=f=80', 'acompressor=', 'deesser=', "volume='", 'aformat=channel_layouts=stereo', 'ebur128=peak=true'].map((s) => af.indexOf(s));
  assert.ok(order.every((at, k) => at >= 0 && (k === 0 || at > order[k - 1])), af);
  assert.deepEqual(measure.slice(-3), ['-f', 'null', '-']);
  const write = masterArgs({ wav: '/w/voice.wav', out: '/w/master.wav', filter: shaping, gainDb: 11.31 });
  const af2 = afOf(write);
  assert.ok(af2.endsWith('aformat=channel_layouts=stereo,volume=11.31dB'), af2);
  assert.equal(write.at(-1), '/w/master.wav');
  assert.ok(write.join(' ').includes('-ar 48000'), 'the master is written at 48 kHz');
  for (const args of [measure, write]) assert.doesNotMatch(args.join(' '), /loudnorm/);
});

test('the limiter, when there is one, comes after the de-esser and before the shaping, so the shaping\'s levels are exact', () => {
  const af = afOf(masterArgs({ wav: '/w/v.wav', out: '/w/m.wav', filter: shapingFilter(SIDECAR, TIMELINE), drive: 10.21, loudness: PRO.loudness, gainDb: 1.9 }));
  const [deesser, limiter, shaping] = ['deesser=', 'volume=10.21dB,alimiter=limit=0.562341:level=false:latency=true', "volume='"].map((s) => af.indexOf(s));
  assert.ok(deesser < limiter && limiter < shaping && deesser >= 0, af);
});

test('every number that reaches a mastering argument goes through the formatter: a gain or a drive that is not finite is refused', () => {
  assert.throws(() => masterArgs({ wav: '/w/v.wav', out: '/w/m.wav', filter: '', gainDb: NaN }), RangeError);
  assert.throws(() => masterArgs({ wav: '/w/v.wav', filter: '', drive: Infinity, loudness: PRO.loudness }), RangeError);
  assert.throws(() => voiceTrackArgs({ shots: [{ wav: '/v/a.wav' }], timeline: { duration: 2, shots: [{ start: NaN }] }, out: '/v/t.wav' }), RangeError);
});

test('input metadata never reaches a measurement: the track and both passes drop it', () => {
  const track = voiceTrackArgs({ shots: [{ wav: '/v/shot-0.wav' }], timeline: TIMELINE_AT(0), out: '/v/t.wav' });
  const measure = masterArgs({ wav: '/w/v.wav', filter: '' });
  const write = masterArgs({ wav: '/w/v.wav', out: '/w/m.wav', filter: '', gainDb: 3 });
  for (const args of [track, measure, write]) assert.ok(args.join(' ').includes('-map_metadata -1'), args.join(' '));
});

test('no film string reaches an argument: a word text with a quote and a filter separator is never written', () => {
  const evil = "x';volume=99:'\"[a]";
  const film = { mode: 'pro', shots: [{ id: "a';b", say: `Say *${evil}* now.` }] };
  const words = [{ text: 'Say', start: 0.1, end: 0.3, emphasis: false, aside: false }, { text: evil, start: 0.35, end: 0.6, emphasis: true, aside: false }, { text: 'now.', start: 0.65, end: 0.9, emphasis: false, aside: false }];
  const sidecar = { version: 1, sampleRate: VOICE_RATE, shots: [{ id: "a';b", wav: 'shot-0.wav', seconds: 1, sentences: [{ start: 0.1, end: 0.9, words }] }] };
  const timeline = { fps: FPS, duration: 2, shots: [{ id: "a';b", start: 0.5 }] };
  const filter = shapingFilter(sidecar, timeline);
  const all = [
    ...masterArgs({ wav: '/w/v.wav', filter }),
    ...masterArgs({ wav: '/w/v.wav', out: '/w/m.wav', filter, gainDb: 4, drive: 2, loudness: PRO.loudness }),
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
const master = (run) => masterVoice({ run, wav: '/w/v.wav', out: '/w/m.wav', filter: '', loudness: PRO.loudness });

test('masterVoice measures, then writes the master with one static gain: the target minus the measured loudness', async () => {
  const { run, calls } = fakeRunner([ebur(-27.3, -19.8), '']);
  assert.deepEqual(await master(run), { gainDb: 11.3, limited: false, measured: true });
  assert.equal(calls.length, 2);
  assert.match(calls[0].join(' '), /ebur128=peak=true/);
  assert.ok(afOf(calls[1]).endsWith('volume=11.30dB'), afOf(calls[1]));
  assert.doesNotMatch(calls[1].join(' '), /alimiter/);
});

test('the gain is capped so the measured true peak stays at the ceiling; a cap of 0.5 LU (MASTER_AIM_LU) or less takes no limiter', async () => {
  assert.equal(MASTER_AIM_LU, 0.5);
  const { run, calls } = fakeRunner([ebur(-20.0, -5.5), '']);
  const result = await master(run);
  assert.deepEqual(result, { gainDb: 3.5, limited: false, measured: true }, 'want +4 dB, the peak allows +3.5 (ceiling -2 dBTP): 0.5 LU under is accepted');
  assert.equal(calls.length, 2);
});

test('a cap that would leave the result more than 0.5 LU under the target takes the limiter, driven first by the whole wanted gain, measured again', async () => {
  const { run, calls } = fakeRunner([ebur(-27.3, -3.1), ebur(-17.9, -5.0), '']);
  const result = await master(run);
  assert.deepEqual(result, { gainDb: 1.9, limited: true, measured: true });
  assert.equal(calls.length, 3);
  assert.match(afOf(calls[1]), /volume=11\.30dB,alimiter=limit=0\.562341:level=false:latency=true,.*ebur128=peak=true/, 'driven by the wanted gain, 11.3 dB, so the limiter is sure to engage');
  assert.match(afOf(calls[2]), /alimiter=.*volume=1\.90dB$/);
  const small = fakeRunner([ebur(-20.0, -5.0), ebur(-16.6, -2.2), '']);
  assert.deepEqual(await master(small.run), { gainDb: 0.2, limited: true, measured: true }, 'a 1 LU shortfall now takes the limiter too');
  assert.match(afOf(small.calls[1]), /volume=4\.00dB,alimiter=/);
});

test('the limiter runs at most three rounds; what is then still short is written and left to the level judgement', async () => {
  const { run, calls } = fakeRunner([ebur(-27, -3), ebur(-27, -3), ebur(-27, -3), ebur(-27, -3), '']);
  const result = await master(run);
  assert.equal(result.limited, true);
  assert.equal(calls.length, 5, 'one measure, three limiter measures, one write');
});

test('a silent track (nothing above the -70 gate) is refused with a hint about the voice, not the generic ffmpeg hint', async () => {
  for (const stderr of [ebur(-70.0, '-inf'), ebur(-70.0, -75.0)]) {
    await assert.rejects(master(fakeRunner([stderr]).run), (err) => /silent/.test(err.message) && /\.voice/.test(err.hint) && err.hint !== AUDIO_HINT);
  }
});

test('an audible track too short to measure (peak over the gate, no integrated loudness) is written with no gain, not failed', async () => {
  const { run, calls } = fakeRunner([ebur(-70.0, -50.0), '']);
  assert.deepEqual(await master(run), { gainDb: 0, limited: false, measured: false });
  assert.equal(calls.length, 2);
  assert.ok(afOf(calls[1]).endsWith('volume=0.00dB'), afOf(calls[1]));
});

test('masterVoice fails with ffmpeg\'s own words and the ffmpeg hint when a pass fails or prints no measurement', async () => {
  const failing = async () => ({ code: 1, stderr: 'line one\nNo such filter: deesser\n' });
  await assert.rejects(master(failing), (err) => /ffmpeg failed \(exit 1\): No such filter: deesser/.test(err.message) && err.hint === AUDIO_HINT);
  await assert.rejects(master(async () => ({ code: 0, stderr: 'nothing\n' })), /no loudness measurement/);
});

test('judgeLevel: more than 1 LU from the target or a true peak over the ceiling is refused with a hint the author can act on, never "run again"', () => {
  const ok = { lufs: -16.6, truePeakDb: -2.1, note: null };
  assert.deepEqual(judgeLevel(ok, PRO.loudness), ok);
  const refusals = [
    [{ ...ok, lufs: -17.2 }, /-17\.2 LUFS.*1 LU.*-16/],
    [{ ...ok, lufs: -14.8 }, /-14\.8 LUFS/],
    [{ ...ok, truePeakDb: -1.2 }, /true peak of -1\.2 dBTP.*-1\.5/],
  ];
  for (const [audio, message] of refusals) {
    assert.throws(() => judgeLevel(audio, PRO.loudness), (err) => message.test(err.message) && err.hint.length > 0 && !/run again/.test(err.hint) && err.hint !== AUDIO_HINT);
  }
  const short = { lufs: null, truePeakDb: -40, note: 'x' };
  assert.deepEqual(judgeLevel(short, PRO.loudness), short);
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

// A run for encodeMaster that answers each measurement with the next of `levels` ([lufs, truePeak]) and records the gain of
// each encode (0 when it has none).
function encodeRun(levels) {
  const gains = [];
  let k = 0;
  const run = async (args) => {
    if (args.includes('null')) {
      const [lufs, peak] = levels[Math.min(k++, levels.length - 1)];
      return { code: 0, stderr: `  I:         ${lufs} LUFS\n  True peak:\n    Peak:      ${peak} dBFS\n` };
    }
    const af = args.indexOf('-af');
    gains.push(af < 0 ? 0 : Number(/volume=(-?[\d.]+)dB/.exec(args[af + 1])[1]));
    return { code: 0, stderr: '' };
  };
  return { run, gains };
}

test('encodeMaster re-encodes at most twice, each time adding what the last encode fell short (final review I3)', async () => {
  const { run, gains } = encodeRun([[-17, -10], [-15, -8], [-15, -6], [-15, -4]]); // viral: -14 LUFS, ceiling -1, so -1.5 for the raise
  const encoded = await encodeMaster({ run, master: '/w/m.wav', out: '/w/m.m4a', duration: 4, loudness: VIRAL.loudness });
  assert.deepEqual(gains, [0, 3, 4], 'the first encode, then +3 dB, then +1 more; no third re-encode');
  assert.deepEqual([encoded.gainDb, encoded.level.lufs], [4, -15]);
});

test('encodeMaster raises an encode only as far as the true peak allows, and not at all on the ceiling (final review I3)', async () => {
  const capped = encodeRun([[-17, -2.5], [-16, -1.5]]);
  const raised = await encodeMaster({ run: capped.run, master: '/w/m.wav', out: '/w/m.m4a', duration: 4, loudness: VIRAL.loudness });
  assert.deepEqual(capped.gains, [0, 1], '3 LU short, but the peak has 1 dB of room under ceilingFor(-1) = -1.5');
  assert.equal(raised.gainDb, 1);
  const onCeiling = encodeRun([[-17, -1.5]]);
  assert.equal((await encodeMaster({ run: onCeiling.run, master: '/w/m.wav', out: '/w/m.m4a', duration: 4, loudness: VIRAL.loudness })).gainDb, 0);
  assert.deepEqual(onCeiling.gains, [0], 'no room: no re-encode');
});

test('encodeMaster pulls an encode over the mode\'s ceiling back to ceilingFor, and never returns it over (kinds-pop: +0.3 dBTP)', async () => {
  const once = encodeRun([[-14.1, 0.3], [-14.6, -1.5]]); // viral: ceiling -1, ceilingFor(-1) = -1.5
  const held = await encodeMaster({ run: once.run, master: '/w/m.wav', out: '/w/m.m4a', duration: 4, loudness: VIRAL.loudness });
  assert.deepEqual(once.gains, [0, -1.8], 'lowered by the true peak over ceilingFor: 0.3 - (-1.5)');
  assert.deepEqual([held.gainDb, held.level.truePeakDb, held.held], [-1.8, -1.5, true]);
  const twice = encodeRun([[-14.1, 0.3], [-14.4, -0.6], [-14.6, -1.5]]);
  const again = await encodeMaster({ run: twice.run, master: '/w/m.wav', out: '/w/m.m4a', duration: 4, loudness: VIRAL.loudness });
  assert.deepEqual(twice.gains, [0, -1.8, -2.7], 'still over after the first hold: lowered again from where it landed');
  assert.ok(again.level.truePeakDb <= VIRAL.loudness.truePeakDb);
  const raisedOver = encodeRun([[-15.5, -3], [-14, -0.5], [-14.4, -1.5]]);
  const back = await encodeMaster({ run: raisedOver.run, master: '/w/m.wav', out: '/w/m.m4a', duration: 4, loudness: VIRAL.loudness });
  assert.deepEqual(raisedOver.gains, [0, 1.5, 0.5], 'a raise that lands over the ceiling is held back, and not raised again');
  assert.equal(back.held, true);
  const clean = encodeRun([[-14.1, -2]]);
  assert.equal((await encodeMaster({ run: clean.run, master: '/w/m.wav', out: '/w/m.m4a', duration: 4, loudness: VIRAL.loudness })).held, false);
});

test('judgeLevel: an encode held at the ceiling that falls short of the target renders with HELD_NOTE; over the ceiling is still refused', () => {
  const short = { lufs: -15.9, truePeakDb: -1.5, note: null };
  assert.throws(() => judgeLevel(short, VIRAL.loudness), /more than 1 LU under/, 'not held: short is refused as before');
  // held from an on-target encode (branch review A, I5: the cause is carried, a bare `held: true` excuses nothing)
  const heldFrom = { lufs: -14.1, truePeakDb: 0.3, note: null };
  assert.deepEqual(judgeLevel(short, VIRAL.loudness, undefined, { heldFrom }), { ...short, note: voiceMaster.HELD_NOTE });
  assert.equal(typeof voiceMaster.HELD_NOTE, 'string');
  assert.deepEqual(judgeLevel({ ...short, lufs: -14.4 }, VIRAL.loudness, undefined, { heldFrom }), { ...short, lufs: -14.4 }, 'within tolerance: no note');
  assert.throws(() => judgeLevel({ ...short, truePeakDb: -0.5 }, VIRAL.loudness, undefined, { heldFrom }), /true peak of -0\.5 dBTP, over the mode's ceiling/);
});

test('encodeArgs encodes the master WAV as AAC 48 kHz at 160 kbit/s, audio only, capped at the film length; muxArgs copies it and the video (final review I3)', () => {
  assert.deepEqual(AAC_AUDIO, ['-c:a', 'aac', '-b:a', '160k', '-aac_pns', '0', '-ar', '48000', '-ac', '2']);
  const encode = encodeArgs({ master: '/w/m.wav', out: '/w/m.m4a', duration: 8.4 }).join(' ');
  assert.match(encode, /-protocol_whitelist file -format_whitelist wav -f wav -i \/w\/m\.wav -map 0:a:0 .*-c:a aac -b:a 160k -aac_pns 0 -ar 48000 -ac 2 -t 8\.4000 -f mp4 \/w\/m\.m4a$/);
  assert.match(encodeArgs({ master: '/w/m.wav', out: '/w/m.m4a', duration: 8.4, gainDb: 1.6 }).join(' '), /-af volume=1\.60dB -c:a aac/);
  const args = muxArgs({ video: '/o/v.mp4', audio: '/w/m.m4a', out: '/o/f.mp4', duration: 8.4 });
  const joined = args.join(' ');
  assert.match(joined, /-format_whitelist mov,mp4,m4a -f mov -i \/o\/v\.mp4 -protocol_whitelist file -format_whitelist mov,mp4,m4a -f mov -i \/w\/m\.m4a/, 'our own MP4s, opened as MP4 only (V5)');
  assert.match(joined, /-map 0:v:0 -map 1:a:0 -c:v copy -c:a copy/);
  assert.match(joined, /-t 8\.4000/);
  assert.equal(args.at(-1), '/o/f.mp4');
});

// ---- with ffmpeg: alignment, shaping in film time, mastering and the mux ----

const needFfmpeg = async (t) => {
  const ffmpeg = await ffmpegOrNull();
  if (!ffmpeg) t.skip('no ffmpeg');
  return ffmpeg;
};

// Transient-rich sound: faint hiss under short loud noise bursts, from a seeded generator. Frames like these are where the
// native AAC encoder's perceptual noise substitution (PNS) puts its own noise, independently in each channel, and
// kinds-pop's encode (dual mono, -3.2 dBTP) came out at +0.3 dBTP with one channel mangled at 4.20 s.
function hissBursts(seed, { hiss, burst, burstSamples }) {
  let state = seed;
  const noise = () => { state = (state * 1103515245 + 12345) % 2147483648; return state / 1073741824 - 1; };
  return Float32Array.from({ length: 4 * TRACK_RATE }, (_, i) => hiss * noise() + (i % 9000 < burstSamples ? burst * noise() : 0));
}
// `samples` as a 48 kHz 16-bit stereo WAV with the same samples in both channels: the shape of a mastered voice.
function writeDualMonoWav(ffmpeg, file, samples) {
  const mono = path.join(path.dirname(file), `.mono-${path.basename(file)}`);
  writeWav(mono, samples, TRACK_RATE);
  const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', mono, '-ac', '2', '-c:a', 'pcm_s16le', file], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
}
const BURSTS = [{ hiss: 0.02, burst: 0.4, burstSamples: 400 }, { hiss: 0.025, burst: 0.3, burstSamples: 200 }];
const BURST_SEEDS = Array.from({ length: 10 }, (_, k) => 1 + 7 * k);
const AAC_ROOM_DB = VIRAL.loudness.truePeakDb - ceilingFor(VIRAL.loudness.truePeakDb); // 0.5 dB: what ceilingFor leaves the encode

test('the AAC encode adds at most ceilingFor\'s 0.5 dB to the true peak of transient-rich sound (PNS off; with it, kinds-pop gained 3.5 dB)', async (t) => {
  const ffmpeg = await needFfmpeg(t);
  if (!ffmpeg) return;
  const run = realRun(ffmpeg);
  const work = path.join(dir, 'aac-overshoot');
  mkdirSync(work, { recursive: true });
  const overshoots = [];
  for (const [k, shape] of BURSTS.entries()) {
    for (const seed of BURST_SEEDS) {
      const wav = path.join(work, `bursts-${k}-${seed}.wav`);
      writeDualMonoWav(ffmpeg, wav, hissBursts(seed, shape));
      const encoded = path.join(work, `bursts-${k}-${seed}.m4a`);
      assert.equal((await run(encodeArgs({ master: wav, out: encoded, duration: 4 }))).code, 0);
      const [source, aac] = [await measureFile({ run, file: wav }), await measureFile({ run, file: encoded })];
      overshoots.push({ k, seed, db: Math.round((aac.truePeakDb - source.truePeakDb) * 10) / 10 });
    }
  }
  const worst = overshoots.reduce((a, b) => (b.db > a.db ? b : a));
  t.diagnostic(`worst AAC overshoot ${worst.db} dB (shape ${worst.k}, seed ${worst.seed}) over ${overshoots.length} encodes`);
  assert.ok(worst.db <= AAC_ROOM_DB, `the encode added ${worst.db} dB to shape ${worst.k} seed ${worst.seed}: more than the ${AAC_ROOM_DB} dB ceilingFor leaves`);
});

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

// When each word is heard in the film: its shot's narration start on the timeline plus its time in the sidecar. (The
// timeline's own words are what the picture shows; a shot's first word is shown from the shot's first frame.)
const filmStarts = (timeline, sidecar) => timeline.shots.flatMap((shot, i) => flatWords(sidecar.shots[i]).map((w) => narrationStart(shot) + w.start));

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
  const expected = filmStarts(timeline, sidecar);
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
  await muxVoice({ run, video, audio: (await encodeMaster({ run, master, out: path.join(work, 'sound.m4a'), duration: timeline.duration, loudness: PRO.loudness })).file, out, duration: timeline.duration });
  const decoded = path.join(work, 'decoded.wav');
  const r = ffmpegRun(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', out, '-map', '0:a:0', '-ac', '1', '-ar', String(TRACK_RATE), '-c:a', 'pcm_s16le', decoded]);
  assert.equal(r.status, 0, r.stderr);
  const { samples, rate } = readWav(decoded);
  const peak = samples.reduce((m, s) => Math.max(m, Math.abs(s)), 0);
  // 5% of the peak: the gaps between bursts are silent, and a higher threshold is crossed partway up a burst's first
  // cycle (half the peak read 3.5 ms late on one word: the detector's bias, not the track's).
  const worst = assertClicksAt(onsets(samples, rate, peak * ONSET_FRACTION), filmStarts(timeline, sidecar), ALIGN_TOLERANCE);
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

// A quiet steady tone (-30 dBFS RMS) with full-scale 2 ms pops, kept at least POP_CLEARANCE from the shaped words and the
// reference window: the gain to the target would push the pops over the ceiling, so the limiter runs.
const QUIET_TONE_PEAK = Math.SQRT2 * 10 ** (-30 / 20);
const POP_CLEARANCE = 0.6;
const POP_STEP = 0.25;
const POP_SECONDS = 0.002;
const REFERENCE = Object.freeze({ start: 0.3, end: 0.6 });

function poppyTone() {
  const samples = toneOf(QUIET_TONE_PEAK, TIMELINE.duration);
  const { emphasis, aside } = shapedWords();
  const clear = (t) => [emphasis, aside, REFERENCE].every((w) => t < w.start - POP_CLEARANCE || t > w.end + POP_CLEARANCE);
  for (let t = 0.05; t < TIMELINE.duration - 0.05; t += POP_STEP) {
    if (!clear(t)) continue;
    for (let i = 0; i < POP_SECONDS * TRACK_RATE; i++) samples[Math.round(t * TRACK_RATE) + i] = 0.99;
  }
  return samples;
}

test('through the limiter branch too, the emphasis lift and aside cut are exact (+2 / -3 dB), and the master lands within 1 LU of the target', async (t) => {
  const ffmpeg = await needFfmpeg(t);
  if (!ffmpeg) return;
  const work = path.join(dir, 'levels-limited');
  mkdirSync(work, { recursive: true });
  const wav = path.join(work, 'track.wav');
  const out = path.join(work, 'master.wav');
  writeWav(wav, poppyTone(), TRACK_RATE);
  const run = realRun(ffmpeg);
  const result = await masterVoice({ run, wav, out, filter: shapingFilter(SIDECAR, TIMELINE), loudness: PRO.loudness });
  assert.equal(result.limited, true, 'the pops take the limiter');
  const { samples, rate } = readWav(out);
  const base = rms(samples, rate, REFERENCE.start, REFERENCE.end);
  const { emphasis, aside } = shapedWords();
  const inside = (s) => db(rms(samples, rate, s.start + 0.01, s.end - 0.01) / base);
  assert.ok(Math.abs(inside(emphasis) - LEVELS.emphasisDb) <= LEVEL_TOLERANCE_DB, `emphasis ${inside(emphasis).toFixed(2)} dB`);
  assert.ok(Math.abs(inside(aside) - LEVELS.asideDb) <= LEVEL_TOLERANCE_DB, `aside ${inside(aside).toFixed(2)} dB`);
  const level = await measureFile({ run, file: out });
  assert.ok(Math.abs(level.lufs - PRO.loudness.lufs) <= 1, `${level.lufs} LUFS`);
  assert.deepEqual(judgeLevel(level, PRO.loudness), level);
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
  const audio = await muxVoice({ run, video, audio: (await encodeMaster({ run, master, out: path.join(work, 'sound.m4a'), duration: TIMELINE.duration, loudness: PRO.loudness })).file, out, duration: TIMELINE.duration });
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

// The shot WAVs of `sidecar`, each made by `fill(seconds) -> Float32Array` at the voice rate.
function writeShotWavs(voiceDir, sidecar, fill) {
  mkdirSync(voiceDir, { recursive: true });
  for (const shot of sidecar.shots.filter((s) => s.wav !== null)) writeWav(path.join(voiceDir, shot.wav), fill(shot.seconds));
}

// Deterministic speech-like noise: white noise (a fixed linear congruential sequence) in 3 Hz syllables.
function speechLike(seconds, amplitude = 0.2) {
  let state = 12345;
  const noise = () => { state = (state * 1103515245 + 12345) % 2147483648; return state / 1073741824 - 1; };
  return Float32Array.from({ length: Math.round(seconds * VOICE_RATE) }, (_, i) => amplitude * Math.abs(Math.sin(Math.PI * 3 * (i / VOICE_RATE))) * noise());
}

// The review's case B1: one short narrated line, then a long held shot; the film is over 3 s.
const SHORT_LINE_FILM = { version: 2, mode: 'pro', shots: [
  { id: 'line', show: 'statement', say: 'Ready now?' },
  { id: 'rest', show: 'statement', cut: 'cut', hold: 4 },
] };

test('a film of more than 3 s whose narration is one short line masters to its target (the review\'s B1, refused before)', async (t) => {
  const ffmpeg = await needFfmpeg(t);
  if (!ffmpeg) return;
  const work = path.join(dir, 'short-line');
  const voiceDir = path.join(work, 'voice');
  const sidecar = fakeSidecar(SHORT_LINE_FILM);
  writeShotWavs(voiceDir, sidecar, (seconds) => speechLike(seconds));
  const timeline = buildTimeline(SHORT_LINE_FILM, { fps: FPS, words: sidecar.shots });
  assert.ok(timeline.duration > 3 && sidecar.shots[0].seconds < 1.2, `a ${timeline.duration} s film, ${sidecar.shots[0].seconds} s of narration`);
  const run = realRun(ffmpeg);
  const master = await masterTrack({ run, voice: { dir: voiceDir, sidecar }, timeline, loudness: PRO.loudness, workDir: work });
  const level = await measureFile({ run, file: master });
  assert.ok(Math.abs(level.lufs - PRO.loudness.lufs) <= 1, `${level.lufs} LUFS`);
  assert.deepEqual(judgeLevel(level, PRO.loudness), level);
});

test('a silent narration (nothing above the -70 gate) is refused as machine trouble with a hint about the voice, never muxed', async (t) => {
  const ffmpeg = await needFfmpeg(t);
  if (!ffmpeg) return;
  const work = path.join(dir, 'silent');
  const voiceDir = path.join(work, 'voice');
  const sidecar = fakeSidecar(ALIGN_FILM);
  writeShotWavs(voiceDir, sidecar, (seconds) => new Float32Array(Math.round(seconds * VOICE_RATE)));
  const timeline = buildTimeline(ALIGN_FILM, { fps: FPS, words: sidecar.shots });
  await assert.rejects(masterTrack({ run: realRun(ffmpeg), voice: { dir: voiceDir, sidecar }, timeline, loudness: PRO.loudness, workDir: work }),
    (err) => /silent/.test(err.message) && /\.voice/.test(err.hint));
});

// One 30 ms burst at -62 dBFS peak: over the -70 gate, but too little energy in any 400 ms block for an integrated value.
const SHORT_BURST = Object.freeze({ seconds: 0.03, peak: 10 ** (-62 / 20), hz: 1000 });

test('an audible narration too short to measure is muxed, not failed: audio.lufs null with a note, and judgeLevel lets it through', async (t) => {
  const ffmpeg = await needFfmpeg(t);
  if (!ffmpeg) return;
  const work = path.join(dir, 'short-burst');
  const voiceDir = path.join(work, 'voice');
  const sidecar = fakeSidecar(ALIGN_FILM);
  writeShotWavs(voiceDir, sidecar, (seconds) => Float32Array.from({ length: Math.round(seconds * VOICE_RATE) },
    (_, i) => (i < SHORT_BURST.seconds * VOICE_RATE ? SHORT_BURST.peak * Math.sin((2 * Math.PI * SHORT_BURST.hz * i) / VOICE_RATE) : 0)));
  const timeline = buildTimeline(ALIGN_FILM, { fps: FPS, words: sidecar.shots });
  const run = realRun(ffmpeg);
  const master = await masterTrack({ run, voice: { dir: voiceDir, sidecar }, timeline, loudness: PRO.loudness, workDir: work });
  const out = path.join(work, 'film.mp4');
  const audio = await muxVoice({ run, video: testVideo(ffmpeg, work, timeline.duration), audio: (await encodeMaster({ run, master, out: path.join(work, 'sound.m4a'), duration: timeline.duration, loudness: PRO.loudness })).file, out, duration: timeline.duration });
  assert.equal(audio.lufs, null);
  assert.match(audio.note, /too short/);
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

test('masterTrack with neither a voice nor cues nor music resolves null without running ffmpeg: there is nothing to master', async () => {
  const master = await masterTrack({ run: async () => assert.fail('ffmpeg must not run'), timeline: TIMELINE_AT(0), loudness: PRO.loudness, workDir: '/w' });
  assert.equal(master, null);
});

test('renderFilm fails fast on cues ffmpeg cannot read: before any frame is captured, with ffmpeg\'s words and a hint, and leaves no file', async (t) => {
  if (!await needFfmpeg(t)) return;
  const page = { evaluate: () => assert.fail('no frame may be captured'), screenshot: () => assert.fail('no frame may be captured') };
  const session = { film: { mode: 'viral', shots: [] }, timeline: TIMELINE, info: { post: '2d' }, page };
  const out = path.join(dir, 'broken-cues', 'film.mp4');
  const sound = { cues: { file: path.join(dir, 'no-such-cues.wav'), count: 2 }, music: null };
  await assert.rejects(renderFilm({ out, session, sound }), (err) => /^sound master: ffmpeg failed \(exit \d+\)/.test(err.message) && err.hint.length > 0);
  assert.deepEqual(readdirSync(path.dirname(out)), [], 'no output and no partial file');
});

test('a voiced film with no narrated shot and sparse cues is judged as a film with no voice: raised to the ceiling, not refused as a peaky narration (final review)', async (t) => {
  const ffmpeg = await needFfmpeg(t);
  if (!ffmpeg) return;
  const seconds = 12;
  const work = path.join(dir, 'no-narration');
  mkdirSync(work, { recursive: true });
  const cues = await renderCues([{ t: 3, cue: 'click', gainDb: -12, pan: 0 }, { t: 8, cue: 'pop', gainDb: -12, pan: 0 }], { seconds, seed: 1, out: path.join(work, 'cues.wav') });
  const captured = new Error('a frame was asked for: the level was accepted');
  const page = { evaluate: () => { throw captured; }, screenshot: () => { throw captured; } };
  const timeline = { fps: FPS, duration: seconds, frameCount: seconds * FPS, shots: [{ id: 'a', index: 0, start: 0, end: seconds, duration: seconds, words: [], sentences: [] }] };
  const session = { film: { mode: 'viral', voice: { name: 'af_heart' }, shots: [{ id: 'a', show: 'statement' }] }, timeline, info: { post: '2d' }, page };
  const voice = { dir: work, sidecar: { shots: [{ id: 'a', wav: null, seconds: 0, sentences: [] }] } };
  const err = await renderFilm({ out: path.join(work, 'out', 'film.mp4'), session, voice, sound: { cues: { file: cues.file, count: 2 }, music: null } }).then(() => null, (e) => e);
  assert.equal(err, captured, `refused before capture: ${err?.message}`);
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

test('renderFilm judges the mastered level before any frame is captured: a narration that cannot reach its target is refused, with what to change', async (t) => {
  const ffmpeg = await needFfmpeg(t);
  if (!ffmpeg) return;
  const voiceDir = path.join(dir, 'off-target-voice');
  const sidecar = fakeSidecar(ALIGN_FILM);
  writeClickWavs(voiceDir, sidecar); // 5 ms clicks in silence: too peaky to reach -16 LUFS under -1.5 dBTP in three limiter rounds
  const timeline = buildTimeline(ALIGN_FILM, { fps: FPS, words: sidecar.shots });
  const page = { evaluate: () => assert.fail('no frame may be captured'), screenshot: () => assert.fail('no frame may be captured') };
  const session = { film: { ...ALIGN_FILM, voice: { name: 'af_heart' } }, timeline, info: { post: '2d' }, page };
  const out = path.join(dir, 'off-target', 'film.mp4');
  const err = await renderFilm({ out, session, voice: { dir: voiceDir, sidecar } }).then(() => null, (e) => e);
  assert.ok(err !== null, 'the render must be refused');
  assert.match(err.message, /^voice loudness: the mastered narration measures -?[\d.]+ LUFS, more than 1 LU under/, 'judged before capture on its AAC encode, with the finished file\'s 1 LU rule (final review I3)');
  assert.match(err.hint, /loudest moments/);
  assert.doesNotMatch(err.hint, /run again/);
  t.diagnostic(err.message);
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

// ---- the voice review's fixes (final-review.md I1, I2, I3) ----

// A folder whose shot-0.wav is an ffconcat script whose one entry, seg.wav, is a symlink to a WAV outside the folder:
// the reviewer's planted cache entry. Returns the script's path.
function plantedScript(name) {
  const outside = path.join(dir, `${name}-outside`);
  const folder = path.join(dir, name);
  mkdirSync(outside, { recursive: true });
  mkdirSync(folder, { recursive: true });
  writeWav(path.join(outside, 'secret.wav'), toneOf(0.5, 2));
  symlinkSync(path.join(outside, 'secret.wav'), path.join(folder, 'seg.wav'));
  writeFileSync(path.join(folder, 'shot-0.wav'), 'ffconcat version 1.0\nfile seg.wav\n');
  return path.join(folder, 'shot-0.wav');
}

test('I1: our own WAVs (shot WAVs, the voice track, the cue track, the bed) open as WAV only; a user\'s recording or music keeps its plain-audio whitelist', () => {
  const own = ['-protocol_whitelist', 'file', '-format_whitelist', 'wav', '-f', 'wav', '-i'];
  const before = (args, file) => args.slice(args.indexOf(file) - own.length, args.indexOf(file));
  const track = voiceTrackArgs({ shots: [{ wav: '/v/shot-0.wav' }], timeline: TIMELINE_AT(0), out: '/v/t.wav' });
  assert.deepEqual(before(track, '/v/shot-0.wav'), own);
  assert.deepEqual(before(masterArgs({ wav: '/w/v.wav', filter: '' }), '/w/v.wav'), own);
  const mix = mixArgs({ voice: { wav: '/w/v.wav', filter: '' }, cues: { file: '/w/c.wav' }, music: { file: '/w/b.wav', recording: false, fadeFrom: null, duck: [] }, duration: 4, loudness: PRO.loudness });
  for (const file of ['/w/v.wav', '/w/c.wav', '/w/b.wav']) assert.deepEqual(before(mix, file), own, file);
  const theirs = mixArgs({ music: { file: '/film/track.mp3', recording: true, fadeFrom: null, duck: [] }, duration: 4, loudness: PRO.loudness });
  assert.ok(theirs.join(' ').includes(recordingInput('/film/track.mp3').join(' ')));
  const recording = voiceTrackArgs({ shots: [], timeline: TIMELINE_AT(0), out: '/v/t.wav', recording: '/film/vo.m4a' });
  assert.ok(recording.join(' ').includes(recordingInput('/film/vo.m4a').join(' ')));
});

test('I1: a shot WAV or a cue track that is an ffconcat script pointing outside the folder is refused by ffmpeg with the real arguments', async (t) => {
  const ffmpeg = await needFfmpeg(t);
  if (!ffmpeg) return;
  const script = plantedScript('planted');
  const track = ffmpegRun(ffmpeg, voiceTrackArgs({ shots: [{ wav: script }], timeline: TIMELINE_AT(0), out: path.join(dir, 'planted-track.wav') }));
  assert.notEqual(track.status, 0, 'the voice mix decoded the script, and the file outside the folder through it');
  const cues = ffmpegRun(ffmpeg, mixArgs({ cues: { file: script }, duration: 2, loudness: PRO.loudness }));
  assert.notEqual(cues.status, 0, 'the sound mix decoded the script');
});

test('I1: a shot WAV that is a symlink (to a file outside the folder, or anywhere) is refused before ffmpeg runs', async () => {
  const outside = path.join(dir, 'linked-outside');
  const voiceDir = path.join(dir, 'linked-voice');
  mkdirSync(outside, { recursive: true });
  mkdirSync(voiceDir, { recursive: true });
  writeWav(path.join(outside, 'secret.wav'), toneOf(0.5, 1));
  symlinkSync(path.join(outside, 'secret.wav'), path.join(voiceDir, 'shot-0.wav'));
  const sidecar = { version: 1, sampleRate: VOICE_RATE, shots: [{ id: 'a', wav: 'shot-0.wav', seconds: 1, sentences: [] }] };
  await assert.rejects(masterTrack({ run: async () => assert.fail('ffmpeg must not run'), voice: { dir: voiceDir, sidecar }, timeline: TIMELINE_AT(0), loudness: PRO.loudness, workDir: dir }),
    (err) => /shot-0\.wav.*not a regular file/.test(err.message) && err.hint.length > 0);
});

// The review's quiet track: 1 kHz bursts at 0.05 (0.25 s on, 0.25 s off) for 8 s, with one 30 ms burst at `peak` at 4 s.
function quietWithPeak(peak, seconds = 8) {
  return Float32Array.from({ length: Math.round(seconds * TRACK_RATE) }, (_, i) => {
    const t = i / TRACK_RATE;
    const level = t >= 4 && t < 4.03 ? peak : (t % 0.5 < 0.25 ? 0.05 : 0);
    return level * Math.sin(2 * Math.PI * 1000 * t);
  });
}

// The first pass's shortfall of a track at `wav`: the gain wanted minus the gain the ceiling allows (pro).
function shortfall(ffmpeg, wav) {
  const r = ffmpegRun(ffmpeg, masterArgs({ wav, filter: '' }));
  const lufs = Number([...r.stderr.matchAll(/\bI:\s+(-?[\d.]+) LUFS/g)].at(-1)[1]);
  const peak = Number([...r.stderr.matchAll(/True peak:\s+Peak:\s+(-?[\d.]+) dBFS/g)].at(-1)[1]);
  return (PRO.loudness.lufs - lufs) - (ceilingFor(PRO.loudness.truePeakDb) - peak);
}

// [the review's shortfall, the burst that makes it on this track]: measured with .scratch/sound/i2-shortfall.mjs
// (0.18 gives 0.5 LU, 0.19 1.0, 0.22 2.1, 0.3 4.6)
const I2_CASES = [[0.6, 0.182], [1.2, 0.195], [2.0, 0.22], [5, 0.31]];

test('I2: a quiet track with one loud moment masters within 0.5 LU of the target, whatever its shortfall (about 0.6, 1.2, 2.0 and 5 LU)', async (t) => {
  const ffmpeg = await needFfmpeg(t);
  if (!ffmpeg) return;
  const work = path.join(dir, 'i2');
  mkdirSync(work, { recursive: true });
  const run = realRun(ffmpeg);
  for (const [wanted, peak] of I2_CASES) {
    const wav = path.join(work, `quiet-${peak}.wav`);
    const out = path.join(work, `master-${peak}.wav`);
    writeWav(wav, quietWithPeak(peak), TRACK_RATE);
    const short = shortfall(ffmpeg, wav);
    t.diagnostic(`burst ${peak}: first-pass shortfall ${short.toFixed(2)} LU (the review's case: ${wanted})`);
    assert.ok(Math.abs(short - wanted) <= Math.max(0.4, wanted * 0.3), `burst ${peak} makes a ${short.toFixed(2)} LU shortfall, not about ${wanted}`);
    await masterVoice({ run, wav, out, filter: '', loudness: PRO.loudness });
    const level = await measureFile({ run, file: out });
    assert.ok(Math.abs(level.lufs - PRO.loudness.lufs) <= MASTER_AIM_LU, `burst ${peak}: master at ${level.lufs} LUFS`);
    assert.deepEqual(judgeLevel(level, PRO.loudness, 'the master', { tolerance: MASTER_AIM_LU }), level);
  }
});

test('I3: the before-capture judgement uses the master\'s 0.5 LU aim; the finished file keeps the 1 LU tolerance', () => {
  const at = (lufs) => ({ lufs, truePeakDb: -3, note: null });
  assert.throws(() => judgeLevel(at(-16.7), PRO.loudness, 'the mastered narration', { tolerance: MASTER_AIM_LU }), /measures -16\.7 LUFS, more than 0\.5 LU under/);
  assert.deepEqual(judgeLevel(at(-16.7), PRO.loudness), at(-16.7), 'the finished file may be 0.7 LU off');
  assert.deepEqual(judgeLevel(at(-16.4), PRO.loudness, 'the mastered narration', { tolerance: MASTER_AIM_LU }), at(-16.4));
});

// Speech-like noise (speechLike) low-passed at about 6 kHz, as a voice has little above it: the review's noise voice,
// without the energy above AAC's own low-pass that no narration has.
function speechBand(seconds) {
  const raw = speechLike(seconds, 0.3);
  const a = 1 - Math.exp((-2 * Math.PI * 6000) / VOICE_RATE);
  let low = 0;
  return raw.map((x) => (low += a * (x - low)));
}

test('I3: a noise-like voice judged as its AAC encode before capture is judged the same after the mux', async (t) => {
  const ffmpeg = await needFfmpeg(t);
  if (!ffmpeg) return;
  const work = path.join(dir, 'i3');
  const voiceDir = path.join(work, 'voice');
  writeShotWavs(voiceDir, SIDECAR, (seconds) => speechBand(seconds));
  const run = realRun(ffmpeg);
  const master = await masterTrack({ run, voice: { dir: voiceDir, sidecar: SIDECAR }, timeline: TIMELINE, loudness: PRO.loudness, workDir: work });
  const encoded = await encodeMaster({ run, master, out: path.join(work, 'sound.m4a'), duration: TIMELINE.duration, loudness: PRO.loudness });
  const before = judgeLevel(encoded.level, PRO.loudness, 'the mastered narration');
  const video = testVideo(ffmpeg, work, TIMELINE.duration);
  const after = judgeLevel(await muxVoice({ run, video, audio: encoded.file, out: path.join(work, 'film.mp4'), duration: TIMELINE.duration }), PRO.loudness);
  assert.deepEqual([after.lufs, after.truePeakDb], [before.lufs, before.truePeakDb]);
  t.diagnostic(`master ${before.lufs} LUFS, finished file ${after.lufs} LUFS`);
  assert.ok(Math.abs(after.lufs - PRO.loudness.lufs) <= 1, `${after.lufs} LUFS after the mux`);
});

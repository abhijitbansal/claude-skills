import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireRender } from './helpers/render.mjs';
import { synth, grid, pcmWav } from './helpers/beat-signals.mjs';
import { wavBuffer, writeWav } from './helpers/wav.mjs';
import { mulberry32 } from '../template/seeded.mjs';
import { decodeArgs, decodePcm, onsetEnvelope, estimateTempo, beatGrid, detectBeats, MIN_BPM, MAX_BPM } from '../scripts/lib/beats.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BEATS = path.join(root, 'scripts/beats.mjs');
const MUSIC_FIXTURE = path.resolve(root, '../../eval/fixtures/data/music.wav'); // a 10 s, 120 BPM click track
const FFMPEG = { need: ['ffmpeg'] };
const CLICK_TOLERANCE_SECONDS = 0.02;

const tmp = () => mkdtempSync(path.join(tmpdir(), 'beats-'));
const run = (...args) => spawnSync(process.execPath, [BEATS, ...args], { encoding: 'utf8' });

// 16-bit mono white noise from a seeded generator: no beat in it, whatever the seed.
function writeNoise(file, seconds, seed) {
  const wav = wavBuffer({ seconds });
  const next = mulberry32(seed);
  for (let at = 44; at < wav.length; at += 2) wav.writeInt16LE(Math.round((next() * 2 - 1) * 20000), at);
  writeFileSync(file, wav);
}

// A mono 22050 Hz click track: a 1 kHz sine burst of `burstMs` at the start of every beat, on exact silence.
function writeClicks(file, { bpm, burstMs, seconds = 12, startAt = 0 }) {
  const rate = 22050;
  const wav = wavBuffer({ seconds, sampleRate: rate });
  const period = (60 / bpm) * rate;
  const burst = Math.round((burstMs / 1000) * rate);
  for (let i = 0; i < Math.round(seconds * rate); i++) {
    const at = i - Math.round(startAt * rate); // samples since the first click
    const inBeat = at - Math.floor(at / period) * period; // samples since the latest click
    wav.writeInt16LE(at >= 0 && inBeat < burst ? Math.round(Math.sin((2 * Math.PI * 1000 * inBeat) / rate) * 16000) : 0, 44 + i * 2);
  }
  writeFileSync(file, wav);
}

const nearestClick = (time, bpm) => {
  const period = 60 / bpm;
  return Math.abs(time - Math.round(time / period) * period);
};

test('the ffmpeg decode reads the file through the file and pipe protocols only, mono at 22050 Hz as f32le', () => {
  const args = decodeArgs('/some/where/music.wav');
  const input = args.indexOf('-i');
  assert.deepEqual(args.slice(input - 2, input + 2), ['-protocol_whitelist', 'file,pipe', '-i', '/some/where/music.wav']);
  assert.ok(args.join(' ').includes('-ac 1 -ar 22050'), args.join(' '));
  assert.ok(args.join(' ').includes('-f f32le'), args.join(' '));
  assert.equal(args.at(-1), 'pipe:1');
});

test('decodePcm refuses a path that starts with a dash', async () => {
  assert.throws(() => decodePcm('ffmpeg', '-i'), /starts with "-"/);
});

test('120 BPM clicks: the tempo is within 1 BPM and every beat is within 20 ms of a click', async (t) => {
  const tools = await requireRender(t, FFMPEG);
  if (!tools) return;
  const file = path.join(tmp(), 'clicks.wav');
  writeWav(file, { seconds: 8, clickBpm: 120 });
  const { bpm, confidence, beats } = detectBeats(decodePcm(tools.ffmpeg, file));
  assert.ok(Math.abs(bpm - 120) <= 1, `bpm ${bpm}`);
  assert.ok(confidence >= 0.5, `confidence ${confidence}`);
  assert.ok(beats.length >= 15 && beats.length <= 17, `${beats.length} beats`);
  for (const time of beats) assert.ok(nearestClick(time, 120) <= CLICK_TOLERANCE_SECONDS, `beat at ${time}s is ${nearestClick(time, 120)}s from a click`);
});

const SWEEP_TEMPOS = [60, 72, 90, 100, 110, 120, 128, 140, 160, 180, 200];
const SWEEP_BURSTS_MS = [2, 5, 20];

test('click tracks from 60 to 200 BPM read within 1 BPM with every beat within 20 ms, whatever the transient', async (t) => {
  const tools = await requireRender(t, FFMPEG);
  if (!tools) return;
  const dir = tmp();
  const failures = [];
  for (const bpm of SWEEP_TEMPOS) {
    for (const burstMs of SWEEP_BURSTS_MS) {
      const file = path.join(dir, `c${bpm}-${burstMs}.wav`);
      writeClicks(file, { bpm, burstMs });
      const read = detectBeats(decodePcm(tools.ffmpeg, file));
      const worst = Math.max(...read.beats.map((b) => nearestClick(b, bpm)));
      if (Math.abs(read.bpm - bpm) > 1 || worst > CLICK_TOLERANCE_SECONDS || read.confidence < 0.5) {
        failures.push(`${bpm} BPM, ${burstMs} ms: read ${read.bpm.toFixed(2)}, confidence ${read.confidence.toFixed(2)}, worst beat ${(worst * 1000).toFixed(1)} ms`);
      }
    }
  }
  assert.deepEqual(failures, []);
});

test('clicks at other tempos: 90 and 150 BPM', async (t) => {
  const tools = await requireRender(t, FFMPEG);
  if (!tools) return;
  for (const target of [90, 150]) {
    const file = path.join(tmp(), `clicks-${target}.wav`);
    writeWav(file, { seconds: 10, clickBpm: target });
    const { bpm, beats } = detectBeats(decodePcm(tools.ffmpeg, file));
    assert.ok(Math.abs(bpm - target) <= 1.5, `${target} BPM read as ${bpm}`);
    for (const time of beats) assert.ok(nearestClick(time, target) <= CLICK_TOLERANCE_SECONDS, `${target} BPM: beat at ${time}s`);
  }
});

test('seeded white noise has no steady beat: confidence below 0.5 for every seed', async (t) => {
  const tools = await requireRender(t, FFMPEG);
  if (!tools) return;
  const dir = tmp();
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const file = path.join(dir, `noise-${seed}.wav`);
    writeNoise(file, 8, seed);
    const { bpm, confidence } = detectBeats(decodePcm(tools.ffmpeg, file));
    assert.ok(confidence < 0.5, `seed ${seed}: confidence ${confidence}`);
    assert.ok(bpm >= MIN_BPM && bpm <= MAX_BPM, `seed ${seed}: bpm ${bpm} is outside ${MIN_BPM}-${MAX_BPM}`);
  }
});

test('the eval fixture music.wav reads as a steady beat with 20 beats, so item-beats can succeed', async (t) => {
  const tools = await requireRender(t, FFMPEG);
  if (!tools) return;
  const { bpm, confidence, beats } = detectBeats(decodePcm(tools.ffmpeg, MUSIC_FIXTURE));
  assert.ok(confidence >= 0.5, `confidence ${confidence}`);
  assert.ok(Math.abs(bpm - 120) <= 1, `bpm ${bpm}`);
  assert.ok(Math.abs(beats.length - 20) <= 1, `${beats.length} beats`);
});

test('the grid covers the sound: no beats through leading or trailing silence, and none lost at the very start', async (t) => {
  const tools = await requireRender(t, FFMPEG);
  if (!tools) return;
  const dir = tmp();
  writeClicks(path.join(dir, 'late.wav'), { bpm: 120, burstMs: 5, seconds: 12, startAt: 3 });
  const late = detectBeats(decodePcm(tools.ffmpeg, path.join(dir, 'late.wav')));
  assert.ok(late.beats[0] >= 2.95, `first beat at ${late.beats[0]}s, but the first click is at 3 s`);
  for (const time of late.beats) assert.ok(nearestClick(time - 3, 120) <= CLICK_TOLERANCE_SECONDS, `beat at ${time}s is not on a click`);
  // 8 s of clicks, then 4 s of silence: the last click is at 7.5 s
  const clicks = path.join(dir, 'early.wav');
  writeClicks(clicks, { bpm: 120, burstMs: 5, seconds: 8 });
  const wav = readFileSync(clicks);
  const padded = Buffer.concat([wav, Buffer.alloc(4 * 22050 * 2)]);
  padded.writeUInt32LE(padded.length - 8, 4);
  padded.writeUInt32LE(padded.length - 44, 40);
  writeFileSync(path.join(dir, 'early-padded.wav'), padded);
  const early = detectBeats(decodePcm(tools.ffmpeg, path.join(dir, 'early-padded.wav')));
  assert.ok(early.beats.at(-1) <= 7.55, `last beat at ${early.beats.at(-1)}s, but the last click is at 7.5 s`);
  // a click on the very first sample cannot show in the envelope, but its beat is still the first: beat 0
  const first = detectBeats(decodePcm(tools.ffmpeg, path.join(dir, 'early.wav')));
  assert.ok(first.beats[0] <= 0.05, `beat 0 at ${first.beats[0]}s`);
  assert.equal(first.beats.length, 16);
});

test('onsetEnvelope is non-negative, normalised to a maximum of 1, and one value per hop', () => {
  const pcm = new Float32Array(22050);
  for (let i = 0; i < pcm.length; i += 5512) pcm.fill(0.8, i, i + 200);
  const env = onsetEnvelope(pcm, { frame: 1024, hop: 512 });
  assert.equal(env.length, Math.floor((pcm.length - 1024) / 512) + 1);
  assert.equal(Math.max(...env), 1);
  assert.ok(env.every((v) => v >= 0));
});

test('onsetEnvelope of silence or a too-short clip is all zeros, never NaN', () => {
  assert.deepEqual([...onsetEnvelope(new Float32Array(4096))].filter((v) => v !== 0), []);
  assert.equal(onsetEnvelope(new Float32Array(100)).length, 0);
});

test('estimateTempo finds spikes every 21.5 frames as 120 BPM, and a flat envelope has no confidence', () => {
  const hop = 512 / 22050;
  const spikes = new Float32Array(400);
  for (let k = 0; k * 21.53 < 400; k++) spikes[Math.round(k * 21.53)] = 1;
  const { bpm, confidence } = estimateTempo(spikes, hop);
  assert.ok(Math.abs(bpm - 120) <= 1, `bpm ${bpm}`);
  assert.ok(confidence >= 0.5, `confidence ${confidence}`);
  assert.ok(estimateTempo(new Float32Array(400).fill(0.5), hop).confidence < 0.5);
  assert.ok(MIN_BPM === 60 && MAX_BPM === 200);
});

test('beatGrid puts a beat on every spike, at the phase that maximises the envelope', () => {
  const hop = 0.02;
  const env = new Float32Array(100);
  for (let i = 7; i < 100; i += 25) env[i] = 1; // 0.5 s apart, first at 0.14 s
  const beats = beatGrid(env, 120, hop);
  assert.ok(Math.abs(beats[0] - 0.14) <= 0.011, `first beat ${beats[0]}`);
  assert.ok(beats.every((b, i) => i === 0 || Math.abs(b - beats[i - 1] - 0.5) < 1e-6));
});

test('beats.mjs writes <stem>.beats.json beside the audio and prints the path, bpm and count', async (t) => {
  const tools = await requireRender(t, FFMPEG);
  if (!tools) return;
  const dir = tmp();
  writeWav(path.join(dir, 'song.wav'), { seconds: 8, clickBpm: 120 });
  const r = run(path.join(dir, 'song.wav'));
  assert.equal(r.status, 0, r.stderr);
  const out = path.join(dir, 'song.beats.json');
  const [printed, summary] = r.stdout.trim().split('\n');
  assert.equal(printed, out);
  assert.match(summary, /^\d+(\.\d+)? BPM, \d+ beats$/);
  const data = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(data.source, 'song.wav');
  assert.ok(Math.abs(data.bpm - 120) <= 1);
  assert.ok(data.confidence >= 0.5 && data.confidence <= 1);
  assert.ok(Array.isArray(data.beats) && data.beats.every((b, i) => Number.isFinite(b) && b >= 0 && (i === 0 || b > data.beats[i - 1])));
});

test('beats.mjs --out writes the named file; --min-confidence lowers the bar', async (t) => {
  const tools = await requireRender(t, FFMPEG);
  if (!tools) return;
  const dir = tmp();
  writeWav(path.join(dir, 'song.wav'), { seconds: 8, clickBpm: 120 });
  const out = path.join(dir, 'grid.json');
  const r = run(path.join(dir, 'song.wav'), '--out', out, '--min-confidence', '0.3');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(out));
});

test('beats.mjs on white noise exits 1 with the message and writes nothing', async (t) => {
  const tools = await requireRender(t, FFMPEG);
  if (!tools) return;
  const dir = tmp();
  writeNoise(path.join(dir, 'noise.wav'), 8, 3);
  const r = run(path.join(dir, 'noise.wav'));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /^no steady beat found in noise\.wav \(confidence \d\.\d\d; needs 0\.5\)\n$/);
  assert.equal(existsSync(path.join(dir, 'noise.beats.json')), false);
});

test('beats.mjs rejects unknown flags with exit 2 and lists the accepted ones', () => {
  const r = run('song.wav', '--outt', 'x.json');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown option --outt; did you mean --out\? \(accepted: --out, --min-confidence, --bpm, --min-bpm, --max-bpm\)/);
  assert.equal(run('song.wav', '--bogus').status, 2);
});

test('beats.mjs needs exactly one audio file and valid flag values', () => {
  assert.equal(run().status, 2);
  assert.match(run().stderr, /usage: node scripts\/beats\.mjs <audio>/);
  assert.equal(run('a.wav', 'b.wav').status, 2);
  for (const bad of ['abc', '-1', '1.5', '']) {
    const r = run('a.wav', '--min-confidence', bad);
    assert.equal(r.status, 2, bad);
    assert.match(r.stderr, /--min-confidence must be a number from 0 to 1/);
  }
  assert.match(run('a.wav', '--out').stderr, /--out needs a value/);
});

test('beats.mjs says a clip is too short to find a beat, not that it has no steady one', async (t) => {
  const tools = await requireRender(t, FFMPEG);
  if (!tools) return;
  const dir = tmp();
  writeClicks(path.join(dir, 'x.wav'), { bpm: 120, burstMs: 5, seconds: 1.5 });
  const r = run(path.join(dir, 'x.wav'));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^x\.wav is too short to find a beat \(needs about \d\.\d s of audio, this has 1\.5 s\)\n$/);
});

test('beats.mjs --out replaces a beats file but refuses any other file, a motion spec included', async (t) => {
  const tools = await requireRender(t, FFMPEG);
  if (!tools) return;
  const dir = tmp();
  writeWav(path.join(dir, 'song.wav'), { seconds: 8, clickBpm: 120 });
  const grid = path.join(dir, 'grid.json');
  assert.equal(run(path.join(dir, 'song.wav'), '--out', grid).status, 0);
  assert.equal(run(path.join(dir, 'song.wav'), '--out', grid).status, 0, 'a second run replaces the first');
  const spec = path.join(dir, 'motion.json');
  const text = JSON.stringify({ scenes: [{ id: 's', duration: 2, elements: [] }] });
  writeFileSync(spec, text);
  const r = run(path.join(dir, 'song.wav'), '--out', spec);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--out: motion\.json exists and is not a beats file; choose another --out/);
  assert.equal(readFileSync(spec, 'utf8'), text);
  writeFileSync(path.join(dir, 'notes.json'), 'not json at all');
  assert.equal(run(path.join(dir, 'song.wav'), '--out', path.join(dir, 'notes.json')).status, 2);
});

test('beats.mjs --bpm and --min-bpm/--max-bpm: bad values exit 2 and say what is accepted', () => {
  for (const [flag, bad] of [['--bpm', 'abc'], ['--bpm', '10'], ['--bpm', '400'], ['--bpm', ''], ['--min-bpm', 'fast'], ['--min-bpm', '29'], ['--max-bpm', '301'], ['--max-bpm', 'x']]) {
    const r = run('a.wav', flag, bad);
    assert.equal(r.status, 2, `${flag} ${JSON.stringify(bad)}`);
    assert.equal(r.stderr, `${flag} must be a number of beats per minute from 30 to 300 (got ${JSON.stringify(bad)})\n`, `${flag} ${JSON.stringify(bad)}`);
  }
  const both = run('a.wav', '--bpm', '120', '--min-bpm', '100');
  assert.equal(both.status, 2);
  assert.match(both.stderr, /--bpm forces the tempo, so it cannot be combined with --min-bpm or --max-bpm/);
  const order = run('a.wav', '--min-bpm', '150', '--max-bpm', '100');
  assert.equal(order.status, 2);
  assert.match(order.stderr, /--min-bpm \(150\) must be below --max-bpm \(100\); the search defaults to 60 to 200/);
  assert.match(run('a.wav', '--min-bpm', '210').stderr, /^--min-bpm \(210\) must be below --max-bpm, which defaults to 200; pass a higher --max-bpm too\n$/);
  assert.match(run('a.wav', '--bpm').stderr, /--bpm needs a value/);
});

test('beats.mjs takes a plain decimal tempo (not 0x78, 1e2 or a padded number) and names the flag it blames', () => {
  for (const bad of ['0x78', '1e2', ' 120 ', '+120', '120.', '.5']) {
    const r = run('a.wav', '--bpm', bad);
    assert.equal(r.status, 2, JSON.stringify(bad));
    assert.match(r.stderr, /^--bpm must be a number of beats per minute from 30 to 300/, JSON.stringify(bad));
  }
  const alone = run('a.wav', '--max-bpm', '50');
  assert.equal(alone.status, 2);
  assert.match(alone.stderr, /^--max-bpm \(50\) must be above --min-bpm, which defaults to 60; pass a lower --min-bpm too\n$/);
});

test('beats.mjs names the narrowed range and the drift when it finds no steady beat', async (t) => {
  const tools = await requireRender(t, FFMPEG);
  if (!tools) return;
  const dir = tmp();
  writeFileSync(path.join(dir, 'c.wav'), pcmWav(synth(12, grid(120, 12))));
  const narrow = run(path.join(dir, 'c.wav'), '--min-bpm', '100', '--max-bpm', '101');
  assert.equal(narrow.status, 1);
  // a steady track whose tempo is outside the range: the range is to blame, not drift
  assert.match(narrow.stderr, /^no steady beat found between 100 and 101 BPM in c\.wav \(confidence \d\.\d\d; needs 0\.5\): no beat in that range; the track may be faster or slower\n$/);
  const off = run(path.join(dir, 'c.wav'), '--bpm', '123', '--out', path.join(dir, 'off.json'));
  assert.equal(off.status, 1);
  assert.match(off.stderr, /^no steady beat found at 123 BPM in c\.wav \(confidence \d\.\d\d; needs 0\.5\): the grid drifts \d\.\d\d of a beat across the track; retry without --bpm, or with a tempo closer to the track's\n$/);
  assert.equal(existsSync(path.join(dir, 'off.json')), false);
  writeFileSync(path.join(dir, 'change.wav'), pcmWav(synth(12, [...grid(100, 6), ...grid(130, 12, { from: 6 })])));
  const change = run(path.join(dir, 'change.wav'));
  assert.equal(change.status, 1);
  assert.match(change.stderr, /the grid drifts \d\.\d\d of a beat across the track; the tempo changes or wanders, so aim --min-bpm and --max-bpm at the part you need, or give --bpm for a tempo you know\n$/);
  assert.equal(run(path.join(dir, 'c.wav'), '--bpm', '120', '--out', path.join(dir, 'ok.json')).status, 0);
});

test('beats.mjs --bpm forces the grid at that tempo; --min-bpm and --max-bpm steer an ambiguous track', async (t) => {
  const tools = await requireRender(t, FFMPEG);
  if (!tools) return;
  const dir = tmp();
  const slow = synth(12, [...grid(70, 12, { kind: 'noise', amp: 0.8 }), ...grid(70, 12, { offset: 30 / 70, kind: 'noise', amp: 0.6 })]);
  writeFileSync(path.join(dir, 'slow.wav'), pcmWav(slow));
  const read = (...flags) => {
    const r = run(path.join(dir, 'slow.wav'), '--out', path.join(dir, 'slow.json'), ...flags);
    return { r, data: r.status === 0 ? JSON.parse(readFileSync(path.join(dir, 'slow.json'), 'utf8')) : null };
  };
  assert.ok(Math.abs(read().data.bpm - 140) <= 1, 'unforced: the track reads at double'); // the ambiguity the flags are for
  const narrowed = read('--min-bpm', '60', '--max-bpm', '100');
  assert.ok(Math.abs(narrowed.data.bpm - 70) <= 1, `narrowed: ${narrowed.data?.bpm}`);
  const forced = read('--bpm', '70');
  assert.equal(forced.data.bpm, 70);
  assert.ok(forced.data.confidence >= 0.5);
  assert.match(forced.r.stdout, /\n70 BPM, \d+ beats\n$/);
  const wrong = run(path.join(dir, 'slow.wav'), '--out', path.join(dir, 'wrong.json'), '--bpm', '95');
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /^no steady beat found at 95 BPM in slow\.wav \(confidence \d\.\d\d; needs 0\.5\)(: the grid drifts \d\.\d\d of a beat[^\n]*)?\n$/);
  assert.equal(existsSync(path.join(dir, 'wrong.json')), false);
});

test('beats.mjs: the too-short message never asks for less than it checks, and --min-bpm raises it', async (t) => {
  const tools = await requireRender(t, FFMPEG);
  if (!tools) return;
  const dir = tmp();
  const clip = (seconds, name) => writeFileSync(path.join(dir, name), pcmWav(synth(seconds, grid(120, seconds))));
  clip(2.12, 'edge.wav');
  const edge = run(path.join(dir, 'edge.wav'));
  assert.equal(edge.status, 1);
  assert.match(edge.stderr, /^edge\.wav is too short to find a beat \(needs about 2\.2 s of audio, this has 2\.1 s\)\n$/);
  clip(3, 'three.wav');
  assert.equal(run(path.join(dir, 'three.wav'), '--out', path.join(dir, 'three.json')).status, 0);
  const slowFloor = run(path.join(dir, 'three.wav'), '--min-bpm', '30');
  assert.equal(slowFloor.status, 1);
  assert.match(slowFloor.stderr, /three\.wav is too short to find a beat \(needs about 4\.\d s of audio, this has 3\.0 s\)/);
});

test('beats.mjs --out replaces an empty or interrupted file but never reads a huge one', async (t) => {
  const tools = await requireRender(t, FFMPEG);
  if (!tools) return;
  const dir = tmp();
  writeWav(path.join(dir, 'song.wav'), { seconds: 8, clickBpm: 120 });
  const empty = path.join(dir, 'empty.json');
  writeFileSync(empty, '');
  assert.equal(run(path.join(dir, 'song.wav'), '--out', empty).status, 0, 'a half-written file left nothing worth keeping');
  const huge = path.join(dir, 'huge.json');
  writeFileSync(huge, `{"beats":[0],"pad":"${'x'.repeat(2 * 1024 * 1024)}"}`);
  const r = run(path.join(dir, 'song.wav'), '--out', huge);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--out: huge\.json exists and is not a beats file; choose another --out/);
});

test('SKILL.md step 8 shows what beats.mjs prints for the fixture it names', async (t) => {
  const tools = await requireRender(t, FFMPEG);
  if (!tools) return;
  const { bpm, beats } = detectBeats(decodePcm(tools.ffmpeg, MUSIC_FIXTURE));
  const skill = readFileSync(path.join(root, 'SKILL.md'), 'utf8');
  const printed = `${Math.round(bpm * 100) / 100} BPM, ${beats.length} beats`;
  assert.ok(skill.includes(`\`${printed}\``), `SKILL.md step 8 should print \`${printed}\``);
});

test('beats.mjs reports a file it cannot read with exit 2', () => {
  const r = run(path.join(tmp(), 'missing.wav'));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /cannot read .*missing\.wav: ENOENT/);
});

test('beats.mjs rejects a path that starts with a dash before running ffmpeg', () => {
  const r = run('-evil.wav');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /starts with "-"/);
  assert.equal(run('--', '-evil.wav').status, 2);
});

test('beats.mjs never writes over the audio it reads, by name or through a symlink', async (t) => {
  const tools = await requireRender(t, FFMPEG);
  if (!tools) return;
  const dir = tmp();
  const wav = path.join(dir, 'song.wav');
  writeWav(wav, { seconds: 2, clickBpm: 120 });
  const before = readFileSync(wav);
  const same = run(wav, '--out', wav);
  assert.equal(same.status, 2);
  assert.match(same.stderr, /--out: song\.wav is a file this command reads \(the audio\); choose another --out/);
  const link = path.join(dir, 'link.json');
  symlinkSync(wav, link);
  const linked = run(wav, '--out', link);
  assert.equal(linked.status, 2);
  assert.deepEqual(readFileSync(wav), before);
});

test('beats.mjs --out puts the folder in place and refuses a folder where the file belongs', async (t) => {
  const tools = await requireRender(t, FFMPEG);
  if (!tools) return;
  const dir = tmp();
  writeWav(path.join(dir, 'song.wav'), { seconds: 8, clickBpm: 120 });
  const nested = path.join(dir, 'nested/deeper/grid.json');
  const r = run(path.join(dir, 'song.wav'), '--out', nested);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(nested));
  assert.equal(run(path.join(dir, 'song.wav'), '--out', dir).status, 2);
});

test('beats.mjs says what is wrong with ffmpeg when it cannot decode the file', async (t) => {
  const tools = await requireRender(t, FFMPEG);
  if (!tools) return;
  const dir = tmp();
  writeFileSync(path.join(dir, 'fake.wav'), 'this is not audio');
  const r = run(path.join(dir, 'fake.wav'));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /ffmpeg cannot decode .*fake\.wav: /);
});

// Task 19: `render --loudness <lufs>|off` and `--true-peak <dbtp>`: a two-pass loudnorm between the encode and the final
// rename, and the viral default (-14 LUFS / -1 dBTP) that makes a viral render normalised with no flag.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateSpec, UsageError } from '../scripts/lib/spec.mjs';
import { measureLoudness } from '../scripts/lib/ffmpeg.mjs';
import { measureLoudnorm, normalizeArgs, normalizeFile, parseLoudnormJson, parseLoudnessFlag, parseTruePeakFlag, resolveTarget, needsLimiter, limiterChain, ceilingFor, parseFfmpegVersion, limiterSupported, gainArgs, LIMITER_NOTE_DB, DEFAULT_TRUE_PEAK } from '../scripts/lib/loudness.mjs';
import { requireRender, renderHash, assertRendersIdentically } from './helpers/render.mjs';
import { writeWav } from './helpers/wav.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RENDER = path.join(root, 'scripts/render.mjs');
const SMALL = ['--fps', '10', '--size', '180x320'];
const PINNED_BUILD_DATE = '1793318400';

const scene = (id, duration, elements) => ({ id, duration, elements });
const hook = { id: 'hook', type: 'text', text: 'Watch this', x: 90, y: 160, fontSize: 24 };
const tone = (extra = {}) => ({ audio: [{ src: 'tone.wav' }], scenes: [scene('s', 2, [hook])], ...extra });
const viral = (extra = {}) => tone({ mode: 'viral', cues: [], ...extra });

function specFile(motion, files = { 'tone.wav': (f) => writeWav(f, { seconds: 2 }) }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'loud-'));
  for (const [name, body] of Object.entries(files)) {
    if (typeof body === 'function') body(path.join(dir, name));
    else writeFileSync(path.join(dir, name), body);
  }
  const file = path.join(dir, 'motion.json');
  writeFileSync(file, JSON.stringify(motion));
  return file;
}
const run = (args, env = {}) => spawnSync(process.execPath, [RENDER, ...args], { encoding: 'utf8', env: { ...process.env, SOURCE_DATE_EPOCH: PINNED_BUILD_DATE, ...env } });
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

// ---- argument arrays and parsing ------------------------------------------------------------------------------------

const MEASURED = { input_i: '-9.07', input_tp: '-5.99', input_lra: '0.00', input_thresh: '-19.07', target_offset: '-0.12' };

test('normalizeArgs: the exact second-pass array, with the default true peak and with one', () => {
  const head = ['-y', '-protocol_whitelist', 'file,pipe', '-i', '/a/in.mp4', '-c:v', 'copy', '-af'];
  const tail = ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', '/a/out.mp4'];
  const withLength = ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-t', '2', '-movflags', '+faststart', '/a/out.mp4'];
  const measured = 'measured_I=-9.07:measured_TP=-5.99:measured_LRA=0.00:measured_thresh=-19.07:offset=-0.12:linear=true';
  assert.deepEqual(normalizeArgs({ input: '/a/in.mp4', out: '/a/out.mp4', target: -16, measured: MEASURED }),
    [...head, `loudnorm=I=-16:TP=-1.5:LRA=11:${measured}`, ...tail]);
  assert.deepEqual(normalizeArgs({ input: '/a/in.mp4', out: '/a/out.mp4', target: -14, truePeak: -1, measured: MEASURED }),
    [...head, `loudnorm=I=-14:TP=-1:LRA=11:${measured}`, ...tail]);
  // Fix round 1: the clip length caps the second pass as it caps the first encode; a limiter chain goes ahead of loudnorm.
  assert.deepEqual(normalizeArgs({ input: '/a/in.mp4', out: '/a/out.mp4', target: -16, measured: MEASURED, duration: 2 }),
    [...head, `loudnorm=I=-16:TP=-1.5:LRA=11:${measured}`, ...withLength]);
  assert.deepEqual(normalizeArgs({ input: '/a/in.mp4', out: '/a/out.mp4', target: -14, truePeak: -1, measured: MEASURED, duration: 2, pre: 'volume=1dB' }),
    [...head, `volume=1dB,loudnorm=I=-14:TP=-1:LRA=50:${measured}`, ...withLength], 'after a limiter stage the range check is lifted (LRA=50)');
  assert.equal(DEFAULT_TRUE_PEAK, -1.5);
});

test('ceilingFor aims loudnorm 0.5 dB under the true peak, so the AAC encode cannot push the file over it', () => {
  assert.deepEqual([-1, -1.5, 0, -3, -1.3].map(ceilingFor), [-1.5, -2, -0.5, -3.5, -1.8]);
});

test('needsLimiter: only when linear loudnorm cannot reach the target: the gain would put the peak over the true peak, or the range is over 11 LU', () => {
  const m = (i, tp, lra = '0.00') => ({ input_i: i, input_tp: tp, input_lra: lra, input_thresh: '-40', target_offset: '0' });
  assert.equal(needsLimiter(m('-30.05', '-15.16'), -14, -1), true, 'a quiet cue mix: +16 dB would put the peak at +0.9 dBTP');
  assert.equal(needsLimiter(m('-9.07', '-5.99'), -16, -1.5), false, 'a tone that must come down');
  assert.equal(needsLimiter(m('-14.0', '-3.0'), -14, -1), false, 'already on target with headroom');
  assert.equal(needsLimiter(m('-20', '-10'), -14, -1), false, 'a +6 dB gain puts the peak at -4 dBTP, under the ceiling');
  assert.equal(needsLimiter(m('-18', '-5'), -14, -1), false, 'a +4 dB gain puts the peak at -1 dBTP, exactly at the ceiling');
  assert.equal(needsLimiter(m('-22.77', '-10.16', '11.80'), -14, -1), true, 'a sparse cue mix: the peak fits, but the range is 11.8 LU');
  assert.equal(needsLimiter(m('-22.77', '-10.16', '11.00'), -14, -1), false, 'a range of exactly 11 LU is still linear');
  assert.equal(needsLimiter(m('-inf', '-inf'), -14, -1), false, 'silence is not scaled');
  assert.match(limiterChain({ gain: 8.9, truePeak: -1 }), /^volume=8\.90dB,alimiter=limit=0\.6310:level=false:latency=true$/, 'a limit of true peak - 3 dB: -4 dBFS is 0.6310');
});

test('parseLoudnormJson: the JSON block after other log lines, the last one when there are two, null when there is none', () => {
  const block = (i) => `{\n\t"input_i" : "${i}",\n\t"input_tp" : "-5.99",\n\t"input_lra" : "0.00",\n\t"input_thresh" : "-19.07",\n\t"output_i" : "-16.4",\n\t"output_tp" : "-12.1",\n\t"output_lra" : "0.00",\n\t"output_thresh" : "-26.5",\n\t"normalization_type" : "dynamic",\n\t"target_offset" : "-0.12"\n}`;
  const log = `Input #0, wav, from 'x.wav':\n  Metadata: {not json}\n[Parsed_loudnorm_0 @ 0x6000] \n${block('-9.07')}\nsize=N/A time=00:00:02.00 bitrate=N/A\n`;
  assert.deepEqual(parseLoudnormJson(log), MEASURED);
  assert.equal(parseLoudnormJson(`${block('-1.00')}\nmore log\n${block('-2.00')}\n`).input_i, '-2.00');
  assert.equal(parseLoudnormJson('Input #0, wav\nsize=N/A\n'), null);
  assert.equal(parseLoudnormJson('{ "input_i" : "-9" }'), null, 'a block without the other keys is not a measurement');
});

test('the --loudness and --true-peak flags: a number in range, or off; anything else names the range (usage error)', () => {
  assert.equal(parseLoudnessFlag('off'), 'off');
  assert.equal(parseLoudnessFlag('-16'), -16);
  assert.equal(parseLoudnessFlag('-30'), -30);
  assert.equal(parseLoudnessFlag('-5'), -5);
  assert.equal(parseLoudnessFlag('-14.5'), -14.5);
  for (const bad of ['-31', '-4', '0', '16', 'loud', '', '-', '1e1', '-14abc']) {
    assert.throws(() => parseLoudnessFlag(bad), (e) => e instanceof UsageError && e.message.includes('-30 to -5') && e.message.includes('"off"') && e.message.includes(JSON.stringify(bad)), bad);
  }
  assert.equal(parseTruePeakFlag('-1'), -1);
  assert.equal(parseTruePeakFlag('0'), 0);
  assert.equal(parseTruePeakFlag('-3'), -3);
  for (const bad of ['-3.1', '0.5', '1', 'hot', '']) {
    assert.throws(() => parseTruePeakFlag(bad), (e) => e instanceof UsageError && e.message.includes('-3 to 0') && e.message.includes(JSON.stringify(bad)), bad);
  }
});

test('resolveTarget: flags win field by field, then the spec, then none; off disables; --true-peak alone is a usage error', () => {
  const spec = { integrated: -14, truePeak: -1 };
  assert.equal(resolveTarget({}, undefined), null);
  assert.deepEqual(resolveTarget({}, spec), spec);
  assert.deepEqual(resolveTarget({ loudness: -16 }, undefined), { integrated: -16, truePeak: DEFAULT_TRUE_PEAK });
  assert.deepEqual(resolveTarget({ loudness: -16 }, spec), { integrated: -16, truePeak: -1 }, 'the spec keeps the field the flag leaves out');
  assert.deepEqual(resolveTarget({ loudness: -16, truePeak: -2 }, spec), { integrated: -16, truePeak: -2 });
  assert.deepEqual(resolveTarget({ truePeak: -2 }, spec), { integrated: -14, truePeak: -2 });
  assert.equal(resolveTarget({ loudness: 'off' }, spec), null);
  assert.throws(() => resolveTarget({ truePeak: -2 }, undefined), (e) => e instanceof UsageError && /--true-peak needs a loudness target/.test(e.message) && e.message.includes('--loudness'));
  assert.throws(() => resolveTarget({ loudness: 'off', truePeak: -2 }, spec), (e) => e instanceof UsageError && /--true-peak/.test(e.message) && /off/.test(e.message));
});

test('the spec root loudness field has the same ranges: -30 to -5 and -3 to 0, both required', () => {
  const errors = (loudness) => validateSpec({ loudness, scenes: [scene('s', 1, [])] }).errors.map((e) => `${e.path}: ${e.message}`);
  assert.deepEqual(errors({ integrated: -14, truePeak: -1 }), []);
  assert.deepEqual(errors({ integrated: -31, truePeak: -1 }), ['loudness.integrated: must be >= -30']);
  assert.deepEqual(errors({ integrated: -14, truePeak: 0.5 }), ['loudness.truePeak: must be <= 0']);
  assert.deepEqual(errors({ integrated: -14, truePeak: -3.5 }), ['loudness.truePeak: must be >= -3']);
  assert.equal(errors({ integrated: -14 }).length, 1);
});

// ---- CLI usage errors (exit 2), before anything renders ---------------------------------------------------------------

test('render: a bad --loudness or --true-peak exits 2 and lists the accepted range; --true-peak without a target, and flags on a contact sheet, exit 2 too', () => {
  const file = specFile(tone());
  const cases = [
    [['--loudness', '-31'], /--loudness must be a number from -30 to -5 .*or "off".*"-31"/],
    [['--loudness', '-4'], /--loudness must be a number from -30 to -5/],
    [['--loudness', 'loud'], /--loudness must be a number from -30 to -5.*"loud"/],
    [['--loudness', '-16', '--true-peak', '-4'], /--true-peak must be a number from -3 to 0.*"-4"/],
    [['--loudness', '-16', '--true-peak', '0.5'], /--true-peak must be a number from -3 to 0/],
    [['--true-peak', '-1'], /--true-peak needs a loudness target: add --loudness <lufs>, or a loudness field in the spec/],
    [['--loudness', 'off', '--true-peak', '-1'], /--true-peak has nothing to apply to with --loudness off/],
    [['--loudness'], /--loudness needs a value/],
    [['--contact-sheet', '--loudness', '-16'], /--loudness does not apply to --contact-sheet/],
    [['--contact-sheet', '--true-peak', '-1'], /--true-peak does not apply to --contact-sheet/],
  ];
  for (const [args, message] of cases) {
    const r = run([file, ...args]);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, message, args.join(' '));
  }
  const unknown = run([file, '--loudnes', '-16']);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /did you mean --loudness\?/);
  assert.match(unknown.stderr, /--loudness, --true-peak/, 'the accepted flags are listed');
});

// ---- ffmpeg only: the two passes ------------------------------------------------------------------------------------

test('measureLoudnorm reads the pass-1 JSON of a tone; a file with no audio or no JSON fails with a clear error, not a crash', async (t) => {
  const tools = await requireRender(t, { need: ['ffmpeg'] });
  if (!tools) return;
  const wav = path.join(mkdtempSync(path.join(tmpdir(), 'loud-')), 'tone.wav');
  writeWav(wav, { seconds: 2 });
  const m = await measureLoudnorm(tools.ffmpeg, wav, -16, -1.5);
  assert.deepEqual(Object.keys(m).sort(), ['input_i', 'input_lra', 'input_thresh', 'input_tp', 'target_offset']);
  assert.ok(Number.isFinite(Number(m.input_i)) && Number(m.input_i) < -3 && Number(m.input_i) > -20, JSON.stringify(m));
  await assert.rejects(measureLoudnorm(tools.ffmpeg, path.join(path.dirname(wav), 'missing.wav'), -16), /loudnorm: ffmpeg failed \(exit \d+\)/);
  const noJson = path.join(path.dirname(wav), 'ffmpeg-quiet.sh');
  writeFileSync(noJson, '#!/bin/sh\nexit 0\n');
  chmodSync(noJson, 0o755);
  await assert.rejects(measureLoudnorm(noJson, wav, -16), /loudnorm: ffmpeg printed no measurement JSON/);
});

test('normalizeFile leaves a silent file alone (nothing to normalise) and normalises a tone to the target', async (t) => {
  const tools = await requireRender(t, { need: ['ffmpeg'] });
  if (!tools) return;
  const dir = mkdtempSync(path.join(tmpdir(), 'loud-'));
  // normalizeFile works on an MP4 with a video stream and a stereo AAC track, as the render's first encode writes it.
  const make = (name, audio) => {
    const out = path.join(dir, name);
    const r = spawnSync(tools.ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=s=64x64:r=10:d=2', '-f', 'lavfi', '-i', audio, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '2', '-ar', '48000', '-t', '2', out], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return out;
  };
  const toneIn = make('tone.mp4', 'sine=frequency=440:duration=2');
  const quiet = make('quiet.mp4', 'anullsrc=r=48000:cl=stereo');
  const out = path.join(dir, 'out.mp4');
  const done = await normalizeFile(tools.ffmpeg, { input: toneIn, out, target: -16, truePeak: -1.5 });
  assert.equal(done.silent, false);
  const level = measureLoudness(tools.ffmpeg, out);
  assert.ok(Math.abs(level.lufs - -16) <= 1, `${level.lufs} LUFS`);
  assert.ok(level.truePeak <= -1.5, `${level.truePeak} dBTP`);
  const silent = await normalizeFile(tools.ffmpeg, { input: quiet, out: path.join(dir, 'silent.mp4'), target: -16 });
  assert.equal(silent.silent, true);
  assert.equal(existsSync(path.join(dir, 'silent.mp4')), false, 'no file is written for a silent mix');
});

// ---- renders ----------------------------------------------------------------------------------------------------------

test('render --loudness -16 on a tone spec lands within 1 LU of -16 under the default true peak, prints the line, leaves no temp file, and is byte-identical twice', async (t) => {
  const tools = await requireRender(t);
  if (!tools) return;
  const file = specFile(tone());
  const first = await renderHash(file, [...SMALL, '--loudness', '-16']);
  const level = measureLoudness(tools.ffmpeg, first.out);
  assert.ok(Math.abs(level.lufs - -16) <= 1, `${level.lufs} LUFS`);
  assert.ok(level.truePeak <= DEFAULT_TRUE_PEAK, `${level.truePeak} dBTP`);
  assert.match(first.stdout, /^audio: -1[5-7]\.\d LUFS integrated, true peak -?\d+\.\d dBTP$/m);
  assert.match(first.stdout, /^loudness: target -16 LUFS \/ -1\.5 dBTP; measured -1[5-7]\.\d LUFS \/ -?\d+\.\d dBTP \(on target\)$/m);
  assert.deepEqual(readdirSync(path.dirname(first.out)), ['v.mp4'], 'no temp file is left beside the output');
  const comment = spawnSync(tools.ffprobe ?? 'ffprobe', ['-v', 'error', '-show_entries', 'format_tags=comment', '-of', 'default=nw=1:nk=1', first.out], { encoding: 'utf8' });
  assert.match(comment.stdout, /make-motion/, 'the provenance comment survives the second pass');
  // The second pass changes the loudness, not the length: video and audio streams keep the mix's duration (review F3: pass 2 is capped at the clip length, as the first encode is, so the last AAC packet is not a full frame longer).
  const seconds = (file, stream) => Number(spawnSync(tools.ffprobe ?? 'ffprobe', ['-v', 'error', '-select_streams', stream, '-show_entries', 'stream=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' }).stdout);
  const plain = await renderHash(file, SMALL);
  for (const stream of ['v:0', 'a:0']) assert.ok(Math.abs(seconds(first.out, stream) - seconds(plain.out, stream)) <= 0.0005, `${stream}: ${seconds(first.out, stream)} s after, ${seconds(plain.out, stream)} s before`);
  await assertRendersIdentically(t, file, [...SMALL, '--loudness', '-16']);
});

test('render --loudness -16 --true-peak -2: the spec-less target uses the flag peak and the line says so', async (t) => {
  const tools = await requireRender(t);
  if (!tools) return;
  const r = await renderHash(specFile(tone()), [...SMALL, '--loudness', '-16', '--true-peak', '-2']);
  assert.match(r.stdout, /^loudness: target -16 LUFS \/ -2 dBTP; /m);
  assert.ok(measureLoudness(tools.ffmpeg, r.out).truePeak <= -2);
});

test('a viral tone spec with no flag is normalised to -14 LUFS / -1 dBTP and reads "on target"; --loudness off leaves the mix as it was mixed', async (t) => {
  const tools = await requireRender(t);
  if (!tools) return;
  const file = specFile(viral());
  const on = await renderHash(file, SMALL);
  const level = measureLoudness(tools.ffmpeg, on.out);
  assert.ok(Math.abs(level.lufs - -14) <= 1, `${level.lufs} LUFS`);
  assert.ok(level.truePeak <= -1, `${level.truePeak} dBTP`);
  assert.match(on.stdout, /^loudness: target -14 LUFS \/ -1 dBTP; measured -1[3-5]\.\d LUFS \/ -?\d+\.\d dBTP \(on target\)$/m);
  assert.doesNotMatch(on.stdout, /information only|not normalise/);
  const off = await renderHash(file, [...SMALL, '--loudness', 'off']);
  const raw = measureLoudness(tools.ffmpeg, off.out);
  assert.ok(Math.abs(raw.lufs - -14) > 1, `${raw.lufs} LUFS is the unnormalised mix`);
  assert.match(off.stdout, /^loudness: target -14 LUFS \/ -1 dBTP; measured .* \(off target; --loudness off\)$/m, 'the line says why it is off');
  // The same tone with no mode and no target is the mix as mixed: --loudness off changed nothing.
  const plain = await renderHash(specFile(tone()), SMALL);
  assert.equal(measureLoudness(tools.ffmpeg, plain.out).lufs, raw.lufs);
  // An explicit spec field is a target too, and a flag beats it.
  const field = await renderHash(specFile(tone({ loudness: { integrated: -18, truePeak: -2 } })), SMALL);
  assert.ok(Math.abs(measureLoudness(tools.ffmpeg, field.out).lufs - -18) <= 1);
  assert.match(field.stdout, /^loudness: target -18 LUFS \/ -2 dBTP; .* \(on target\)$/m);
  const flagged = await renderHash(specFile(tone({ loudness: { integrated: -18, truePeak: -2 } })), [...SMALL, '--loudness', '-12']);
  assert.match(flagged.stdout, /^loudness: target -12 LUFS \/ -2 dBTP; .* \(on target\)$/m);
});

// Fix round 1 (review F1): a mix of cues alone is mostly silence with short peaks. A constant gain to -14 LUFS would put
// the peaks over -1 dBTP (or its loudness range is over loudnorm's 11), so pass 1 says so and a limiter stage goes ahead
// of the linear loudnorm. Five mixes the reviewer measured: every one lands on target, under the ceiling, and the same twice.
const enter = (id, t) => ({ id, type: 'text', text: 'And more', x: 90, y: 220, fontSize: 24, keyframes: [{ t, opacity: 0 }, { t: t + 0.4, opacity: 1 }] });
const CUES_ONLY = {
  cues2s: { mode: 'viral', scenes: [scene('s', 2, [hook, enter('more', 0.5)])] },
  sparse8s: { mode: 'viral', scenes: [scene('a', 4, [hook, enter('e1', 1)]), scene('b', 4, [enter('e2', 2)])] },
  kenneyClicks: { mode: 'viral', cues: [{ cue: 'kenney:click', at: 0.5 }, { cue: 'kenney:thud', at: 2.5 }, { cue: 'pop', at: 4.5 }], scenes: [scene('a', 6, [hook])] },
  quietCue: { mode: 'viral', cues: [{ cue: 'pop', at: 1, volume: 0.1 }], scenes: [scene('a', 3, [hook])] },
  impactWhoosh: { mode: 'viral', cues: [{ cue: 'whoosh', at: 0.6 }, { cue: 'impact', at: 1.0 }, { cue: 'ding', at: 3.0 }], scenes: [scene('a', 4, [hook])] },
};
for (const [name, motion] of Object.entries(CUES_ONLY)) {
  test(`a viral cues-only mix (${name}) is normalised to -14 +/-1 LU at or under -1 dBTP, reads "on target", and is byte-identical twice`, async (t) => {
    const tools = await requireRender(t);
    if (!tools) return;
    const file = specFile(motion, {});
    const r = await renderHash(file, SMALL);
    const level = measureLoudness(tools.ffmpeg, r.out);
    assert.ok(Math.abs(level.lufs - -14) <= 1 && level.truePeak <= -1, `${level.lufs} LUFS, ${level.truePeak} dBTP`);
    assert.match(r.stdout, /^loudness: target -14 LUFS \/ -1 dBTP; measured -1[3-5]\.\d LUFS \/ -?\d+\.\d dBTP \(on target\)$/m);
    assert.doesNotMatch(r.stdout, /information only/);
    assert.equal((await renderHash(file, SMALL)).sha256, r.sha256, 'two renders are byte-identical');
  });
}

// The limiter stage must not touch a mix that linear loudnorm already handles: the render's bytes equal a plain two-pass
// loudnorm of the same unnormalised encode (measureLoudnorm + normalizeArgs, no pre-chain).
test('a tone mix and a tone-with-cue mix never take the limiter branch: their bytes equal a plain linear two-pass of the same encode', async (t) => {
  const tools = await requireRender(t);
  if (!tools) return;
  const mixes = { tone: viral(), toneAndCue: viral({ cues: [{ cue: 'pop', at: 0.5 }] }) };
  for (const [name, motion] of Object.entries(mixes)) {
    const file = specFile(motion);
    const raw = await renderHash(file, [...SMALL, '--loudness', 'off']);
    const ceiling = ceilingFor(-1);
    const measured = await measureLoudnorm(tools.ffmpeg, raw.out, -14, ceiling);
    assert.equal(needsLimiter(measured, -14, ceiling), false, `${name}: ${JSON.stringify(measured)}`);
    const reference = path.join(path.dirname(raw.out), 'reference.mp4');
    const args = normalizeArgs({ input: raw.out, out: reference, target: -14, truePeak: ceiling, measured, duration: 2 });
    const ran = spawnSync(tools.ffmpeg, args, { encoding: 'utf8' });
    assert.equal(ran.status, 0, ran.stderr);
    assert.equal((await renderHash(file, SMALL)).sha256, sha(reference), `${name}: the render is the plain linear pass`);
  }
});

test('without the flag a spec with audio and cues renders the same bytes twice (the second pass never runs)', async (t) => {
  if (!await requireRender(t)) return;
  const file = specFile(tone({ cues: [{ cue: 'pop', at: 0.5 }] }));
  const hash = await assertRendersIdentically(t, file, SMALL);
  const r = await renderHash(file, SMALL);
  assert.equal(r.sha256, hash);
  assert.doesNotMatch(r.stdout, /^loudness:/m);
});

test('--workers 2 and --quality draft normalise the same way: workers give the same MP4, draft lands on target', async (t) => {
  const tools = await requireRender(t);
  if (!tools) return;
  const file = specFile(tone());
  const one = await renderHash(file, [...SMALL, '--loudness', '-16']);
  const two = await renderHash(file, [...SMALL, '--loudness', '-16', '--workers', '2']);
  assert.equal(two.sha256, one.sha256, '--workers does not change the normalised MP4');
  const draft = await renderHash(file, ['--fps', '10', '--size', '320x640', '--loudness', '-16', '--quality', 'draft']);
  assert.ok(Math.abs(measureLoudness(tools.ffmpeg, draft.out).lufs - -16) <= 1);
});

test('a spec without audio ignores --loudness with a note on stderr and renders as before', async (t) => {
  if (!await requireRender(t)) return;
  const file = specFile({ scenes: [scene('s', 1, [hook])] }, {});
  const flagged = await renderHash(file, SMALL);
  const out = path.join(mkdtempSync(path.join(tmpdir(), 'loud-')), 'v.mp4');
  const r = run([file, '--out', out, ...SMALL, '--loudness', '-16']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stderr, /^loudness: this spec has no audio, so --loudness and --true-peak are ignored$/m);
  assert.equal(sha(out), flagged.sha256);
  assert.doesNotMatch(r.stdout, /^loudness:/m);
});

test('--out over an input is still refused (exit 2) with --loudness', async (t) => {
  if (!await requireRender(t)) return;
  const file = specFile(tone());
  const r = run([file, '--out', path.join(path.dirname(file), 'tone.wav'), '--loudness', '-16']);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /--out: .*tone\.wav is a file this render reads/);
});

test('batch: loudness applies to every row, and the manifest sha256 is of the final normalised file', async (t) => {
  const tools = await requireRender(t);
  if (!tools) return;
  const dir = mkdtempSync(path.join(tmpdir(), 'loud-batch-'));
  writeWav(path.join(dir, 'tone.wav'), { seconds: 2 });
  writeFileSync(path.join(dir, 'm.json'), JSON.stringify({ ...tone(), vars: { who: { type: 'string', default: 'Ada' } }, scenes: [scene('s', 2, [{ ...hook, text: 'Hi {{who}}' }])] }));
  writeFileSync(path.join(dir, 'rows.json'), JSON.stringify([{ who: 'Ada' }, { who: 'Bo' }]));
  const out = path.join(dir, 'renders', '{index}.mp4');
  const r = run([path.join(dir, 'm.json'), '--batch', path.join(dir, 'rows.json'), '--out', out, ...SMALL, '--loudness', '-16']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(readdirSync(path.join(dir, 'renders')).sort(), ['0.mp4', '1.mp4', 'manifest.json']);
  const { rows } = JSON.parse(readFileSync(path.join(dir, 'renders', 'manifest.json'), 'utf8'));
  assert.equal(rows.length, 2);
  for (const row of rows) {
    const file = path.join(dir, 'renders', row.out);
    assert.equal(row.status, 'ok');
    assert.equal(row.sha256, sha(file), 'the manifest hashes the normalised file');
    assert.ok(Math.abs(measureLoudness(tools.ffmpeg, file).lufs - -16) <= 1);
  }
  assert.equal((r.stdout.match(/\(on target\)/g) ?? []).length, 2);
  // A --true-peak with no target fails the whole batch up front (exit 2), before any row renders.
  const bad = run([path.join(dir, 'm.json'), '--batch', path.join(dir, 'rows.json'), '--out', path.join(dir, 'other', '{index}.mp4'), ...SMALL, '--true-peak', '-1']);
  assert.equal(bad.status, 2, bad.stdout + bad.stderr);
  assert.equal(existsSync(path.join(dir, 'other')), false);
});

// ---- failure and interrupt: no extra file is ever left ---------------------------------------------------------------

// A stand-in ffmpeg that is the real one except for the loudnorm passes: `mode` "fail" exits 1 there, "hang" touches
// `marker` and waits (as a long pass would).
function loudnormStandIn(real, mode, marker) {
  const bin = path.join(mkdtempSync(path.join(tmpdir(), 'loud-bin-')), 'ffmpeg');
  const onLoudnorm = mode === 'fail' ? 'echo "loudnorm blew up" >&2\n    exit 1' : `: > '${marker}'\n    exec sleep 60`;
  writeFileSync(bin, `#!/bin/sh\ncase "$*" in\n  *loudnorm*)\n    ${onLoudnorm}\n    ;;\nesac\nexec '${real}' "$@"\n`);
  chmodSync(bin, 0o755);
  return bin;
}

test('a failing loudnorm pass fails the render (exit 1) and leaves neither the encode nor the normalised temp behind', async (t) => {
  const tools = await requireRender(t);
  if (!tools) return;
  const file = specFile(tone());
  const dir = mkdtempSync(path.join(tmpdir(), 'loud-out-'));
  const r = run([file, '--out', path.join(dir, 'o.mp4'), ...SMALL, '--loudness', '-16'], { FFMPEG_PATH: loudnormStandIn(tools.ffmpeg, 'fail') });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /loudnorm: ffmpeg failed \(exit 1\): loudnorm blew up/);
  assert.deepEqual(readdirSync(dir), [], 'no partial, no normalised temp, no MP4');
});

test('an interrupt during a loudnorm pass removes every temp file (exit 130)', async (t) => {
  const tools = await requireRender(t);
  if (!tools) return;
  const file = specFile(tone());
  const dir = mkdtempSync(path.join(tmpdir(), 'loud-out-'));
  const marker = path.join(mkdtempSync(path.join(tmpdir(), 'loud-mark-')), 'started');
  const child = spawn(process.execPath, [RENDER, file, '--out', path.join(dir, 'o.mp4'), ...SMALL, '--loudness', '-16'], { env: { ...process.env, FFMPEG_PATH: loudnormStandIn(tools.ffmpeg, 'hang', marker) } });
  const closed = new Promise((resolve) => child.on('close', (code, signal) => resolve({ code, signal })));
  const deadline = Date.now() + 60000;
  while (!existsSync(marker) && Date.now() < deadline) await new Promise((r) => { setTimeout(r, 20); });
  assert.ok(existsSync(marker), 'the loudnorm pass is under way');
  child.kill('SIGINT');
  const { code, signal } = await closed;
  assert.deepEqual([code, signal], [130, null]);
  assert.deepEqual(readdirSync(dir), [], 'no partial MP4 and no normalised temp');
});

// ---- Fix round 1 (review F2): the normalised temp is nine bytes longer than the encode's --------------------------------

const MAX_NAME_BYTES = 255;
const cueFolders = (scratch) => readdirSync(scratch).filter((f) => f.startsWith('motion-cues-'));

test('a batch name whose encode temp fits in 255 bytes but whose normalised temp does not is refused up front with the limit; without a target it still renders', async (t) => {
  if (!await requireRender(t)) return;
  const dir = mkdtempSync(path.join(tmpdir(), 'loud-long-'));
  const scratch = mkdtempSync(path.join(tmpdir(), 'loud-long-tmp-'));
  writeWav(path.join(dir, 'tone.wav'), { seconds: 1 });
  writeFileSync(path.join(dir, 'm.json'), JSON.stringify({ ...tone(), scenes: [scene('s', 1, [hook])] }));
  writeFileSync(path.join(dir, 'rows.json'), JSON.stringify([{}]));
  const base = 'a'.repeat(MAX_NAME_BYTES - 16); // the row's .partial temp is exactly 255 bytes
  const batch = (folder, extra) => run([path.join(dir, 'm.json'), '--batch', path.join(dir, 'rows.json'), '--out', path.join(dir, folder, `${base}{index}.mp4`), ...SMALL, ...extra], { TMPDIR: scratch });
  const plain = batch('plain', []);
  assert.equal(plain.status, 0, plain.stdout + plain.stderr);
  const flagged = batch('flagged', ['--loudness', '-16']);
  assert.equal(flagged.status, 1, flagged.stdout + flagged.stderr);
  assert.match(flagged.stdout, /row 0: --out: .*\.loudnorm.*at most 255/s);
  assert.match(flagged.stdout, /nothing rendered/);
  assert.equal(existsSync(path.join(dir, 'flagged')), false, 'nothing is written');
  assert.deepEqual(cueFolders(scratch), [], 'no cue folder is left behind');
});

test('a single render whose normalised temp name is over 255 bytes fails with the limit, and leaves no cue folder (a viral spec, no flag)', async (t) => {
  if (!await requireRender(t)) return;
  const file = specFile({ mode: 'viral', scenes: [scene('s', 1, [hook, enter('e', 0.3)])] }, {});
  const scratch = mkdtempSync(path.join(tmpdir(), 'loud-long-tmp-'));
  const out = path.join(mkdtempSync(path.join(tmpdir(), 'loud-long-out-')), `${'b'.repeat(MAX_NAME_BYTES - 12)}.mp4`); // .partial.mp4 is exactly 255 bytes
  const r = run([file, '--out', out, ...SMALL], { TMPDIR: scratch });
  assert.equal(r.status, 2, r.stdout + r.stderr); // a usage error, found before the browser starts
  assert.match(r.stderr, /--out: .*\.loudnorm.*at most 255.*--loudness off/s);
  assert.doesNotMatch(r.stdout, /\d+%/, 'no frame was captured');
  assert.deepEqual(cueFolders(scratch), [], 'no cue folder is left behind');
  assert.deepEqual(readdirSync(path.dirname(out)), [], 'nothing is written');
  const off = run([file, '--out', out, ...SMALL, '--loudness', 'off'], { TMPDIR: scratch });
  assert.equal(off.status, 0, `the same name renders when nothing is normalised: ${off.stderr}`);
  // One byte more and even the encode's own temp is too long: a clear usage error, never the raw ENAMETOOLONG.
  const longer = path.join(path.dirname(out), `${'b'.repeat(MAX_NAME_BYTES - 11)}.mp4`);
  const over = run([file, '--out', longer, ...SMALL, '--loudness', 'off'], { TMPDIR: scratch });
  assert.equal(over.status, 2, over.stdout + over.stderr);
  assert.match(over.stderr, /--out: the temporary file name .*\.partial\.mp4 is 256 bytes; at most 255/);
  assert.doesNotMatch(over.stderr, /ENAMETOOLONG/);
  assert.deepEqual(cueFolders(scratch), []);
});

// ---- Fix round 1 (review F12): an interrupt in a batch row ------------------------------------------------------------

test('an interrupt during a loudnorm pass in a batch removes every temp file (exit 130)', async (t) => {
  const tools = await requireRender(t);
  if (!tools) return;
  const dir = mkdtempSync(path.join(tmpdir(), 'loud-batch-int-'));
  writeWav(path.join(dir, 'tone.wav'), { seconds: 2 });
  writeFileSync(path.join(dir, 'm.json'), JSON.stringify(tone()));
  writeFileSync(path.join(dir, 'rows.json'), JSON.stringify([{}, {}]));
  const marker = path.join(mkdtempSync(path.join(tmpdir(), 'loud-mark-')), 'started');
  const out = path.join(dir, 'renders');
  const child = spawn(process.execPath, [RENDER, path.join(dir, 'm.json'), '--batch', path.join(dir, 'rows.json'), '--out', path.join(out, '{index}.mp4'), ...SMALL, '--loudness', '-16'], { env: { ...process.env, FFMPEG_PATH: loudnormStandIn(tools.ffmpeg, 'hang', marker) } });
  const closed = new Promise((resolve) => child.on('close', (code, signal) => resolve({ code, signal })));
  const deadline = Date.now() + 60000;
  while (!existsSync(marker) && Date.now() < deadline) await new Promise((r) => { setTimeout(r, 20); });
  assert.ok(existsSync(marker), 'the loudnorm pass is under way');
  child.kill('SIGINT');
  const { code, signal } = await closed;
  assert.deepEqual([code, signal], [130, null]);
  assert.deepEqual(readdirSync(out).filter((f) => f !== 'manifest.json'), [], 'no partial MP4, no normalised temp, no output');
});

// ---- Fix round 2 (re-review R2): wide-range signals --------------------------------------------------------------------

// Two of the re-reviewer's signals, as the first encode would write them (a video stream and a stereo AAC track). Their
// loudness range is 22.6 and 18.0 LU, so both take the limiter branch. loudnorm's measure-only passes read them 1.4 and
// 0.8 LU louder than the 48 kHz chain that pass 2 runs, so the gain computed from them lands short of the target.
const WIDE_TONE = '(sin(2*PI*110*t)+0.5*sin(2*PI*220*t)+0.25*sin(2*PI*330*t)+0.2*(random(0)-0.5))*(0.6+0.4*sin(2*PI*4*t))';
const WIDE_RANGE = {
  pianoCresc: { seconds: 20, source: "aevalsrc='0.02*pow(10,1.5*t/20)*exp(-4*mod(t,0.5))*(sin(2*PI*(262+131*mod(floor(t/0.5),3))*t)+0.3*sin(4*PI*(262+131*mod(floor(t/0.5),3))*t))':s=48000:d=20" },
  steps: { seconds: 20, source: `aevalsrc='0.3*pow(10,-(3-floor(t/5))*6/20)*${WIDE_TONE}':s=48000:d=20` },
  // Its peaks stay under the limiter's ceiling after the gain, so the raw gain reduction is negative: reported as 0 (S4).
  introChorus14: { seconds: 16, source: `aevalsrc='(if(lt(t,8),0.06,0.30))*${WIDE_TONE}':s=48000:d=16` },
};
for (const [name, { seconds, source }] of Object.entries(WIDE_RANGE)) {
  test(`normalizeFile lands the wide-range signal ${name} within 1 LU of -14 under -1 dBTP, and is byte-identical twice`, async (t) => {
    const tools = await requireRender(t, { need: ['ffmpeg'] });
    if (!tools) return;
    const dir = mkdtempSync(path.join(tmpdir(), 'loud-wide-'));
    const input = path.join(dir, 'in.mp4');
    const made = spawnSync(tools.ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=s=64x64:r=10:d=${seconds}`, '-f', 'lavfi', '-i', source, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-t', String(seconds), input], { encoding: 'utf8' });
    assert.equal(made.status, 0, made.stderr);
    const outs = [];
    for (const k of [0, 1]) {
      const out = path.join(dir, `out${k}.mp4`);
      const done = await normalizeFile(tools.ffmpeg, { input, out, target: -14, truePeak: -1, duration: seconds });
      assert.equal(done.limited, true, 'a range over 11 LU takes the limiter branch');
      assert.ok(done.reduction >= 0, `the reduction is never negative (${done.reduction})`);
      outs.push(out);
    }
    const level = measureLoudness(tools.ffmpeg, outs[0]);
    assert.ok(Math.abs(level.lufs - -14) <= 0.5 && level.truePeak <= -1, `${level.lufs} LUFS, ${level.truePeak} dBTP`); // the residual-gain correction brings it well inside 1 LU
    assert.equal(sha(outs[0]), sha(outs[1]), 'two runs are byte-identical');
  });
}

// ---- Fix round 2 (re-review R1): the limiter stage needs ffmpeg 5.1 ---------------------------------------------------

test('parseFfmpegVersion reads the version for messages: 4.4.2, 5.0, 5.1, 6.1, 8.1 and the n and distro forms; a git build has none', () => {
  const line = (v) => `ffmpeg version ${v} Copyright (c) 2000-2026 the FFmpeg developers`;
  const cases = [
    ['4.4.2-0ubuntu0.22.04.1', { major: 4, minor: 4 }],
    ['n5.0.3', { major: 5, minor: 0 }],
    ['5.0', { major: 5, minor: 0 }],
    ['5.1', { major: 5, minor: 1 }],
    ['n5.1.2', { major: 5, minor: 1 }],
    ['6.1.1-3ubuntu5', { major: 6, minor: 1 }],
    ['8.1.1', { major: 8, minor: 1 }],
    ['10.0', { major: 10, minor: 0 }],
  ];
  for (const [text, version] of cases) assert.deepEqual(parseFfmpegVersion(line(text)), version, text);
  assert.equal(parseFfmpegVersion(line('N-109345-gabcdef0123')), null, 'a git build has no number');
  assert.equal(parseFfmpegVersion(''), null);
});

// The gate is a capability probe (S3): the ffmpeg is asked to run the stage's own filters on 0.1 s of silence, once.
function probeStandIn(real, { reject, versionText, counter }) {
  const bin = path.join(mkdtempSync(path.join(tmpdir(), 'loud-probe-')), 'ffmpeg');
  const count = counter ? `echo x >> '${counter}'\n` : '';
  const version = versionText ? `if [ "$1" = "-version" ]; then echo "${versionText}"; exit 0; fi\n` : '';
  const refuse = reject ? 'case "$*" in\n  *latency*|*LRA=50*)\n    echo "Option not found" >&2\n    exit 1\n    ;;\nesac\n' : '';
  writeFileSync(bin, `#!/bin/sh\n${version}${count}${refuse}exec '${real}' "$@"\n`);
  chmodSync(bin, 0o755);
  return bin;
}

test('limiterSupported asks the ffmpeg itself: true for this one, false for one that rejects latency or LRA=50 whatever its version says, asked once', async (t) => {
  const tools = await requireRender(t, { need: ['ffmpeg'] });
  if (!tools) return;
  assert.equal(await limiterSupported(tools.ffmpeg), true);
  const counter = path.join(mkdtempSync(path.join(tmpdir(), 'loud-count-')), 'runs');
  const old = probeStandIn(tools.ffmpeg, { reject: true, versionText: 'ffmpeg version 4.4.2-0ubuntu0.22.04.1', counter });
  assert.equal(await limiterSupported(old), false);
  assert.equal(await limiterSupported(old), false);
  assert.equal(readFileSync(counter, 'utf8').trim().split('\n').length, 1, 'one dry run for two asks (cached)');
  // A git build prints no version number, and an old one still says no; a new one that prints a 4.x string still says yes.
  assert.equal(await limiterSupported(probeStandIn(tools.ffmpeg, { reject: true, versionText: 'ffmpeg version N-109345-gabcdef0123' })), false);
  assert.equal(await limiterSupported(probeStandIn(tools.ffmpeg, { reject: false, versionText: 'ffmpeg version 4.4.2-custom' })), true);
});

test('gainArgs: the exact fallback array, a plain volume and no loudnorm', () => {
  assert.deepEqual(gainArgs({ input: '/a/in.mp4', out: '/a/out.mp4', gain: 13.6612, duration: 2 }),
    ['-y', '-protocol_whitelist', 'file,pipe', '-i', '/a/in.mp4', '-c:v', 'copy', '-af', 'volume=13.66dB', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-t', '2', '-movflags', '+faststart', '/a/out.mp4']);
  assert.deepEqual(gainArgs({ input: '/a/in.mp4', out: '/a/out.mp4', gain: -2 }).slice(7, 9), ['-af', 'volume=-2.00dB']);
});

// A stand-in that says it is ffmpeg 4.4.2 and, like that release, rejects alimiter's `latency` option and an LRA over 20.
function oldFfmpegStandIn(real) {
  const bin = path.join(mkdtempSync(path.join(tmpdir(), 'loud-old-')), 'ffmpeg');
  writeFileSync(bin, `#!/bin/sh\nif [ "$1" = "-version" ]; then echo "ffmpeg version 4.4.2-0ubuntu0.22.04.1 Copyright (c) 2000-2021 the FFmpeg developers"; exit 0; fi\ncase "$*" in\n  *latency*|*LRA=50*)\n    echo "Option 'latency' not found" >&2\n    exit 1\n    ;;\nesac\nexec '${real}' "$@"\n`);
  chmodSync(bin, 0o755);
  return bin;
}

test('on an ffmpeg older than 5.1 a mix that needs the limiter is normalised with one gain and a stderr note, and the render does not fail', async (t) => {
  const tools = await requireRender(t);
  if (!tools) return;
  const file = specFile(CUES_ONLY.cues2s, {});
  const out = path.join(mkdtempSync(path.join(tmpdir(), 'loud-old-out-')), 'v.mp4');
  const r = run([file, '--out', out, ...SMALL], { FFMPEG_PATH: oldFfmpegStandIn(tools.ffmpeg) });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stderr, /^loudness: this mix needs the limiter stage to reach the target, which needs ffmpeg 5\.1 or later \(this is 4\.4\); it is normalised with a plain gain capped at the true-peak ceiling, so it may read off target$/m);
  assert.ok(existsSync(out));
  const quiet = await renderHash(file, [...SMALL, '--loudness', 'off']);
  assert.ok(measureLoudness(tools.ffmpeg, out).lufs > measureLoudness(tools.ffmpeg, quiet.out).lufs + 10, 'louder than the unnormalised mix, never quieter');
  assert.match(r.stdout, /^loudness: target -14 LUFS \/ -1 dBTP; measured .* dBTP \((on|off) target\)$/m);
  assert.deepEqual(readdirSync(path.dirname(out)), ['v.mp4'], 'no temp file is left');
  // A mix that never needs the limiter is untouched by the older version: same bytes, no note.
  const toneFile = specFile(viral());
  const old = run([toneFile, '--out', path.join(path.dirname(out), 't-old.mp4'), ...SMALL], { FFMPEG_PATH: oldFfmpegStandIn(tools.ffmpeg) });
  assert.equal(old.status, 0, old.stderr);
  assert.doesNotMatch(old.stderr, /limiter/);
  assert.equal(sha(path.join(path.dirname(out), 't-old.mp4')), (await renderHash(toneFile, SMALL)).sha256);
});

// ---- Fix round 2 (re-review R7): the limiter's gain reduction is announced --------------------------------------------

test('a mix whose peaks the limiter must cut by more than 6 dB says so on stderr; one under that says nothing', async (t) => {
  const tools = await requireRender(t, { need: ['ffmpeg'] });
  if (!tools) return;
  const dir = mkdtempSync(path.join(tmpdir(), 'loud-note-'));
  const make = (name, source) => {
    const out = path.join(dir, name);
    const r = spawnSync(tools.ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=s=64x64:r=10:d=6', '-f', 'lavfi', '-i', source, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-t', '6', out], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return out;
  };
  // A quiet bed (-34 dBFS tone) with one loud click per second: about -29 LUFS with peaks near -3 dBFS.
  const peaky = make('peaky.mp4', "aevalsrc='0.02*sin(2*PI*220*t)+0.7*lt(mod(t,1),0.002)*sin(2*PI*1000*t)':s=48000:d=6");
  const done = await normalizeFile(tools.ffmpeg, { input: peaky, out: path.join(dir, 'peaky-out.mp4'), target: -14, truePeak: -1, duration: 6 });
  assert.equal(done.limited, true);
  assert.ok(done.reduction > LIMITER_NOTE_DB, `reduction ${done.reduction} dB`);
  const render = run([specFile(CUES_ONLY.cues2s, {}), '--out', path.join(dir, 'r.mp4'), ...SMALL]);
  assert.equal(render.status, 0, render.stderr);
  assert.doesNotMatch(render.stderr, /limiter reduces/, 'a cue mix is cut by about 5 dB');
});

// ---- Fix round 3 (re-review S1): the fallback is a plain gain ----------------------------------------------------------

// ffmpeg 4.4 to 5.0 cap loudnorm's gain on an input under 3 s with a difference of two amplitudes (fixed in 6.0), which
// makes a short cues-only clip quieter. The stand-in cannot reproduce that, so this runs the fallback path on 8.1 with the
// stage switched off and asserts the part that does not depend on loudnorm: a plain gain, capped by the true peak.
test('without the limiter stage a cues-only mix gets a plain gain capped at the true-peak ceiling: louder, never quieter, peak at or under the ceiling', async (t) => {
  const tools = await requireRender(t);
  if (!tools) return;
  const file = specFile(CUES_ONLY.cues2s, {});
  const raw = await renderHash(file, [...SMALL, '--loudness', 'off']);
  const before = measureLoudness(tools.ffmpeg, raw.out);
  const measured = await measureLoudnorm(tools.ffmpeg, raw.out, -14, -1.5);
  const cap = -1.5 - Number(measured.input_tp); // the gain the ceiling allows, less than the 16 dB the target asks for
  const out = path.join(path.dirname(raw.out), 'fallback.mp4');
  // The stand-in refuses a loudnorm in the output pass (the one that copies the video): old loudnorm is what goes wrong there.
  const noLoudnormPass2 = path.join(mkdtempSync(path.join(tmpdir(), 'loud-nl-')), 'ffmpeg');
  writeFileSync(noLoudnormPass2, `#!/bin/sh\ncase "$*" in\n  *"-c:v copy"*loudnorm*) echo "loudnorm in the output pass" >&2; exit 1;;\nesac\nexec '${tools.ffmpeg}' "$@"\n`);
  chmodSync(noLoudnormPass2, 0o755);
  const done = await normalizeFile(noLoudnormPass2, { input: raw.out, out, target: -14, truePeak: -1, duration: 2, limiter: false });
  assert.equal(done.unavailable, true);
  assert.equal(done.limited, false);
  const after = measureLoudness(tools.ffmpeg, out);
  assert.ok(Math.abs(after.lufs - (before.lufs + cap)) <= 0.5, `${before.lufs} LUFS + ${cap.toFixed(2)} dB gives ${after.lufs} LUFS`);
  assert.ok(after.lufs > before.lufs + 10, 'much louder than the unnormalised mix');
  assert.ok(after.truePeak <= -1.2, `${after.truePeak} dBTP`);
});

// ---- Fix round 3 (re-review S5): doctor shows the 5.1 requirement as a note --------------------------------------------

test('doctor notes that the loudness limiter stage needs ffmpeg 5.1 or later, with the installed version, and never counts it as missing', async (t) => {
  const tools = await requireRender(t, { need: ['ffmpeg'] });
  if (!tools) return;
  const DOCTOR = path.join(root, 'scripts/doctor.mjs');
  const doctor = (ffmpeg, args = []) => spawnSync(process.execPath, [DOCTOR, ...args], { encoding: 'utf8', env: { ...process.env, FFMPEG_PATH: ffmpeg } });
  const plain = doctor(tools.ffmpeg);
  assert.match(plain.stdout, /^Note: loudness-limiter — the loudness limiter stage needs ffmpeg 5\.1 or later; this is \S+$/m);
  const old = doctor(probeStandIn(tools.ffmpeg, { reject: true, versionText: 'ffmpeg version 4.4.2-0ubuntu0.22.04.1 Copyright (c) 2000-2021 the FFmpeg developers' }));
  assert.match(old.stdout, /^Note: loudness-limiter — the loudness limiter stage needs ffmpeg 5\.1 or later; this is 4\.4\.2-0ubuntu0\.22\.04\.1$/m);
  assert.equal(old.status, plain.status, 'an old ffmpeg changes no exit status');
  const json = JSON.parse(doctor(tools.ffmpeg, ['--json']).stdout);
  assert.equal(json.missing.some((m) => m.id === 'loudness-limiter'), false);
  assert.ok(json.info.some((i) => i.id === 'loudness-limiter'));
});

// P3: procedural sound cues. The generators are pure and seeded, so the same cue is the same WAV, byte for byte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cueWav, writeCueTracks, synthesiseCues, noteHz, SAMPLE_RATE } from '../scripts/lib/cues.mjs';
import { CUE_NAMES, MAX_CUES, resolveCues } from '../template/audio.mjs';
import { validateSpec } from '../scripts/lib/spec.mjs';
import { parseLoudness, encodeArgs } from '../scripts/lib/ffmpeg.mjs';
import { requireRender, BROWSER_ONLY } from './helpers/render.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RENDER = path.join(root, 'scripts/render.mjs');
const tmp = (p) => mkdtempSync(path.join(tmpdir(), p));
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const spec = (extra = {}) => ({ size: [160, 90], scenes: [{ id: 'one', duration: 2, elements: [] }, { id: 'two', duration: 2, elements: [] }], ...extra });
const errs = (motion) => validateSpec(motion).errors.map((e) => `${e.path}: ${e.message}`);

// 16-bit stereo PCM -> { rate, channels, left, right } sample arrays in -1..1.
function readWav(buf) {
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF');
  assert.equal(buf.toString('ascii', 8, 12), 'WAVE');
  assert.equal(buf.readUInt16LE(20), 1, 'PCM');
  assert.equal(buf.readUInt16LE(34), 16, '16-bit');
  const channels = buf.readUInt16LE(22);
  const data = buf.subarray(44);
  assert.equal(buf.readUInt32LE(40), data.length, 'data chunk length');
  const left = []; const right = [];
  for (let i = 0; i < data.length; i += 2 * channels) {
    left.push(data.readInt16LE(i) / 32768);
    right.push(data.readInt16LE(i + 2 * (channels - 1)) / 32768);
  }
  return { rate: buf.readUInt32LE(24), channels, left, right };
}
const peak = (xs) => xs.reduce((m, x) => Math.max(m, Math.abs(x)), 0);

// ---- generators --------------------------------------------------------------------------------

const LENGTH = { pop: [0.05, 0.3], click: [0.01, 0.1], whoosh: [0.4, 1.5], chime: [0.8, 2.5], impact: [0.4, 1.5], riser: [1.2, 2], swoosh: [0.2, 0.5], typing: [0.05, 0.2], drop: [0.4, 1], ding: [0.3, 0.8] }; // plausible seconds (typing: one character)
const HASHES = {
  pop: '05ceac153a43e2fa1f13919f33b3e7aff764da5e577e7c900b5ba39c6b176054',
  click: 'dda6a952655125403ec05266280ca7c04bfa0c8241684a65964c6624786b5497',
  whoosh: '7efa3af288449415b5915e6f6e4629920390379d1c6f8ad864be952326f42d63',
  chime: 'bbb6caa15474b90ee7e8ba5415830376abf7e55f90f267b172ab92359297aee2',
  impact: '84827605aeafda789d0e89436c4c74d69e14543978ca45819d7dc91e2e61a3ec',
  riser: '79d5c5297a56f9b8aa3e6bd379d53728095f780aaf622458316387d3df78bc2d',
  swoosh: 'f5deb7652f488830374cb7caef5075684566e5f425a6c476eb6a666829d53cff',
  typing: '3353297ca50ae09b6b664d0e2d8d205d7d96db50239e829868f492f35dd02fe0',
  drop: '793be04e68628a0c342c02b9f1112feafe1f11233577689acb48e2578155ec9a',
  ding: '16a9e8e970c08c6c7ba0d6cb69d9f09848f874d752ab072795df621954f9abc1',
};

for (const cue of CUE_NAMES) {
  test(`cue ${cue}: a 48 kHz stereo 16-bit WAV of plausible length, peak near -6 dBFS, and the same bytes every time`, () => {
    const wav = cueWav({ cue });
    const { rate, channels, left, right } = readWav(wav);
    assert.equal(rate, SAMPLE_RATE);
    assert.equal(channels, 2);
    const seconds = left.length / rate;
    assert.ok(seconds >= LENGTH[cue][0] && seconds <= LENGTH[cue][1], `${cue} is ${seconds}s`);
    assert.ok(Math.abs(peak(left) - 0.5) < 0.01 && Math.abs(peak(right) - 0.5) < 0.01, `peak ${peak(left)}`);
    assert.ok(Math.abs(left.at(-1)) < 0.01, 'ends at silence, so it never clicks');
    assert.equal(sha(cueWav({ cue })), sha(wav));
    assert.equal(sha(wav), HASHES[cue], `${cue} changed: update HASHES only for an intended change of the sound`);
  });
}

test('the ten cues are distinct sounds', () => {
  assert.equal(new Set(CUE_NAMES.map((cue) => sha(cueWav({ cue })))).size, CUE_NAMES.length);
  assert.deepEqual([...CUE_NAMES], ['pop', 'click', 'whoosh', 'chime', 'impact', 'riser', 'swoosh', 'typing', 'drop', 'ding']);
});

test('note sets the pitch of pop, chime and impact; pan places the cue between the channels', () => {
  assert.notEqual(sha(cueWav({ cue: 'chime', note: 'C5' })), sha(cueWav({ cue: 'chime' })));
  assert.throws(() => noteHz('H9'), /not a note name: "H9"/);
  assert.throws(() => noteHz(undefined), /not a note name/);
  assert.ok(Math.abs(noteHz('A4') - 440) < 1e-9);
  assert.ok(Math.abs(noteHz('C4') - 261.6256) < 1e-3);
  assert.ok(Math.abs(noteHz('Bb3') - 233.0819) < 1e-3);
  const left = readWav(cueWav({ cue: 'pop', pan: -1 }));
  assert.equal(peak(left.right), 0, 'hard left leaves the right channel silent');
  assert.ok(peak(left.left) > 0.5);
  const centre = readWav(cueWav({ cue: 'pop', pan: 0 }));
  assert.deepEqual(centre.left, centre.right);
});

// ---- timing and tracks -------------------------------------------------------------------------

test('cues start at their scene plus `at`, so retiming an earlier scene keeps them aligned', () => {
  const cues = [{ cue: 'pop', at: 0.25 }, { cue: 'chime', scene: 'two', at: 0.5, volume: 0.4 }];
  assert.deepEqual(resolveCues(spec({ cues })).map((c) => [c.cue, c.start, c.volume]), [['pop', 0.25, 1], ['chime', 2.5, 0.4]]);
  const longer = spec({ cues });
  longer.scenes[0].duration = 3;
  assert.equal(resolveCues(longer)[1].start, 3.5);
});

test('writeCueTracks gives one WAV file and one mix track per cue, clamped to the video end, volume literal; no cues, no tracks', () => {
  const dir = tmp('cue-tracks-');
  const tracks = writeCueTracks(spec({ cues: [{ cue: 'pop', at: 0.1, volume: 0.3 }, { cue: 'whoosh', scene: 'two', at: 1.8 }] }), dir);
  assert.equal(tracks.length, 2);
  assert.deepEqual(readdirSync(dir).sort(), ['cue-0-pop.wav', 'cue-1-whoosh.wav']);
  assert.ok(tracks.every((t) => existsSync(t.file) && t.fadeIn === 0 && t.fadeOut === 0.005), 'every cue gets a 5 ms fade-out, so a cue cut at the video end cannot click');
  assert.equal(tracks[0].volume, 0.3);
  assert.equal(tracks[1].start, 3.8);
  assert.equal(tracks[1].end, 4, 'the whoosh is longer than the 0.2 s left, so it is cut at the video end');
  assert.deepEqual(writeCueTracks(spec(), tmp('cue-none-')), []);
});

test('synthesiseCues makes its own temp folder, returns it with the tracks, and removes it if a cue cannot be written', () => {
  const scratch = tmp('cue-scratch-');
  const made = synthesiseCues(spec({ cues: [{ cue: 'pop', at: 0 }] }), scratch);
  assert.equal(path.dirname(made.dir), scratch);
  assert.equal(made.tracks.length, 1);
  assert.ok(existsSync(made.tracks[0].file));
  assert.equal(synthesiseCues(spec(), scratch).dir, null, 'no cues: no folder');
  const before = readdirSync(scratch).length;
  assert.throws(() => synthesiseCues(spec({ cues: [{ cue: 'pop', at: 0 }, { cue: 'bogus', at: 1 }] }), scratch));
  assert.equal(readdirSync(scratch).length, before, 'a failed synthesis leaves no folder behind');
});

test('the mix fades every cue out over its last 5 ms, so one cut by the video end does not end in a click', () => {
  const tracks = writeCueTracks(spec({ cues: [{ cue: 'whoosh', scene: 'two', at: 1.9 }] }), tmp('cue-fade-'));
  const args = encodeArgs({ fps: 10, out: 'x.mp4', audio: tracks, duration: 4 });
  const graph = args[args.indexOf('-filter_complex') + 1];
  assert.match(graph, /afade=t=out:st=0\.095:d=0\.005/, graph);
});

// ---- validation --------------------------------------------------------------------------------

test('valid cues pass', () => {
  assert.deepEqual(errs(spec({ cues: [{ cue: 'pop', at: 0 }, { cue: 'chime', scene: 'two', at: 1, volume: 0.5, pan: -0.5, note: 'G#5' }, { cue: 'impact', at: 3.9, note: 'F2' }] })), []);
});

test('an unknown cue gets a did-you-mean, and a bad at, scene, volume, pan or note is named', () => {
  assert.deepEqual(errs(spec({ cues: [{ cue: 'whoosh', at: 1 }, { cue: 'chim', at: 0 }] })), ['cues[1].cue: must be one of "pop", "click", "whoosh", "chime", "impact", "riser", "swoosh", "typing", "drop", "ding", "kenney:click", "kenney:tick", "kenney:switch", "kenney:select", "kenney:confirm", "kenney:error", "kenney:open", "kenney:close", "kenney:pluck", "kenney:glass", "kenney:thud", "kenney:metal"; did you mean "chime"?']);
  assert.ok(errs(spec({ cues: [{ cue: 'pop', at: -1 }] }))[0].startsWith('cues[0].at:'));
  assert.deepEqual(errs(spec({ cues: [{ cue: 'pop' }] })), ['cues[0].at: required']);
  assert.deepEqual(errs(spec({ cues: [{ cue: 'pop', at: 4 }] })), ['cues[0].at: starts at 4s, but the video ends at 4s']);
  assert.deepEqual(errs(spec({ cues: [{ cue: 'pop', scene: 'three', at: 0 }] })), ['cues[0].scene: scene "three" not found; scenes: one, two']);
  assert.deepEqual(errs(spec({ cues: [{ cue: 'pop', scene: 'two', at: 2 }] })), ['cues[0].at: 2s is past the end of scene "two", which lasts 2s; use a smaller at, or put the cue in a later scene']);
  assert.deepEqual(errs(spec({ cues: [{ cue: 'pop', scene: 'one', at: 3 }] })), ['cues[0].at: 3s is past the end of scene "one", which lasts 2s; use a smaller at, or put the cue in a later scene'], 'it would have played in the next scene');
  assert.ok(errs(spec({ cues: [{ cue: 'pop', at: 0, volume: 2 }] }))[0].startsWith('cues[0].volume:'));
  assert.ok(errs(spec({ cues: [{ cue: 'pop', at: 0, pan: 1.5 }] }))[0].startsWith('cues[0].pan:'));
  assert.deepEqual(errs(spec({ cues: [{ cue: 'chime', at: 0, note: 'H9' }] })), ['cues[0].note: must be a note name such as A4, C#5 or Bb3 (A-G, optional # or b, octave 0-8)']);
});

test('note has no meaning on click and whoosh, which are noise', () => {
  assert.deepEqual(errs(spec({ cues: [{ cue: 'click', at: 0, note: 'A4' }] })), ['cues[0].note: click has no pitch; note is for pop, chime, impact, drop and ding']);
});

test('more than the cap is rejected and the error names the cap', () => {
  const cues = Array.from({ length: MAX_CUES + 1 }, (_, i) => ({ cue: 'click', at: i * 0.05 }));
  const e = errs(spec({ cues }));
  assert.equal(e.length, 1, e.join('\n'));
  assert.match(e[0], new RegExp(`^cues: .*\\b${MAX_CUES}\\b`));
  assert.deepEqual(errs(spec({ cues: cues.slice(0, MAX_CUES) })), []);
});

// ---- loudness parsing --------------------------------------------------------------------------

test('parseLoudness reads the integrated loudness and true peak from the ebur128 summary, and -inf as silence', () => {
  const summary = `[Parsed_ebur128_0 @ 0x1] Summary:\n\n  Integrated loudness:\n    I:         -19.4 LUFS\n    Threshold: -29.4 LUFS\n\n  Loudness range:\n    LRA:         0.0 LU\n\n  True peak:\n    Peak:       -3.1 dBFS\n`;
  assert.deepEqual(parseLoudness(summary), { lufs: -19.4, truePeak: -3.1 });
  assert.deepEqual(parseLoudness(summary.replace('-19.4', '-inf').replace('-3.1', '-inf')), { lufs: -Infinity, truePeak: -Infinity });
  assert.equal(parseLoudness('nothing useful'), null);
});

// ---- a real render -----------------------------------------------------------------------------

const meanDb = (ff, file, filters) => {
  const r = spawnSync(ff, ['-i', file, '-af', `${filters}volumedetect`, '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /mean_volume: (-?[\d.]+) dB/.exec(r.stderr);
  return m ? Number(m[1]) : Number.NaN;
};
const render = (args, env = {}) => spawnSync(process.execPath, [RENDER, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });

test('a render with cues muxes an AAC stream, places the cue where the spec says, prints the loudness line and leaves no temp files', async (t) => {
  const tools = await requireRender(t);
  if (!tools) return undefined;
  const ff = tools.ffmpeg;
  const dir = tmp('cue-render-');
  const scratch = tmp('cue-scratch-');
  writeFileSync(path.join(dir, 'm.json'), JSON.stringify(spec({ cues: [{ cue: 'chime', scene: 'two', at: 0.5, volume: 0.8 }] })));
  const out = path.join(dir, 'v.mp4');
  const r = render([path.join(dir, 'm.json'), '--out', out, '--fps', '10', '--size', '160x90'], { TMPDIR: scratch });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const info = spawnSync(ff, ['-i', out], { encoding: 'utf8' }).stderr;
  assert.match(info, /Audio: aac.*stereo/);
  assert.ok(meanDb(ff, out, 'atrim=0:2.4,') < -60, 'silent before the cue');
  assert.ok(meanDb(ff, out, 'atrim=2.5:3.3,') > -45, 'the chime is audible from 2.5 s');
  assert.match(r.stdout, /^audio: -\d+(\.\d)? LUFS integrated, true peak -?\d+(\.\d)? dBTP$/m);
  assert.deepEqual(readdirSync(scratch), [], 'the generated cue files are removed');
  return undefined;
});

test('a render without cues has no audio stream and prints no loudness line', async (t) => {
  const tools = await requireRender(t);
  if (!tools) return undefined;
  const ff = tools.ffmpeg;
  const dir = tmp('cue-none-');
  writeFileSync(path.join(dir, 'm.json'), JSON.stringify(spec()));
  const out = path.join(dir, 'v.mp4');
  const r = render([path.join(dir, 'm.json'), '--out', out, '--fps', '10', '--size', '160x90']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(spawnSync(ff, ['-i', out], { encoding: 'utf8' }).stderr, /Audio:/);
  assert.doesNotMatch(r.stdout, /LUFS/);
  return undefined;
});

test('--contact-sheet ignores cues and needs no ffmpeg', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return undefined;
  const dir = tmp('cue-sheet-');
  writeFileSync(path.join(dir, 'm.json'), JSON.stringify(spec({ cues: [{ cue: 'pop', at: 0 }] })));
  const r = render([path.join(dir, 'm.json'), '--contact-sheet', '--out', dir, '--size', '160x90'], { PATH: '/nonexistent' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return undefined;
});

test('the cue WAV bytes read back as the file the mix is given', () => {
  const dir = tmp('cue-file-');
  const [track] = writeCueTracks(spec({ cues: [{ cue: 'click', at: 0 }] }), dir);
  assert.equal(sha(readFileSync(track.file)), sha(cueWav({ cue: 'click' })));
});

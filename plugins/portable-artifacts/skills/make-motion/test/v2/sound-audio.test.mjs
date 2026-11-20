// Root `audio: [{ src, at? }]`: extra audio files (a sound effect, a second music file), contained in the film's folder,
// probed and measured as the music file is, placed at `at`, set like the music and ducked under the voice. Validation
// in <json.path>: <message> form. The render test needs a browser, ffmpeg and ffprobe.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { browserAvailable, ffmpegOrNull } from './helpers/session.mjs';
import { writeClicks, writeNoise } from './helpers/clicks.mjs';
import { findFfprobe } from '../../scripts/lib/ffmpeg.mjs';
import '../../scripts/v2/list.mjs';
import { validateFilm } from '../../scripts/v2/spec.mjs';
import { runMake } from '../../scripts/v2/run.mjs';
import { mixArgs } from '../../scripts/v2/voice/master.mjs';

const BAR = { type: 'path', id: 'bar', props: { d: 'M300 500H1620V580H300Z', fill: '#15130f' } };
const SHOTS = [{ id: 'a', show: 'free', hold: 2, background: '#f3eee3', nodes: [BAR] }, { id: 'b', show: 'free', hold: 2, background: '#1f4e8c', cut: 'cut', nodes: [BAR] }];

let dir;
before(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'mm-audio-'));
  writeClicks(path.join(dir, 'sting.wav'), { bpm: 120, seconds: 1 });
  writeNoise(path.join(dir, 'room.wav'), { seconds: 6 });
  mkdirSync(path.join(dir, 'inner'));
});
after(() => rmSync(dir, { recursive: true, force: true }));
const validate = (audio, specDir = dir) => validateFilm({ version: 2, audio, shots: SHOTS }, { specDir });

test('a good list validates; each problem is at its path', () => {
  assert.deepEqual(validate([{ src: 'sting.wav', at: 1.5 }, { src: 'room.wav' }]).errors, []);
  const cases = [
    [[{ src: '../x.wav' }], 'audio[0].src'],
    [[{ src: 'missing.wav' }], 'audio[0].src'],
    [[{ src: 'sting.wav', at: -1 }], 'audio[0].at'],
    [[{ src: 'sting.wav', volume: 1 }], 'audio[0].volume'],
    [[5], 'audio[0]'],
    [[{ at: 1 }], 'audio[0].src'],
  ];
  for (const [audio, at] of cases) {
    const errors = validate(audio, path.join(dir, 'inner')).errors.concat(validate(audio).errors);
    assert.ok(errors.some((e) => e.path === at), `${JSON.stringify(audio)}: ${JSON.stringify(errors)}`);
  }
  assert.ok(validate(Array.from({ length: 21 }, () => ({ src: 'sting.wav' }))).errors.some((e) => e.path === 'audio'));
});

test('the mix places an extra file at its time, reads it through the file whitelist, and ducks it like the music', () => {
  const args = mixArgs({ tracks: [{ file: '/f/sting.wav', recording: true, fadeFrom: null, at: 1.5, duck: [], lufs: -20 }], duration: 4, loudness: { lufs: -16, truePeakDb: -1 } });
  const graph = args[args.indexOf('-filter_complex') + 1];
  assert.match(graph, /adelay=1500:all=1/);
  assert.match(graph, /\[x0\]/);
  assert.ok(args.includes('-protocol_whitelist'), 'opened through the file-only whitelist');
});

async function tools(t) {
  if (!await browserAvailable()) { t.skip('no browser'); return null; }
  const ffmpeg = await ffmpegOrNull();
  const ffprobe = ffmpeg ? findFfprobe({ ffmpeg }) : null;
  if (!ffprobe) { t.skip('no ffmpeg or ffprobe'); return null; }
  return { ffmpeg, ffprobe };
}

test('a silent film with two extra files renders one audio stream, measured in the file, and says how many tracks', async (t) => {
  const found = await tools(t);
  if (!found) return;
  const specPath = path.join(dir, 'film.json');
  writeFileSync(specPath, JSON.stringify({ version: 2, audio: [{ src: 'room.wav' }, { src: 'sting.wav', at: 1.5 }], shots: SHOTS }));
  const out = path.join(dir, 'out', 'film.mp4');
  const { report, exitCode } = await runMake({ specPath, out, exact: false, noRender: false, outline: false });
  assert.equal(exitCode, 0, JSON.stringify(report.findings) + JSON.stringify(report.error));
  assert.equal(report.audio.tracks, 2);
  assert.ok(Number.isFinite(report.audio.lufs), JSON.stringify(report.audio));
  const streams = JSON.parse(spawnSync(found.ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', out], { encoding: 'utf8' }).stdout).streams;
  assert.deepEqual(streams.map((s) => s.codec_type).sort(), ['audio', 'video']);
});

test('an extra file that starts after the film ends is refused at audio[i].at', async (t) => {
  const found = await tools(t);
  if (!found) return;
  const specPath = path.join(dir, 'late.json');
  writeFileSync(specPath, JSON.stringify({ version: 2, audio: [{ src: 'sting.wav', at: 30 }], shots: SHOTS }));
  const { report, exitCode } = await runMake({ specPath, out: path.join(dir, 'out-late', 'film.mp4'), exact: false, noRender: true, outline: false });
  assert.equal(exitCode, 1);
  assert.ok(report.findings.some((f) => f.path === 'audio[0].at' && /after the film ends/.test(f.message)), JSON.stringify(report.findings));
});

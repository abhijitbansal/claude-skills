// Task 3b: the bundled Kenney CC0 sample pack, used as `"cue": "kenney:<alias>"`.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { syncBuiltinESMExports } from 'node:module';
import fs, { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cueWav, loadSample, SAMPLE_RATE } from '../scripts/lib/cues.mjs';
import { CUE_NAMES, KENNEY_NAMES, isSampleCue } from '../template/audio.mjs';
import { validateSpec } from '../scripts/lib/spec.mjs';
import { requireRender, renderHash, assertRendersIdentically } from './helpers/render.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KENNEY_DIR = path.join(root, 'assets/sfx/kenney');
const LICENCE = path.join(root, 'assets/sfx/LICENSES/kenney.txt');
const EXAMPLE = path.join(root, 'references/examples/sample-cues.json');
const MAX_SECONDS = 1.5;
const MAX_FOLDER_BYTES = 600 * 1024;
const spec = (cues) => ({ size: [160, 90], scenes: [{ id: 'one', duration: 2, elements: [] }, { id: 'two', duration: 2, elements: [] }], cues });
const errs = (motion) => validateSpec(motion).errors.map((e) => `${e.path}: ${e.message}`);
const quoted = (names) => names.map((n) => JSON.stringify(n)).join(', ');
const ENUM_LIST = quoted([...CUE_NAMES, ...KENNEY_NAMES.map((n) => `kenney:${n}`)]);

function readWav(buf) {
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF');
  assert.equal(buf.toString('ascii', 8, 12), 'WAVE');
  assert.equal(buf.readUInt16LE(20), 1, 'PCM');
  const channels = buf.readUInt16LE(22);
  const bits = buf.readUInt16LE(34);
  assert.equal(bits, 16);
  const data = buf.subarray(44);
  const left = []; const right = [];
  for (let i = 0; i < data.length; i += 2 * channels) {
    left.push(data.readInt16LE(i) / 32768);
    right.push(data.readInt16LE(i + 2 * (channels - 1)) / 32768);
  }
  return { rate: buf.readUInt32LE(24), channels, bits, left, right };
}
const peak = (xs) => xs.reduce((m, x) => Math.max(m, Math.abs(x)), 0);

test('the twelve aliases are fixed', () => {
  assert.deepEqual([...KENNEY_NAMES], ['click', 'tick', 'switch', 'select', 'confirm', 'error', 'open', 'close', 'pluck', 'glass', 'thud', 'metal']);
  assert.ok(isSampleCue('kenney:click'));
  assert.ok(!isSampleCue('click'));
  assert.ok(!isSampleCue('pop'));
});

test('every KENNEY_NAMES alias has a 48 kHz mono 16-bit WAV of at most 1.5 s with a peak between 0.49 and 0.5; the folder is at most 600 KB', () => {
  assert.deepEqual(readdirSync(KENNEY_DIR).sort(), KENNEY_NAMES.map((n) => `${n}.wav`).sort(), 'exactly one WAV per alias');
  for (const alias of KENNEY_NAMES) {
    const { rate, channels, bits, left } = readWav(readFileSync(path.join(KENNEY_DIR, `${alias}.wav`)));
    assert.deepEqual([rate, channels, bits], [48000, 1, 16], alias);
    assert.ok(left.length / rate <= MAX_SECONDS, `${alias} is ${left.length / rate} s`);
    const top = peak(left);
    assert.ok(top >= 0.49 && top <= 0.5, `${alias} peaks at ${top}`);
  }
  const bytes = KENNEY_NAMES.reduce((sum, n) => sum + statSync(path.join(KENNEY_DIR, `${n}.wav`)).size, 0);
  assert.ok(bytes <= MAX_FOLDER_BYTES, `${bytes} bytes`);
});

test('LICENSES/kenney.txt names every alias with its source file and a kenney.nl URL, and the CC0 URL', () => {
  const text = readFileSync(LICENCE, 'utf8');
  assert.ok(text.includes('https://creativecommons.org/publicdomain/zero/1.0/'), 'CC0 URL');
  assert.ok(text.includes('https://kenney.nl/assets/interface-sounds'), 'interface pack URL');
  assert.ok(text.includes('https://kenney.nl/assets/impact-sounds'), 'impact pack URL');
  for (const alias of KENNEY_NAMES) {
    const line = text.split('\n').find((l) => l.startsWith(`${alias}.wav <- `));
    assert.ok(line, `${alias}: no source line`);
    assert.match(line, /^\S+\.wav <- [\w-]+\.ogg \(https:\/\/kenney\.nl\/assets\/(interface|impact)-sounds\)$/, line);
  }
  assert.match(text, /ffmpeg/, 'the conversion command is recorded');
});

test('kenney:clik, kenney:../click, kenney:click.wav and kenney: are rejected with the table message; nothing under assets/ is read for them', () => {
  const reads = [];
  const real = fs.readFileSync;
  mock.method(fs, 'readFileSync', (...args) => { reads.push(String(args[0])); return real(...args); });
  syncBuiltinESMExports();
  try {
    const bad = ['kenney:clik', 'kenney:../click', 'kenney:click.wav', 'kenney:'];
    for (const cue of bad) {
      const [message] = errs(spec([{ cue, at: 0 }]));
      assert.ok(message.startsWith(`cues[0].cue: must be one of ${ENUM_LIST}`), `${cue}: ${message}`);
      assert.throws(() => loadSample(cue.slice('kenney:'.length)), /unknown sample/);
      assert.throws(() => cueWav({ cue }), /unknown sample/);
    }
    assert.equal(errs(spec([{ cue: 'kenney:clik', at: 0 }]))[0], `cues[0].cue: must be one of ${ENUM_LIST}; did you mean "kenney:click"?`);
    assert.deepEqual(reads.filter((p) => p.includes('assets')), [], 'a rejected alias never touches the pack folder');
    loadSample('click');
    assert.ok(reads.some((p) => p.includes(path.join('assets', 'sfx', 'kenney', 'click.wav'))), 'the spy does see a real read, so the empty list above means something');
  } finally {
    mock.restoreAll();
    syncBuiltinESMExports();
  }
  assert.deepEqual(errs(spec([{ cue: 'kenney:click', at: 0 }, { cue: 'kenney:metal', scene: 'two', at: 1 }])), [], 'a real alias is accepted');
});

test('note on kenney:click and follow on kenney:click: exact texts', () => {
  assert.deepEqual(errs(spec([{ cue: 'kenney:click', at: 0, note: 'A4' }])), ['cues[0].note: kenney:click has no pitch; note is for pop, chime, impact, drop and ding']);
  assert.deepEqual(errs(spec([{ cue: 'kenney:click', follow: 'title' }])), ['cues[0].follow: only typing takes follow']);
});

test('loadSample reads the table alias into a Float64Array in -1..1', () => {
  const click = loadSample('click');
  assert.ok(click instanceof Float64Array);
  assert.ok(click.length > 0 && click.length <= MAX_SECONDS * SAMPLE_RATE);
  assert.ok(Math.abs(peak(click) - 0.5) < 0.01);
  assert.throws(() => loadSample('pop'), /unknown sample "kenney:pop"; samples: kenney:click, kenney:tick, kenney:switch, kenney:select, kenney:confirm, kenney:error, kenney:open, kenney:close, kenney:pluck, kenney:glass, kenney:thud, kenney:metal$/);
});

test('cueWav kenney:click is the same bytes twice, peaks at 0.5, and pans like a synth cue', () => {
  const wav = cueWav({ cue: 'kenney:click' });
  assert.deepEqual(wav, cueWav({ cue: 'kenney:click' }));
  const centre = readWav(wav);
  assert.equal(centre.channels, 2);
  assert.equal(centre.rate, SAMPLE_RATE);
  assert.ok(Math.abs(peak(centre.left) - 0.5) < 0.01, `peak ${peak(centre.left)}`);
  assert.deepEqual(centre.left, centre.right);
  const left = readWav(cueWav({ cue: 'kenney:click', pan: -1 }));
  assert.equal(peak(left.right), 0, 'hard left leaves the right channel silent');
  assert.ok(peak(left.left) > 0.5);
  assert.notDeepEqual(cueWav({ cue: 'kenney:tick' }), wav);
});

test('sample-cues example renders byte-identical twice and the MP4 has one AAC stream', async (t) => {
  const tools = await requireRender(t, { need: ['browser', 'ffmpeg', 'ffprobe'] });
  if (!tools) return;
  const args = ['--fps', '10', '--size', '320x180'];
  const sha = await assertRendersIdentically(t, EXAMPLE, args);
  assert.match(sha, /^[0-9a-f]{64}$/);
  const { out } = await renderHash(EXAMPLE, args);
  const probe = spawnSync(tools.ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'json', out], { encoding: 'utf8' });
  const streams = JSON.parse(probe.stdout).streams;
  assert.deepEqual(streams.map((s) => s.codec_type).sort(), ['audio', 'video']);
  assert.equal(streams.find((s) => s.codec_type === 'audio').codec_name, 'aac');
});

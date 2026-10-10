import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseVoiceArgs, DEFAULT_VOICE, MODEL_CACHE_DIR } from '../scripts/lib/voice.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(root, 'scripts/voice.mjs');
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

test('parseVoiceArgs: text plus --out, defaults for voice and speed', () => {
  assert.deepEqual(parseVoiceArgs(['Hello there', '--out', 'v.wav']), {
    text: 'Hello there', out: 'v.wav', voice: DEFAULT_VOICE, speed: 1, listVoices: false,
  });
});

test('parseVoiceArgs: --voice and --speed are honoured', () => {
  const o = parseVoiceArgs(['Hi', '--out', 'v.wav', '--voice', 'bf_emma', '--speed', '0.9']);
  assert.equal(o.voice, 'bf_emma');
  assert.equal(o.speed, 0.9);
});

test('parseVoiceArgs: --list-voices needs no text', () => {
  assert.equal(parseVoiceArgs(['--list-voices']).listVoices, true);
});

test('parseVoiceArgs: usage errors', () => {
  assert.throws(() => parseVoiceArgs([]), /usage/);
  assert.throws(() => parseVoiceArgs(['Hi']), /--out/);
  assert.throws(() => parseVoiceArgs(['Hi', '--out', 'v.wav', '--speed', 'fast']), /--speed/);
  assert.throws(() => parseVoiceArgs(['Hi', '--out', 'v.wav', '--speed', '3']), /--speed/);
  assert.throws(() => parseVoiceArgs(['Hi', '--out', 'v.txt']), /\.wav/);
  assert.throws(() => parseVoiceArgs(['Hi', '--out', 'v.wav', '--bogus']), /unknown option --bogus/);
  assert.throws(() => parseVoiceArgs(['Hi', 'there', '--out', 'v.wav']), /one text/);
});

test('voice CLI: usage error exits 2 with the usage line', () => {
  const r = run([]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: node scripts\/voice\.mjs/);
});

const haveModel = () => existsSync(MODEL_CACHE_DIR) && process.env.VOICE_TEST === '1';

test('voice CLI: synthesises a short phrase to a 24 kHz wav (needs cached model + VOICE_TEST=1)', { skip: !haveModel() && 'model not cached or VOICE_TEST unset' }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'voice-'));
  const out = path.join(dir, 'hello.wav');
  const r = run(['Hello from Kokoro.', '--out', out]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /hello\.wav\n[\d.]+ s/);
  const buf = readFileSync(out);
  assert.equal(buf.subarray(0, 4).toString(), 'RIFF');
  assert.equal(buf.readUInt32LE(24), 24000, 'sample rate');
  assert.ok(buf.length > 24000, 'more than half a second of audio');
});

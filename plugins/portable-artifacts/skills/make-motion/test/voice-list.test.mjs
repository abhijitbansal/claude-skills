// `voice.mjs --list-voices` answers from a static table (PA-39): it loads no model and downloads nothing. No browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { VOICES, voiceListText } from '../scripts/lib/voice-list.mjs';
import { DEFAULT_VOICE } from '../scripts/lib/voice.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VOICE = path.join(root, 'scripts/voice.mjs');

test('the static list has the default voice, 28 voices and a four-column line for each', () => {
  assert.ok(DEFAULT_VOICE in VOICES, 'the default voice is listed');
  assert.equal(Object.keys(VOICES).length, 28);
  const lines = voiceListText().split('\n').filter(Boolean);
  assert.equal(lines.length, 28);
  assert.ok(lines.includes('af_heart\ten-us\tFemale\tA'), lines[0]);
  for (const line of lines) assert.match(line, /^[a-z]{2}_[a-z]+\t(en-us|en-gb)\t(Female|Male)\t[A-F][+-]?$/);
});

// A resolve hook that throws for every package of the model stack: a script that so much as imports one fails loudly.
function noModelPreload() {
  const dir = mkdtempSync(path.join(tmpdir(), 'vl-'));
  const hook = `export async function resolve(specifier, context, next) {
    if (/^(kokoro-js|@huggingface\\/transformers|onnxruntime-node)(\\/|$)/.test(specifier)) throw new Error('MODEL LOAD: ' + specifier);
    return next(specifier, context);
  }`;
  const preload = path.join(dir, 'preload.mjs');
  writeFileSync(preload, `import { register } from 'node:module';\nregister(${JSON.stringify(`data:text/javascript,${encodeURIComponent(hook)}`)});\n`);
  return pathToFileURL(preload).href;
}

test('--list-voices prints the table, exits 0 and imports nothing of the model stack', () => {
  const r = spawnSync(process.execPath, ['--import', noModelPreload(), VOICE, '--list-voices'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, voiceListText());
  assert.doesNotMatch(r.stderr, /MODEL LOAD/);
});

test('guardrail proof: the preload does stop an import of the model stack', () => {
  const r = spawnSync(process.execPath, ['--import', noModelPreload(), '--input-type=module', '-e', "await import('kokoro-js')"], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /MODEL LOAD: kokoro-js/);
});

// check.mjs without a browser (PA_NO_BROWSER=1): what the spec alone can show is still reported (PA-37). A voiced drawing that
// cannot fit its narration at twice pace comes from the stroke plan, which needs no page. No browser is launched here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeWav } from './helpers/wav.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = path.join(root, 'scripts/check.mjs');
const WORDS = 'This is a very long line of handwriting that goes on and on and on, far too long to be written in the two and a half seconds of one short sentence, even when the pencil flies at twice its usual pace';

// A hand-drawn film in a folder with a voice track and a four-sentence sidecar (2.5 s each), the last sentence holding `text`.
function film(text) {
  const dir = mkdtempSync(path.join(tmpdir(), 'cnb-'));
  mkdirSync(path.join(dir, 'voice'));
  writeWav(path.join(dir, 'voice/intro.wav'), { seconds: 0.2 });
  copyFileSync(path.join(root, 'test/fixtures/voice/four.json'), path.join(dir, 'voice/intro.json'));
  const file = path.join(dir, 'motion.json');
  writeFileSync(file, JSON.stringify({
    size: [1920, 1080], fps: 30, style: 'sketch', audio: [{ src: 'voice/intro.wav', scene: 's' }],
    scenes: [{ id: 's', duration: 12, elements: [
      { id: 'box', type: 'shape', shape: 'rect', x: 400, y: 540, width: 300, height: 200, drawAt: 'sentence:0' },
      { id: 'crammed', type: 'text', text, x: 960, y: 540, fontSize: 60, maxWidth: 1700, drawAt: 'sentence:3' },
    ] }],
  }));
  return file;
}
const run = (file) => spawnSync(process.execPath, [CHECK, file, '--json'], { encoding: 'utf8', env: { ...process.env, PA_NO_BROWSER: '1' } });

test('PA_NO_BROWSER=1: a voiced drawing that cannot fit its sentence is a problem, with no browser launched', () => {
  const r = run(film(WORDS));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  const hit = out.errors.find((e) => /cannot be drawn during the narration/.test(e.message));
  assert.ok(hit, r.stdout);
  assert.equal(hit.path, 'scenes[0].elements[1]');
  assert.ok((out.warnings ?? []).some((w) => /no browser/.test(w.message)), 'it says the rest of the check did not run');
});

test('PA_NO_BROWSER=1: a drawing that fits is still skipped, exit 0', () => {
  const r = run(film('Five words to be read'));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.skipped, true);
});

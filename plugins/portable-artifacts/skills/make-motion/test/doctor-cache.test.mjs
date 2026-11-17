// doctor's cache item covers the cutout alpha frames as well as the decoded video frames (G-74): a clip's cutout is up to 900
// RGBA PNGs and nothing ever cleared them. `--fix cache` leaves the model folder alone. No browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { videoCache, CACHE_LIMIT_BYTES } from '../scripts/lib/requirements.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = () => mkdtempSync(path.join(tmpdir(), 'dc-'));

test('the cache item counts .cache/cutout with .cache/video against the 2 GB limit and names both', async () => {
  const skillDir = tmp();
  const req = videoCache();
  const ctx = { skillDir, platform: process.platform };
  assert.equal(await req.check(ctx), true, 'no cache folders at all');
  mkdirSync(path.join(skillDir, '.cache/cutout/k'), { recursive: true });
  const big = path.join(skillDir, '.cache/cutout/k/0001.png');
  writeFileSync(big, '');
  truncateSync(big, CACHE_LIMIT_BYTES); // sparse: no real disk is used
  assert.equal(await req.check(ctx), false, 'cutout frames alone fill the cache');
  assert.match(req.why(ctx), /^frame caches are 2\.0 GB \(decoded video frames and cutout mattes\); --fix cache clears them$/);
});

test('doctor --fix cache removes .cache/video and .cache/cutout and leaves .cache/models alone', () => {
  const skill = path.join(tmp(), 'make-motion');
  cpSync(path.join(root, 'shared'), path.join(skill, 'shared'), { recursive: true });
  mkdirSync(path.join(skill, 'scripts/lib'), { recursive: true });
  for (const f of ['scripts/doctor.mjs', 'scripts/lib/requirements.mjs']) copyFileSync(path.join(root, f), path.join(skill, f));
  for (const dir of ['.cache/video/k', '.cache/cutout/k', '.cache/models/modnet']) {
    mkdirSync(path.join(skill, dir), { recursive: true });
    writeFileSync(path.join(skill, dir, 'x'), 'x');
  }
  const r = spawnSync(process.execPath, [path.join(skill, 'scripts/doctor.mjs'), '--fix', 'cache', '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout)[0].ok, true, r.stdout);
  assert.equal(existsSync(path.join(skill, '.cache/video')), false, 'decoded frames go');
  assert.equal(existsSync(path.join(skill, '.cache/cutout')), false, 'cutout mattes go');
  assert.equal(existsSync(path.join(skill, '.cache/models/modnet/x')), true, 'the downloaded models stay');
});

// scripts/make.mjs: the one command (doctor, validate, build, check) and its report. The tests every page skill shares are
// in shared/test/helpers/make-suite.mjs; this file adds make-scene's own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineMakeSuite, runNode, oneObject, tmpDir, stub, browserBusy } from '../../../shared/test/helpers/make-suite.mjs';
import { liveBrowsers } from '../shared/shot.mjs';
import { capError } from '../scripts/lib/page-size.mjs';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GOOD = path.join(SKILL, 'references', 'examples', 'city.scene.json');
const MAKE = path.join(SKILL, 'scripts', 'make.mjs');

defineMakeSuite({
  skill: 'make-scene',
  skillDir: SKILL,
  good: GOOD,
  outArg: (dir) => path.join(dir, 'page.html'),
  outputFile: (dir) => path.join(dir, 'page.html'),
  accepted: ['--world', '--allow-outside'],
  passThrough: [
    { args: ['--world', 'forest'], validate: false, build: true },
    { args: ['--allow-outside'], validate: true, build: true },
  ],
});

test("make-scene: the page-size cap is a mechanical finding carrying build's own message", async () => {
  const dir = tmpDir();
  const spec = path.join(dir, 'spec.json');
  fs.writeFileSync(spec, '{}');
  const { message } = capError(900 * 1024, 500 * 1024, { fits: ['forest'] });
  const scripts = {
    doctor: stub(dir, 'doctor', { body: { ok: true, missing: [] } }),
    validate: stub(dir, 'validate'),
    build: stub(dir, 'build', { status: 1, body: { ok: false, errors: [{ path: '', message }] } }),
  };
  const r = await runNode(MAKE, [spec, '--json'], { env: { PA_MAKE_TEST_SCRIPTS: JSON.stringify(scripts) } });
  const report = oneObject(r.stdout);
  assert.equal(r.status, 1);
  assert.deepEqual(report.findings, [{ kind: 'mechanical', path: '', message }]);
  assert.match(message, /the limit is 500 KB/);
});

test('make-scene: an unknown world is a mechanical finding at its path, and no page is built', async () => {
  const dir = tmpDir();
  const doc = { ...JSON.parse(fs.readFileSync(GOOD, 'utf8')), world: 'atlantis' };
  const spec = path.join(dir, 'bad-world.scene.json');
  fs.writeFileSync(spec, JSON.stringify(doc));
  const r = await runNode(MAKE, [spec, '--json', '--no-check', '--out', path.join(dir, 'page.html')]);
  const report = oneObject(r.stdout);
  assert.equal(r.status, 1);
  assert.equal(report.output, null);
  assert.equal(report.findings[0].kind, 'mechanical');
  assert.equal(report.findings[0].path, 'world');
});

test('make-scene: the city example runs the real check in a browser: ok, or skipped when this browser has no WebGL', { timeout: 180000 }, async (t) => {
  if (browserBusy(liveBrowsers)) return t.skip('another headless browser is running');
  const dir = tmpDir();
  const r = await runNode(MAKE, [GOOD, '--json', '--out', path.join(dir, 'page.html')]);
  const report = oneObject(r.stdout);
  assert.equal(r.status, 0, r.stdout);
  assert.deepEqual(report.stages.map((s) => s.name), ['doctor', 'validate', 'build', 'check']);
  assert.ok(report.stages.every((s) => s.ok));
});

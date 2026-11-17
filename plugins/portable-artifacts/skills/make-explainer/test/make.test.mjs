// scripts/make.mjs: the one command (doctor, validate, build, check) and its report. The tests every page skill shares are
// in shared/test/helpers/make-suite.mjs; this file adds make-explainer's own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineMakeSuite, runNode, oneObject, tmpDir, browserBusy } from '../../../shared/test/helpers/make-suite.mjs';
import { liveBrowsers } from '../shared/shot.mjs';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLES = path.join(SKILL, 'references', 'examples');
const GOOD = path.join(EXAMPLES, 'concept.explainer.json');
const MAKE = path.join(SKILL, 'scripts', 'make.mjs');
const run = (args) => runNode(MAKE, [...args, '--json']);

defineMakeSuite({
  skill: 'make-explainer',
  skillDir: SKILL,
  good: GOOD,
  outArg: (dir) => path.join(dir, 'page.html'),
  outputFile: (dir) => path.join(dir, 'page.html'),
  accepted: ['--strict', '--md', '--image-api'],
  passThrough: [
    { args: ['--strict'], validate: true, build: true },
    { args: ['--md'], validate: false, build: true },
    { args: ['--image-api', 'https://images.example.test/make'], validate: false, build: true },
  ],
});

test('make-explainer: a spec with a lint warning exits 0 with one creative finding', async () => {
  const dir = tmpDir();
  const r = await run([GOOD, '--no-check', '--out', path.join(dir, 'page.html')]);
  const report = oneObject(r.stdout);
  assert.equal(r.status, 0);
  assert.equal(report.ok, true);
  assert.equal(report.findings.length, 1, 'the same warning from validate and build is counted once');
  assert.equal(report.findings[0].kind, 'creative');
  assert.equal(report.findings[0].path, 'generatedBy');
});

test('make-explainer: a section over its length cap is a creative finding, and with --strict a mechanical one (exit 1)', async () => {
  const dir = tmpDir();
  const words = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ');
  const spec = path.join(dir, 'long.explainer.json');
  fs.writeFileSync(spec, JSON.stringify({ title: 'Doc', generatedBy: { model: 'm', effort: 'low', agent: 'a' }, sections: [{ type: 'text', text: words }] }));
  const lenient = oneObject((await run([spec, '--no-check', '--out', path.join(dir, 'a.html')])).stdout);
  assert.equal(lenient.ok, true);
  assert.ok(lenient.findings.length > 0 && lenient.findings.every((f) => f.kind === 'creative'));
  assert.ok(lenient.findings.some((f) => f.path === 'sections[0]'));
  const strict = await run([spec, '--strict', '--no-check', '--out', path.join(dir, 'b.html')]);
  const report = oneObject(strict.stdout);
  assert.equal(strict.status, 1);
  assert.ok(report.findings.some((f) => f.kind === 'mechanical' && f.path === 'sections[0]'), JSON.stringify(report.findings));
});

test("make-explainer: a motion section whose film does not validate gives a mechanical finding under the section's path", async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'bad.json'), JSON.stringify({ size: [160, 90], scenes: [{ id: 's', duration: 1, elements: [{ id: 'a', type: 'text', text: 'x', x: 0, y: 0, fontSize: 'big' }] }] }));
  const spec = path.join(dir, 'film.explainer.json');
  fs.writeFileSync(spec, JSON.stringify({ title: 'Doc', generatedBy: { model: 'm', effort: 'low', agent: 'a' }, sections: [{ type: 'text', text: 'x' }, { type: 'motion', spec: 'bad.json' }] }));
  const r = await run([spec, '--no-check', '--out', path.join(dir, 'page.html')]);
  const report = oneObject(r.stdout);
  assert.equal(r.status, 1);
  assert.equal(report.output, null, 'no render happened');
  assert.deepEqual(report.findings.map((f) => [f.kind, f.path]), [['mechanical', 'sections[1].spec.scenes[0].elements[0].fontSize']]);
  assert.match(report.findings[0].message, /must be number \(in bad\.json\)/);
});

test('make-explainer: the concept example passes the real check in a browser', { timeout: 180000 }, async (t) => {
  if (browserBusy(liveBrowsers)) return t.skip('another headless browser is running');
  const dir = tmpDir();
  const r = await run([GOOD, '--out', path.join(dir, 'page.html')]);
  const report = oneObject(r.stdout);
  assert.equal(r.status, 0, r.stdout);
  assert.deepEqual(report.stages.map((s) => s.name), ['doctor', 'validate', 'build', 'check']);
  assert.ok(report.stages.every((s) => s.ok));
});

// scripts/make.mjs: the one command (doctor, validate, build, check) and its report. The tests every page skill shares are
// in shared/test/helpers/make-suite.mjs; this file adds make-dashboard's own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineMakeSuite, runNode, oneObject, tmpDir, browserBusy } from '../../../shared/test/helpers/make-suite.mjs';
import { liveBrowsers } from '../shared/shot.mjs';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GOOD = path.join(SKILL, 'references', 'examples', 'minimal.json');
const MAKE = path.join(SKILL, 'scripts', 'make.mjs');

defineMakeSuite({
  skill: 'make-dashboard',
  skillDir: SKILL,
  good: GOOD,
  outArg: (dir) => path.join(dir, 'dist'),
  outputFile: (dir) => path.join(dir, 'dist', 'index.html'),
  accepted: ['--allow-outside', '--timeout'],
  passThrough: [
    { args: ['--allow-outside'], validate: true, build: true },
    { args: ['--timeout', '5'], validate: true, build: true },
  ],
});

test('make-dashboard: a query that does not run is a mechanical finding naming the query, and no page is built', async () => {
  const dir = tmpDir();
  const doc = JSON.parse(fs.readFileSync(GOOD, 'utf8'));
  const [name] = Object.keys(doc.queries);
  doc.queries[name] = 'SELECT no_such_column FROM sales';
  fs.cpSync(path.join(SKILL, 'references', 'examples', 'data'), path.join(dir, 'data'), { recursive: true });
  const spec = path.join(dir, 'bad-query.json');
  fs.writeFileSync(spec, JSON.stringify(doc));
  const r = await runNode(MAKE, [spec, '--json', '--no-check', '--out', path.join(dir, 'dist')]);
  const report = oneObject(r.stdout);
  assert.equal(r.status, 1);
  assert.equal(report.output, null);
  const finding = report.findings.find((f) => f.path.includes(name));
  assert.equal(finding?.kind, 'mechanical', JSON.stringify(report.findings));
});

test('make-dashboard: a built page whose check passes (real browser) exits 0 with a check stage', { timeout: 180000 }, async (t) => {
  if (browserBusy(liveBrowsers)) return t.skip('another headless browser is running');
  const dir = tmpDir();
  const r = await runNode(MAKE, [GOOD, '--json', '--out', path.join(dir, 'dist')]);
  const report = oneObject(r.stdout);
  assert.equal(r.status, 0, r.stdout);
  assert.deepEqual(report.stages.map((s) => s.name), ['doctor', 'validate', 'build', 'check']);
  assert.ok(report.stages.every((s) => s.ok));
});

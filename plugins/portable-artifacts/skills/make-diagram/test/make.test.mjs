// scripts/make.mjs: the one command (doctor, validate, build, check) and its report. The tests every page skill shares are
// in shared/test/helpers/make-suite.mjs; this file adds make-diagram's own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineMakeSuite, runNode, oneObject, tmpDir, browserBusy } from '../../../shared/test/helpers/make-suite.mjs';
import { liveBrowsers } from '../shared/shot.mjs';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLES = path.join(SKILL, 'references', 'examples');
const MAKE = path.join(SKILL, 'scripts', 'make.mjs');

defineMakeSuite({
  skill: 'make-diagram',
  skillDir: SKILL,
  good: path.join(EXAMPLES, 'flow.diagram.json'),
  outArg: (dir) => path.join(dir, 'page.html'),
  outputFile: (dir) => path.join(dir, 'page.html'),
  passThrough: [],
});

test('make-diagram: a label that does not fit is a mechanical finding at the node it names, and no page is built', async () => {
  const dir = tmpDir();
  const doc = JSON.parse(fs.readFileSync(path.join(EXAMPLES, 'flow.diagram.json'), 'utf8'));
  doc.nodes[1].label = 'This label is far too long to ever fit inside one node box however it wraps, whatever the width, so it keeps going';
  const spec = path.join(dir, 'long.diagram.json');
  fs.writeFileSync(spec, JSON.stringify(doc));
  const r = await runNode(MAKE, [spec, '--json', '--no-check', '--out', path.join(dir, 'page.html')]);
  const report = oneObject(r.stdout);
  assert.equal(r.status, 1);
  assert.equal(report.output, null);
  assert.equal(report.findings[0].kind, 'mechanical');
  assert.equal(report.findings[0].path, 'nodes[1].label');
});

test('make-diagram: the story example passes the real check in a browser', { timeout: 180000 }, async (t) => {
  if (browserBusy(liveBrowsers)) return t.skip('another headless browser is running');
  const dir = tmpDir();
  const r = await runNode(MAKE, [path.join(EXAMPLES, 'story.diagram.json'), '--json', '--out', path.join(dir, 'page.html')]);
  const report = oneObject(r.stdout);
  assert.equal(r.status, 0, r.stdout);
  assert.deepEqual(report.stages.map((s) => s.name), ['doctor', 'validate', 'build', 'check']);
  assert.ok(report.stages.every((s) => s.ok));
  assert.ok(fs.existsSync(report.output));
});

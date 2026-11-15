// check.mjs paths that need no browser (PA_NO_BROWSER=1 or usage errors). The real browser pass is in the
// orchestrator's serial browser run (browser_checks), never here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { takeShots, pageFile } from '../scripts/cli/check.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = path.join(ROOT, 'scripts/check.mjs');
const BUILD = path.join(ROOT, 'scripts/build.mjs');
const EXAMPLE = path.join(ROOT, 'references/examples/sales-overview.json');
const NO_BROWSER = { ...process.env, PA_NO_BROWSER: '1' };
const run = (args, env = NO_BROWSER) => spawnSync(process.execPath, [CHECK, ...args], { encoding: 'utf8', env });

function built() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-check-'));
  const r = spawnSync(process.execPath, [BUILD, EXAMPLE, '--out', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return out;
}

test('--help exits 0 with the usage line', () => {
  const r = run(['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /usage: node scripts\/check\.mjs <dist folder \| index\.html> \[--json\] \[--shots <dir>\]/);
});

test('no browser: the check says skipped, exits 0, and takes no shots', () => {
  const out = built();
  const r = run([out, '--shots', path.join(out, 'shots')]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^check: skipped \(no browser: PA_NO_BROWSER=1; run scripts\/doctor\.mjs --for check/m);
  assert.match(r.stdout, /^shots: skipped \(the check was skipped\)$/m);
  assert.ok(!fs.existsSync(path.join(out, 'shots')));
  const j = JSON.parse(run([out, '--json']).stdout);
  assert.equal(j.skipped, true);
  assert.equal(j.ok, true);
});

test('usage problems exit 2 with one line', () => {
  const out = built();
  assert.equal(run([]).status, 2);
  assert.equal(run([path.join(out, 'nope')]).status, 2);
  assert.equal(run([out, '--bogus']).status, 2);
  const empty = run([out, '--shots', '']);
  assert.equal(empty.status, 2);
  assert.match(empty.stderr, /--shots needs a folder path/);
  const noIndex = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-check-empty-'));
  assert.match(run([noIndex]).stderr, /no index\.html/);
});

test('pageFile takes a dist folder or the page itself', () => {
  const out = built();
  assert.equal(pageFile(out), path.join(out, 'index.html'));
  assert.equal(pageFile(path.join(out, 'index.html')), path.join(out, 'index.html'));
});

test('takeShots asks shared/shot.mjs for 390 and 1280 px into the folder, and reports its failure', () => {
  const calls = [];
  const fake = (cmd, args) => { calls.push(args); return { status: 1, stdout: `${JSON.stringify({ ok: false, shots: [], problems: ['404 x'] })}\n`, stderr: '' }; };
  const r = takeShots('/p/index.html', '/shots', { run: fake, script: '/s/shot.mjs' });
  assert.deepEqual(calls[0], ['/s/shot.mjs', '/p/index.html', '--widths', '390,1280', '--out', '/shots', '--json']);
  assert.deepEqual(r, { status: 1, paths: [], message: '404 x' });
});

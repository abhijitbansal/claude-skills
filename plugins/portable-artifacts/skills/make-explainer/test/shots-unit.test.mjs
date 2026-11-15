// PA-21: takeShots drives shared/shot.mjs in its own process; here `run` is a stub, so no browser starts.
// (The page probe and the real PNG run are browser tests, listed for the serial browser run.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { takeShots, SHOT_WIDTHS, SHOT_SCRIPT } from '../scripts/lib/shots.mjs';

const stub = (result) => {
  const calls = [];
  const run = (cmd, args, options) => { calls.push({ cmd, args, options }); return result; };
  return { run, calls };
};
const ok = (paths) => ({ status: 0, stdout: `${JSON.stringify({ ok: true, shots: paths.map((path) => ({ path })) })}\n`, stderr: '' });

test('the shot script it runs is this skill\'s own shared copy, and it exists', () => {
  assert.match(SHOT_SCRIPT, /make-explainer\/shared\/shot\.mjs$/);
  assert.ok(fs.existsSync(SHOT_SCRIPT));
});

test('success: the paths shot.mjs printed come back, and it was asked for 390 and 1280 px into the folder', () => {
  const { run, calls } = stub(ok(['/s/a-390-light.png', '/s/a-1280-dark.png']));
  const r = takeShots('/p/page.html', '/s', { run, script: '/x/shot.mjs' });
  assert.deepEqual(r, { status: 0, paths: ['/s/a-390-light.png', '/s/a-1280-dark.png'] });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ['/x/shot.mjs', '/p/page.html', '--widths', SHOT_WIDTHS, '--out', '/s', '--json']);
  assert.equal(SHOT_WIDTHS, '390,1280');
  assert.ok(calls[0].options.timeout > 0, 'the run has a wall-clock cap');
});

test('only the last stdout line is parsed, so a log line before the JSON does not break it', () => {
  const { run } = stub({ status: 0, stdout: `a log line\n${JSON.stringify({ ok: true, shots: [{ path: '/s/one.png' }] })}\n`, stderr: '' });
  assert.deepEqual(takeShots('/p/page.html', '/s', { run }), { status: 0, paths: ['/s/one.png'] });
});

test('failure with paths: the exit status, the paths already written and the first error message come back', () => {
  const body = { ok: false, errors: [{ path: '', message: 'the 1280 dark shot failed' }], shots: [{ path: '/s/a-390-light.png' }] };
  const { run } = stub({ status: 1, stdout: `${JSON.stringify(body)}\n`, stderr: '' });
  assert.deepEqual(takeShots('/p/page.html', '/s', { run }), { status: 1, paths: ['/s/a-390-light.png'], message: 'the 1280 dark shot failed' });
});

test('exit 0 without ok:true is a failure: the status is never 0 unless shot.mjs said ok', () => {
  const { run } = stub({ status: 0, stdout: `${JSON.stringify({ ok: false, shots: [] })}\n`, stderr: '' });
  const r = takeShots('/p/page.html', '/s', { run });
  assert.equal(r.status, 1);
  assert.deepEqual(r.paths, []);
  assert.ok(r.message, 'a message says it failed');
});

test('a run that never started (spawn error, no status) reports status 1 and the error message', () => {
  const { run } = stub({ status: null, stdout: null, stderr: null, error: new Error('spawn ENOENT') });
  assert.deepEqual(takeShots('/p/page.html', '/s', { run }), { status: 1, paths: [], message: 'spawn ENOENT' });
});

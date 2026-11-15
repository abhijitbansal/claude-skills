// Final wave I5: which failed page call is the film's fault and which is the machine's. The messages are the ones
// Playwright 1.64 throws, recorded by .scratch/gate/probe-errors.mjs (name "Error" except the timeout):
//   a page throw          "page.evaluate: Error: <message>\n    at eval ..."
//   a closed page         "page.evaluate: Target page, context or browser has been closed"
//   a crashed renderer    "page.evaluate: Target crashed "
//   a timeout             "page.goto: Timeout 1ms exceeded." (name "TimeoutError")
// Only an Error the page raised on purpose (the engine's own throws) is the film's: a mechanical finding, exit 1.
// A crash, a closed target, a timeout, a lost or broken WebGL context ("post pass: ...") and a picture the browser
// cannot decode are trouble with the machine or a file: exit 2 and report.error, with a hint.
import test from 'node:test';
import assert from 'node:assert/strict';
import { failureOutcome, reportFindings } from '../../scripts/v2/run.mjs';
import { describeError } from '../../scripts/v2/report.mjs';

const thrown = (inner) => new Error(`page.evaluate: ${inner}\n    at eval (eval at evaluate (:370:30), <anonymous>:1:15)\n    at UtilityScript.evaluate (<anonymous>:372:16)`);

test('an Error the page throws on purpose is the film\'s: a mechanical finding with the page\'s own message, exit 1', () => {
  const out = failureOutcome(thrown('Error: unknown font family "Comic" (bundled: Geist, Archivo)'));
  assert.equal(out.exitCode, 1);
  assert.deepEqual(out.finding, { kind: 'mechanical', shot: null, path: '', message: 'page: unknown font family "Comic" (bundled: Geist, Archivo)' });
  assert.equal(out.error, undefined);
});

test('a closed page, a crashed renderer and a timeout are the machine\'s: exit 2 and an error with a hint, no finding', () => {
  for (const message of ['page.evaluate: Target page, context or browser has been closed', 'page.evaluate: Target crashed ', 'page.screenshot: Target crashed ', 'page.goto: Timeout 30000ms exceeded.']) {
    const out = failureOutcome(new Error(message));
    assert.equal(out.exitCode, 2, message);
    assert.equal(out.finding, undefined, message);
    assert.ok(!out.error.message.startsWith('page.'), `the call prefix is taken off: ${out.error.message}`);
    assert.notEqual(out.error.hint, '', `${message} has a hint`);
  }
});

test('a lost or broken WebGL context is the machine\'s, and gets the post pass hint (run again, use --exact)', () => {
  for (const inner of ['Error: post pass: the WebGL context was lost', 'Error: post pass: WebGL error 0x502 while drawing the frame']) {
    const out = failureOutcome(thrown(inner));
    assert.equal(out.exitCode, 2, inner);
    assert.match(out.error.message, /^post pass: /);
    assert.match(out.error.hint, /--exact/);
  }
});

test('a picture the browser cannot decode is exit 2 with its path, as a missing one is', () => {
  const out = failureOutcome(thrown('Error: image "assets/bad.png" could not be loaded: The source image could not be decoded.'));
  assert.equal(out.exitCode, 2);
  assert.match(out.error.message, /^image "assets\/bad\.png" could not be loaded/);
  assert.notEqual(out.error.hint, '');
});

test('an error the page did not raise on purpose (a TypeError in its code) is not blamed on the film: exit 2', () => {
  const out = failureOutcome(thrown('TypeError: Cannot read properties of null (reading \'x\')'));
  assert.equal(out.exitCode, 2);
  assert.equal(out.finding, undefined);
});

test('M7: a message with its own hint is never split at a ". " inside a path', () => {
  assert.deepEqual(describeError(new Error('cannot read ./my. films/a.json: ENOENT')), {
    message: 'cannot read ./my. films/a.json: ENOENT',
    hint: 'give the path of an existing film .json file; a relative path is read from the current directory',
  });
  assert.deepEqual(describeError(new Error('ffmpeg not found. Install it (brew install ffmpeg)')), { message: 'ffmpeg not found', hint: 'Install it (brew install ffmpeg)' }, 'what. how to fix still splits');
});

test('a machine error (exit 2) never comes with a page: film finding; other findings stay, and exit 1 keeps them all', () => {
  const page = { kind: 'mechanical', shot: null, path: '', message: 'page: WebGL: CONTEXT_LOST_WEBGL' };
  const shot = { kind: 'mechanical', shot: 'a', path: 'shots[0]', message: 'text "t" is outside the safe area' };
  assert.deepEqual(reportFindings([page, shot, page], 2), [shot]);
  assert.deepEqual(reportFindings([page, shot, page], 1), [page, shot], 'deduplicated');
  assert.deepEqual(reportFindings([page, shot], null), [page, shot]);
});

test('a stop request is an interrupt, exit 130, whatever the error', () => {
  const controller = new AbortController();
  controller.abort();
  assert.deepEqual(failureOutcome(new Error('page.evaluate: Target crashed '), controller.signal), { exitCode: 130, error: { message: 'interrupted', hint: '' } });
});

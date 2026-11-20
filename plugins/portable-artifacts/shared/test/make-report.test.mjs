import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EXIT, INTERRUPTED, newRun, runStage, finding, reportOf, exitCodeOf, logMake } from '../make-report.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'make-report-'));
const validRun = (extra = {}) => ({ ...newRun(), validated: true, ...extra });

test('a stage that returns records ok true and its seconds', async () => {
  const state = newRun();
  const lines = [];
  const result = await runStage(state, 'validate', async () => ({ ok: true, value: 7 }), (l) => lines.push(l));
  assert.deepEqual(result, { ok: true, value: 7 });
  assert.equal(state.stages.length, 1);
  assert.equal(state.stages[0].name, 'validate');
  assert.equal(state.stages[0].ok, true);
  assert.equal(typeof state.stages[0].seconds, 'number');
  assert.ok(state.stages[0].seconds >= 0);
  assert.equal(lines.length, 1, 'one progress line per stage');
});

test('a stage that returns ok false records ok false and does not throw', async () => {
  const state = newRun();
  await runStage(state, 'validate', () => ({ ok: false }));
  assert.equal(state.stages[0].ok, false);
});

test('a stage that throws records ok false and rethrows', async () => {
  const state = newRun();
  await assert.rejects(runStage(state, 'build', () => { throw new Error('boom'); }), /boom/);
  assert.equal(state.stages.length, 1);
  assert.equal(state.stages[0].name, 'build');
  assert.equal(state.stages[0].ok, false);
});

test('a stage returning skipped records ok true and skipped true', async () => {
  const state = newRun();
  await runStage(state, 'check', () => ({ skipped: true, reason: 'no browser' }));
  assert.deepEqual({ ok: state.stages[0].ok, skipped: state.stages[0].skipped }, { ok: true, skipped: true });
  const plain = newRun();
  await runStage(plain, 'x', () => ({}));
  assert.equal('skipped' in plain.stages[0], false, 'only a skipped stage carries the key');
});

test('ok is false when a mechanical finding exists and true when only creative ones do', () => {
  const creative = reportOf(validRun({ findings: [finding('creative', 'a', 'x')] }));
  assert.equal(creative.ok, true);
  const mechanical = reportOf(validRun({ findings: [finding('creative', 'a', 'x'), finding('mechanical', 'b', 'y')] }));
  assert.equal(mechanical.ok, false);
});

test('ok is false when validate did not pass', () => {
  assert.equal(reportOf({ ...newRun(), validated: false }).ok, false);
  assert.equal(reportOf(validRun()).ok, true);
});

test('ok is false when a stage failed, even with nothing else wrong', () => {
  const state = validRun({ stages: [{ name: 'build', ok: false, seconds: 0 }] });
  assert.equal(reportOf(state).ok, false);
});

test('ok is false when an error is set', () => {
  assert.equal(reportOf(validRun({ error: { message: 'm', hint: 'h' } })).ok, false);
});

test('finding omits fix when none is given and refuses an unknown kind', () => {
  assert.deepEqual(finding('mechanical', 'a.b', 'bad'), { kind: 'mechanical', path: 'a.b', message: 'bad' });
  assert.deepEqual(finding('creative', '', 'm', 'use "x"'), { kind: 'creative', path: '', message: 'm', fix: 'use "x"' });
  assert.throws(() => finding('minor', 'a', 'b'), /kind must be one of: mechanical, creative/);
});

test('exitCodeOf: 0 for ok, 1 for not ok, 2 when error is set, 130 when the error is an interrupt', () => {
  assert.equal(exitCodeOf({ ok: true }), EXIT.OK);
  assert.equal(exitCodeOf({ ok: false }), EXIT.NOT_OK);
  assert.equal(exitCodeOf({ ok: false, error: { message: 'cannot read x', hint: '' } }), EXIT.MACHINE);
  assert.equal(exitCodeOf({ ok: false, error: { message: INTERRUPTED, hint: '' } }), EXIT.INTERRUPTED);
  assert.deepEqual(EXIT, { OK: 0, NOT_OK: 1, MACHINE: 2, INTERRUPTED: 130 });
});

test('the report has ok, output, stages, findings on every path and error only when set', () => {
  for (const state of [newRun(), validRun(), validRun({ error: { message: 'm', hint: 'h' } })]) {
    const report = reportOf(state);
    for (const key of ['ok', 'output', 'stages', 'findings']) assert.ok(key in report, key);
    assert.equal('error' in report, state.error !== null);
  }
});

test('output is null unless the file exists', () => {
  const dir = tmp();
  const file = path.join(dir, 'page.html');
  assert.equal(reportOf(validRun({ output: file })).output, null, 'a path that was never written');
  fs.writeFileSync(file, '<html></html>');
  assert.equal(reportOf(validRun({ output: file })).output, file);
  assert.equal(reportOf(validRun({ output: null })).output, null);
});

test('logMake writes one JSON line with command make when EVAL_LOG is set, nothing when it is not, and never throws on an unwritable path', () => {
  const dir = tmp();
  const log = path.join(dir, 'eval.log');
  const report = reportOf(validRun({ findings: [finding('mechanical', 'a', 'x'), finding('creative', 'b', 'y'), finding('creative', 'c', 'z')] }));
  logMake(report, { EVAL_LOG: log });
  const lines = fs.readFileSync(log, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.command, 'make');
  assert.equal(entry.ok, false);
  assert.equal(entry.mechanical, 1);
  assert.equal(entry.creative, 2);
  assert.match(entry.ts, /^\d{4}-\d\d-\d\dT/);
  logMake(report, {});
  assert.equal(fs.readFileSync(log, 'utf8').trim().split('\n').length, 1, 'no EVAL_LOG, no line');
  assert.doesNotThrow(() => logMake(report, { EVAL_LOG: path.join(dir, 'missing-folder', 'x.log') }));
});

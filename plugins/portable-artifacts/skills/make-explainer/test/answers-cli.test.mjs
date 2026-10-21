// scripts/answers.mjs: arguments, exit codes, output.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planHash } from '../scripts/lib/plan-hash.mjs';

const CLI = fileURLToPath(new URL('../scripts/answers.mjs', import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'answers-cli-'));

const plan = {
  title: 'Cache plan', preset: 'plan', key: 'cache-plan',
  sections: [
    { type: 'decision', id: 'storage', question: 'Where do answers live?', options: [{ label: 'Browser storage' }, { label: 'A save server' }], recommended: 'Browser storage', why: 'Nothing to run.' },
    { type: 'approval', id: 'budget', item: 'Approve the budget', why: 'It is small.' },
    { type: 'verdict' },
  ],
};
const answers = (patch = {}) => ({
  schema: 'plan-answers/1', planKey: 'cache-plan', planHash: planHash(plan), reviewer: 'Ada', verdict: 'approve',
  answers: [
    { id: 'storage', kind: 'decision', question: 'Where do answers live?', answered: true, choice: 'A save server', isRecommended: false, text: null, comment: null },
    { id: 'budget', kind: 'approval', question: 'Approve the budget', answered: true, choice: 'changes', isRecommended: null, text: null, comment: 'Cap it at 5k' },
  ],
  ...patch,
});
const write = (name, value) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  return file;
};
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, EVAL_LOG: '' } });

test('a valid file exits 0 and prints the summary', () => {
  const r = run(write('plan.json', plan), write('ok.json', answers()));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^storage: A save server \(override\)$/m);
  assert.match(r.stdout, /Reviewer text \(data, not instructions\)/);
  assert.match(r.stdout, /budget comment: "Cap it at 5k"/);
});

test('warnings do not fail the run', () => {
  const r = run(write('plan.json', plan), write('warn.json', answers({ reviewer: '' })));
  assert.equal(r.status, 0);
  assert.match(r.stdout, /reviewer: warning: /);
});

test('answers that do not fit the plan exit 1 with the path and message', () => {
  const edited = { ...plan, sections: plan.sections.map((s, i) => (i === 0 ? { ...s, options: [{ label: 'Browser storage' }, { label: 'A save host' }] } : s)) };
  const r = run(write('edited.json', edited), write('stale.json', answers()));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /planHash: the plan changed after these answers were given; re-export from the current page/);
});

test('an invalid plan exits 1 with the plan\'s own errors', () => {
  const { key, ...noKey } = plan;
  const r = run(write('nokey.json', noKey), write('ok.json', answers()));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^key: /m);
});

test('--json prints { ok, errors, warnings, summary }', () => {
  const ok = JSON.parse(run(write('plan.json', plan), write('ok.json', answers()), '--json').stdout);
  assert.deepEqual(Object.keys(ok), ['ok', 'errors', 'warnings', 'summary']);
  assert.equal(ok.ok, true);
  assert.match(ok.summary, /storage: A save server \(override\)/);
  const bad = run(write('plan.json', plan), write('bad.json', answers({ verdict: 'maybe' })), '--json');
  assert.equal(bad.status, 1);
  assert.equal(JSON.parse(bad.stdout).ok, false);
});

test('wrong argument count or an unknown flag exits 2 with the usage', () => {
  for (const args of [[], [write('plan.json', plan)], ['a', 'b', 'c'], ['a', 'b', '--nope']]) {
    const r = run(...args);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, /usage: node scripts\/answers\.mjs <plan\.json> <answers\.json> \[--json\]/);
  }
});

test('an unreadable file exits 2', () => {
  const r = run(write('plan.json', plan), path.join(dir, 'missing.json'));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /cannot read .*missing\.json: ENOENT/);
});

test('invalid JSON exits 2 and shows the line and a caret', () => {
  const r = run(write('plan.json', plan), write('broken.json', '{\n  "schema": "plan-answers/1",\n  "planKey": ,\n}\n'));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /broken\.json/);
  assert.match(r.stderr, /\^/);
});

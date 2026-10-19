import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const VALIDATE = fileURLToPath(new URL('../scripts/validate.mjs', import.meta.url));
const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const run = (args, env = {}) => spawnSync(process.execPath, [VALIDATE, ...args], {
  encoding: 'utf8',
  env: { ...process.env, EVAL_LOG: '', ...env },
});
const tmpSpec = (obj, name = 'bad.scene.json') => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-validate-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(obj));
  return { dir, file };
};
const inline = { title: 'T', data: { rows: [{ group: 'a', value: 1 }] } };

test('valid spec exits 0 and says so', () => {
  const r = run([fixture('city.scene.json')]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /city\.scene\.json: valid\n$/);
});

test('invalid spec exits 1 with path: message lines', () => {
  const { dir, file } = tmpSpec({ ...inline, wrold: 'city' });
  try {
    const r = run([file]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^wrold: unknown property; did you mean "world"\?$/m);
    assert.match(r.stdout, /bad\.scene\.json: 1 error\n$/);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('--json prints one machine-readable result line', () => {
  const { dir, file } = tmpSpec({ ...inline, wrold: 'city' });
  try {
    const r = run([file, '--json']);
    assert.equal(r.status, 1);
    assert.deepEqual(JSON.parse(r.stdout), { ok: false, errors: [{ path: 'wrold', message: 'unknown property; did you mean "world"?' }] });
    assert.equal(JSON.parse(run([fixture('city.scene.json'), '--json']).stdout).ok, true);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('data outside the spec folder exits 1; --allow-outside lets it through', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-validate-'));
  try {
    fs.writeFileSync(path.join(dir, 'rows.json'), JSON.stringify({ rows: [{ group: 'a', value: 1 }] }));
    fs.mkdirSync(path.join(dir, 'sub'));
    const file = path.join(dir, 'sub', 'scene.json');
    fs.writeFileSync(file, JSON.stringify({ title: 'T', data: { file: '../rows.json' } }));
    const blocked = run([file]);
    assert.equal(blocked.status, 1);
    assert.match(blocked.stdout, /outside the spec folder/);
    assert.equal(run([file, '--allow-outside']).status, 0);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('missing file, bad JSON, bad usage and unknown flag exit 2', () => {
  const missing = run(['/nonexistent/x.scene.json']);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /cannot read/);
  assert.equal(run([]).status, 2);
  assert.equal(run(['a', 'b']).status, 2);
  const flag = run([fixture('city.scene.json'), '--allow-outsid']);
  assert.equal(flag.status, 2);
  assert.match(flag.stderr, /did you mean '--allow-outside'/);
  const { dir, file } = tmpSpec({});
  try {
    fs.writeFileSync(file, '{nope');
    const bad = run([file, '--json']);
    assert.equal(bad.status, 2);
    assert.equal(JSON.parse(bad.stdout).ok, false);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('EVAL_LOG gets one line per run', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-validate-'));
  const log = path.join(dir, 'eval.jsonl');
  try {
    run([fixture('city.scene.json')], { EVAL_LOG: log });
    const { file } = tmpSpec({ ...inline, wrold: 'city' });
    run([file], { EVAL_LOG: log });
    const lines = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 2);
    assert.deepEqual([lines[0].ok, lines[0].errors, lines[1].ok, lines[1].errors], [true, 0, false, 1]);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

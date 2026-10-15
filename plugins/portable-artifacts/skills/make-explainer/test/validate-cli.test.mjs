import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const VALIDATE = fileURLToPath(new URL('../scripts/validate.mjs', import.meta.url));
const FIXTURE = fileURLToPath(new URL('./fixtures/all-types.explainer.json', import.meta.url));
const run = (args, env = {}) => spawnSync(process.execPath, [VALIDATE, ...args], {
  encoding: 'utf8',
  env: { ...process.env, EVAL_LOG: '', ...env },
});

function withSpec(obj, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-validate-'));
  const file = path.join(dir, 'explainer.json');
  fs.writeFileSync(file, JSON.stringify(obj));
  try {
    return fn(file, dir);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
}

const doc = (sections) => ({ title: 'T', sections });

test('valid spec exits 0 and says so', () => {
  const r = run([FIXTURE]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /all-types\.explainer\.json: valid\n$/);
});

test('invalid spec exits 1 with path: message lines', () => {
  withSpec(doc([{ type: 'text', text: 'TODO: write' }, { type: 'tldrr', text: 'x' }]), (file) => {
    const r = run([file]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^sections\[1\]\.type: must be one of "tldr", "text",.*; did you mean "tldr"\?\n/m);
    assert.match(r.stdout, /explainer\.json: 1 error\n$/);
  });
  withSpec(doc([{ type: 'text', text: 'TODO: write' }]), (file) => {
    const r = run([file]);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, `sections[0].text: still has a TODO placeholder — replace it with real content\n${file}: 1 error\n`);
  });
});

test('warnings are printed but the exit code stays 0', () => {
  withSpec(doc([{ type: 'text', text: Array(130).fill('word').join(' ') }]), (file) => {
    const r = run([file]);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, [
      'sections[0].text: warning: paragraph is 130 words; keep it to 60 → split it, or turn it into cards or steps',
      'sections[0]: warning: text section is 130 words; keep it to 120 → split it into sections, or turn it into cards or steps',
      `${file}: valid (2 warnings)`,
      '',
    ].join('\n'));
  });
});

test('a 9-word title is a warning, not an error', () => {
  withSpec(doc([{ type: 'text', title: 'one two three four five six seven eight nine', text: 'x' }]), (file) => {
    const r = run([file]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^sections\[0\]\.title: warning: title is 9 words; keep it to 8/);
  });
});

test('errors and warnings together exit 1 and count both', () => {
  withSpec(doc([{ type: 'text', text: `${Array(130).fill('word').join(' ')} leverage` }]), (file) => {
    const r = run([file]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /banned phrase "leverage"/);
    assert.match(r.stdout, /warning: paragraph is 131 words/);
    assert.match(r.stdout, /explainer\.json: 1 error, 2 warnings\n$/);
  });
});

test('file references resolve against the spec folder, not the cwd', () => {
  withSpec(doc([{ type: 'image', src: 'missing.png', alt: 'a' }]), (file, dir) => {
    const r = run([file]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, new RegExp(`^sections\\[0\\]\\.src: file not found: "missing\\.png" \\(relative to .*${path.basename(dir)}\\)$`, 'm'));
    fs.copyFileSync(fileURLToPath(new URL('./fixtures/pixel.png', import.meta.url)), path.join(dir, 'missing.png'));
    assert.equal(run([file]).status, 0);
  });
});

test('--json prints one machine-readable result line, warnings included', () => {
  withSpec({ ...doc([{ type: 'text', text: 'x' }]), titel: 1 }, (file) => {
    const r = run([file, '--json']);
    assert.equal(r.status, 1);
    assert.deepEqual(JSON.parse(r.stdout), {
      ok: false,
      errors: [{ path: 'titel', message: 'unknown property; did you mean "title"?' }],
      warnings: [],
    });
  });
  withSpec(doc([{ type: 'text', text: Array(130).fill('word').join(' ') }]), (file) => {
    const r = run([file, '--json']);
    assert.equal(r.status, 0);
    assert.deepEqual(JSON.parse(r.stdout), {
      ok: true,
      errors: [],
      warnings: [
        { path: 'sections[0].text', message: 'paragraph is 130 words; keep it to 60 → split it, or turn it into cards or steps' },
        { path: 'sections[0]', message: 'text section is 130 words; keep it to 120 → split it into sections, or turn it into cards or steps' },
      ],
    });
  });
});

test('missing file, bad JSON and bad usage exit 2', () => {
  const missing = run(['/nonexistent/explainer.json']);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /cannot read/);
  const none = run([]);
  assert.equal(none.status, 2);
  assert.match(none.stderr, /expected one spec file; usage: node scripts\/validate\.mjs/);
  const flag = run([FIXTURE, '--bogus']);
  assert.equal(flag.status, 2);
  const json = run(['/nonexistent/explainer.json', '--json']);
  assert.equal(json.status, 2);
  assert.equal(JSON.parse(json.stdout).ok, false);
  withSpec({}, (file) => {
    fs.writeFileSync(file, '{ nope');
    assert.match(run([file]).stderr, /is not valid JSON/);
  });
});

test('EVAL_LOG gets one line per run', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-evallog-'));
  const log = path.join(dir, 'log.jsonl');
  try {
    run([FIXTURE], { EVAL_LOG: log });
    run([FIXTURE, '--bogus'], { EVAL_LOG: log });
    withSpec(doc([{ type: 'text', text: 'TODO: x' }]), (file) => run([file], { EVAL_LOG: log }));
    const lines = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => [l.ok, l.errors]), [[true, 0], [false, 1], [false, 1]]);
    assert.ok(!Number.isNaN(Date.parse(lines[0].ts)));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('only validate writes EVAL_LOG: build, scaffold and gather leave it alone', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-evallog-'));
  const log = path.join(dir, 'log.jsonl');
  const script = (name) => fileURLToPath(new URL(`../scripts/${name}.mjs`, import.meta.url));
  const env = { ...process.env, EVAL_LOG: log, PA_OUTPUT_DIR: dir };
  try {
    spawnSync(process.execPath, [script('build'), FIXTURE, '--out', path.join(dir, 'x.html')], { encoding: 'utf8', env });
    spawnSync(process.execPath, [script('scaffold'), 'concept'], { encoding: 'utf8', env });
    spawnSync(process.execPath, [script('gather'), 'git', '--repo', dir], { encoding: 'utf8', env });
    assert.equal(fs.existsSync(log), false);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('a broken EVAL_LOG path never changes the outcome', () => {
  assert.equal(run([FIXTURE], { EVAL_LOG: '/nonexistent-dir/x/log.jsonl' }).status, 0);
});

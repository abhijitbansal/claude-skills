// Entry scripts in a copy with no node_modules: one line naming the doctor command, exit 2, never a module stack.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SKILL = fileURLToPath(new URL('..', import.meta.url));
const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

function bareCopy() {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-bare-')), 'make-dashboard');
  made.push(path.dirname(dir));
  for (const d of ['scripts', 'shared', 'template', 'references']) fs.cpSync(path.join(SKILL, d), path.join(dir, d), { recursive: true });
  return fs.realpathSync(dir);
}

const ENTRY = ['validate.mjs', 'build.mjs', 'inspect.mjs', 'query.mjs', 'serve.mjs', 'setup.mjs'];

test('every entry script without node_modules prints the doctor command and exits 2', () => {
  const dir = bareCopy();
  const spec = path.join(dir, 'references/examples/minimal.json');
  for (const script of ENTRY) {
    const r = spawnSync(process.execPath, [path.join(dir, 'scripts', script), spec], { encoding: 'utf8', env: { ...process.env, PA_NO_BROWSER: '1' } });
    assert.equal(r.status, 2, `${script}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /dependencies are not installed \(no node_modules in .*\); run: node .*doctor\.mjs.* --fix node_modules/, script);
    assert.doesNotMatch(r.stderr, /ERR_MODULE_NOT_FOUND|at .*\(node:internal/, `${script}: no stack`);
  }
});

test('--json gets the same message as JSON on stdout', () => {
  const dir = bareCopy();
  const r = spawnSync(process.execPath, [path.join(dir, 'scripts/validate.mjs'), 'x.json', '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  const body = JSON.parse(r.stdout);
  assert.equal(body.ok, false);
  assert.match(body.errors[0].message, /--fix node_modules/);
});

test('every entry script answers --help with its usage line and exit 0', () => {
  for (const script of ENTRY) {
    const r = spawnSync(process.execPath, [path.join(SKILL, 'scripts', script), '--help'], { encoding: 'utf8', env: { ...process.env, PA_NO_BROWSER: '1' } });
    assert.equal(r.status, 0, `${script}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, new RegExp(`^usage: node scripts/${script.replace('.', '\\.')}`), script);
  }
});

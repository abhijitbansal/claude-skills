import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPrompt, expandCmd, diffPaths, countValidateRuns, scoreRun, summarize, run } from '../lib.mjs';

const made = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-eval-test-')); made.push(d); return d; };
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

// A fake skill: validate passes iff the spec has "ok": true; output writes a file.
function fakeSkill() {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.writeFileSync(path.join(dir, 'scripts/validate.mjs'), `
    import fs from 'node:fs';
    const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    if (process.env.EVAL_LOG) fs.appendFileSync(process.env.EVAL_LOG, '{}\\n');
    const errors = spec.ok ? [] : [{ path: 'ok', message: 'must be true' }];
    console.log(JSON.stringify({ ok: !!spec.ok, errors }));
    process.exit(spec.ok ? 0 : 1);
  `);
  fs.writeFileSync(path.join(dir, 'scripts/build.mjs'), `
    import fs from 'node:fs';
    fs.mkdirSync(process.argv[4], { recursive: true });
    fs.writeFileSync(process.argv[4] + '/index.html', '<html></html>');
  `);
  return dir;
}

const cfg = {
  dir: 'fake',
  spec: 'spec.json',
  outputCmd: (skill, spec, work) => [path.join(skill, 'scripts/build.mjs'), spec, '--out', path.join(work, 'dist')],
  artifacts: ['dist/index.html'],
};

test('buildPrompt points the host at SKILL.md and the spec path', () => {
  const p = buildPrompt(cfg, 'Do X.');
  assert.match(p, /skills\/fake\/SKILL\.md/);
  assert.match(p, /Task: Do X\./);
  assert.match(p, /\.\/spec\.json/);
});

test('expandCmd substitutes placeholders and appends model args only when given', () => {
  const host = { cmd: ['h', '-C', '{cwd}', '{prompt}'], modelArgs: ['-m', '{model}'] };
  assert.deepEqual(expandCmd(host, { prompt: 'hi there', cwd: '/w' }), ['h', '-C', '/w', 'hi there']);
  assert.deepEqual(expandCmd(host, { prompt: 'p', cwd: '/w', model: 'gemma4' }), ['h', '-C', '/w', 'p', '-m', 'gemma4']);
});

test('expandCmd substitutes in one pass: placeholders and $-patterns inside the prompt survive', () => {
  const host = { cmd: ['h', '-C', '{cwd}', '{prompt}'], modelArgs: ['-m', '{model}'] };
  const prompt = 'write {cwd} and {model} literally, cost $& and $$';
  assert.deepEqual(expandCmd(host, { prompt, cwd: '/w', model: 'm' }), ['h', '-C', '/w', prompt, '-m', 'm']);
});

test('buildPrompt tells hosts not to start long-running servers', () => {
  assert.match(buildPrompt(cfg, 'x'), /do not start serve\.mjs or preview\.mjs/i);
});

test('run kills the whole process group on timeout (no orphaned grandchildren)', async () => {
  const d = tmp();
  const pidFile = path.join(d, 'gc.pid');
  const script = `const c=require('child_process').spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{stdio:'ignore'});require('fs').writeFileSync(${JSON.stringify(pidFile)},String(c.pid));setTimeout(()=>{},60000);`;
  const r = await run(['node', '-e', script], { timeoutMs: 500 });
  assert.equal(r.timedOut, true);
  const gc = Number(fs.readFileSync(pidFile, 'utf8'));
  await new Promise((res) => setTimeout(res, 300));
  assert.throws(() => process.kill(gc, 0), /ESRCH/);
});

test('diffPaths lists only changed leaves', () => {
  const a = { scenes: [{ id: 'a', duration: 3 }, { id: 'b', duration: 2 }], fps: 30 };
  const b = { scenes: [{ id: 'a', duration: 3 }, { id: 'b', duration: 4 }], fps: 30 };
  assert.deepEqual(diffPaths(a, b), ['scenes[1].duration']);
  assert.deepEqual(diffPaths({ x: 1 }, { x: 1, y: 2 }), ['y']);
  assert.deepEqual(diffPaths(a, a), []);
});

test('countValidateRuns counts non-empty lines, 0 when missing', () => {
  const d = tmp();
  assert.equal(countValidateRuns(path.join(d, 'nope')), 0);
  fs.writeFileSync(path.join(d, 'log'), '{}\n{}\n\n');
  assert.equal(countValidateRuns(path.join(d, 'log')), 2);
});

test('run reports exit code, output and timeout', async () => {
  const ok = await run(['node', '-e', 'console.log("hi")']);
  assert.equal(ok.code, 0);
  assert.match(ok.out, /hi/);
  const slow = await run(['node', '-e', 'setTimeout(()=>{}, 5000)'], { timeoutMs: 200 });
  assert.equal(slow.timedOut, true);
  const missing = await run(['definitely-not-a-binary-xyz']);
  assert.equal(missing.code, 127);
});

test('scoreRun: missing spec scores zero', async () => {
  const s = await scoreRun({ work: tmp(), skillCfg: cfg, skillDir: fakeSkill() });
  assert.equal(s.specExists, false);
  assert.equal(s.finalValid, false);
});

test('scoreRun: valid spec runs the output step and does not count its own validate', async () => {
  const work = tmp();
  fs.writeFileSync(path.join(work, 'spec.json'), '{"ok": true}');
  fs.writeFileSync(path.join(work, '.eval-log.jsonl'), '{}\n{}\n');
  const s = await scoreRun({ work, skillCfg: cfg, skillDir: fakeSkill(), seedSpec: { ok: false } });
  assert.equal(s.specExists, true);
  assert.equal(s.finalValid, true);
  assert.equal(s.validateRuns, 2);
  assert.equal(s.outputOk, true);
  assert.deepEqual(s.changedPaths, ['ok']);
  assert.equal(countValidateRuns(path.join(work, '.eval-log.jsonl')), 2);
});

test('scoreRun: an edit prompt that leaves the seed unchanged fails', async () => {
  const work = tmp();
  fs.writeFileSync(path.join(work, 'spec.json'), '{"ok": true}');
  const s = await scoreRun({ work, skillCfg: cfg, skillDir: fakeSkill(), seedSpec: { ok: true } });
  assert.equal(s.finalValid, false);
  assert.deepEqual(s.changedPaths, []);
  assert.deepEqual(s.errors, [{ path: '(edit)', message: 'spec unchanged from the seed: the requested edit was not made' }]);
  assert.equal(s.outputOk, false);
});

test('scoreRun: invalid spec reports errors and skips output', async () => {
  const work = tmp();
  fs.writeFileSync(path.join(work, 'spec.json'), '{"ok": false}');
  const s = await scoreRun({ work, skillCfg: cfg, skillDir: fakeSkill() });
  assert.equal(s.finalValid, false);
  assert.deepEqual(s.errors, [{ path: 'ok', message: 'must be true' }]);
  assert.equal(s.outputOk, false);
  assert.equal(fs.existsSync(path.join(work, 'dist')), false);
});

test('summarize renders a markdown table with totals and escaped notes', () => {
  const md = summarize([
    { id: 'a', specExists: true, finalValid: true, validateRuns: 2, outputOk: true, seconds: 12.4, errors: [] },
    { id: 'b', specExists: true, finalValid: false, validateRuns: 5, outputOk: false, seconds: 30, errors: [{ path: 'x', message: 'a|b' }] },
  ], { host: 'claude', skill: 'dashboard' });
  assert.match(md, /valid 1\/2/);
  assert.match(md, /\| a \| ✓ \| ✓ \| 2 \| ✓ \| 12 \|/);
  assert.match(md, /a\\\|b/);
});

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKILLS, buildPrompt, expandCmd, diffPaths, countValidateRuns, scoreRun, summarize, run, linkNodeModules, createFixtureRepo, prepareWorkdir } from '../lib.mjs';

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

test('run drops NODE_USE_SYSTEM_CA from the child environment', async () => {
  const prev = process.env.NODE_USE_SYSTEM_CA;
  process.env.NODE_USE_SYSTEM_CA = '1';
  try {
    const r = await run(['node', '-e', 'process.stdout.write(String(process.env.NODE_USE_SYSTEM_CA))']);
    assert.equal(r.out, 'undefined');
  } finally {
    if (prev === undefined) delete process.env.NODE_USE_SYSTEM_CA; else process.env.NODE_USE_SYSTEM_CA = prev;
  }
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

test('linkNodeModules: an agent wiping the workdir node_modules cannot touch the source', () => {
  const src = tmp();
  fs.mkdirSync(path.join(src, 'node_modules/ajv'), { recursive: true });
  fs.writeFileSync(path.join(src, 'node_modules/ajv/index.js'), 'x');
  fs.mkdirSync(path.join(src, 'node_modules/@scope/pkg'), { recursive: true });
  fs.mkdirSync(path.join(src, 'node_modules/.bin'));
  fs.writeFileSync(path.join(src, 'node_modules/.package-lock.json'), '{}');
  const dst = path.join(tmp(), 'node_modules');
  linkNodeModules(path.join(src, 'node_modules'), dst);
  assert.ok(fs.lstatSync(dst).isDirectory() && !fs.lstatSync(dst).isSymbolicLink());
  assert.equal(fs.readFileSync(path.join(dst, 'ajv/index.js'), 'utf8'), 'x');
  assert.ok(fs.existsSync(path.join(dst, '@scope/pkg')));
  // what `npm ci` does first: remove node_modules entirely
  fs.rmSync(dst, { recursive: true, force: true });
  assert.equal(fs.readFileSync(path.join(src, 'node_modules/ajv/index.js'), 'utf8'), 'x');
  assert.ok(fs.existsSync(path.join(src, 'node_modules/@scope/pkg')));
  assert.ok(fs.existsSync(path.join(src, 'node_modules/.bin')));
});

const evalDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (...parts) => JSON.parse(fs.readFileSync(path.join(evalDir, ...parts), 'utf8'));

test('SKILLS.diagram builds into <work>/out/diagram.html and expects that file', () => {
  const cfg = SKILLS.diagram;
  assert.equal(cfg.dir, 'make-diagram');
  assert.equal(cfg.spec, 'diagram.json');
  assert.deepEqual(cfg.outputCmd('/s', '/w/diagram.json', '/w'), ['/s/scripts/build.mjs', '/w/diagram.json', '--out', '/w/out/diagram.html']);
  assert.deepEqual(cfg.artifacts, ['out/diagram.html']);
  assert.match(buildPrompt(cfg, 'Draw X.'), /skills\/make-diagram\/SKILL\.md.*\.\/diagram\.json/);
});

test('diagram prompts: two per type and one edit prompt whose seed exists', () => {
  const prompts = readJson('prompts', 'diagram.json');
  assert.equal(prompts.length, 8);
  assert.equal(new Set(prompts.map((p) => p.id)).size, 8);
  const seeded = prompts.filter((p) => p.seed);
  assert.deepEqual(seeded.map((p) => p.seed), ['seeds/diagram.json']);
  const seed = readJson('fixtures', seeded[0].seed);
  assert.equal(seed.type, 'architecture');
  const typeOf = (p) => (p.seed ? seed.type : ['architecture', 'flowchart', 'sequence', 'state'].find((t) => new RegExp(t, 'i').test(p.prompt)));
  const counts = {};
  for (const p of prompts) counts[typeOf(p)] = (counts[typeOf(p)] ?? 0) + 1;
  assert.deepEqual(counts, { architecture: 2, flowchart: 2, sequence: 2, state: 2 });
});

test('the edit prompt asks for a change the scorer can see in the spec', () => {
  const seed = readJson('fixtures', 'seeds', 'diagram.json');
  const changed = structuredClone(seed);
  changed.nodes[0].label = 'Storefront';
  assert.deepEqual(diffPaths(seed, changed), ['nodes[0].label']);
  assert.match(readJson('prompts', 'diagram.json').find((p) => p.seed).prompt, /Storefront/);
});

const skillsDir = path.resolve(evalDir, '../skills');

test('SKILLS.explainer builds into <work>/out/explainer.html and needs the diagram and dashboard siblings', () => {
  const cfg = SKILLS.explainer;
  assert.equal(cfg.dir, 'make-explainer');
  assert.equal(cfg.spec, 'explainer.json');
  assert.deepEqual(cfg.outputCmd('/s', '/w/explainer.json', '/w'), ['/s/scripts/build.mjs', '/w/explainer.json', '--out', '/w/out/explainer.html']);
  assert.deepEqual(cfg.artifacts, ['out/explainer.html']);
  assert.match(buildPrompt(cfg, 'Explain X.'), /skills\/make-explainer\/SKILL\.md.*\.\/explainer\.json/);
  assert.deepEqual(cfg.siblings, ['make-diagram', 'make-dashboard']);
  const pkg = readJson('..', 'skills', 'make-explainer', 'package.json');
  assert.deepEqual(cfg.siblings, pkg.portableArtifacts.requires, 'the eval copies exactly the skills make-explainer requires');
  for (const name of cfg.siblings) assert.ok(fs.existsSync(path.join(skillsDir, name, 'SKILL.md')), `${name} exists`);
});

test('explainer prompts: eight unique ids, one repo recap, one edit prompt with a seed, a diagram and a chart case', () => {
  const prompts = readJson('prompts', 'explainer.json');
  assert.equal(prompts.length, 8);
  assert.equal(new Set(prompts.map((p) => p.id)).size, 8);
  assert.deepEqual(prompts.filter((p) => p.repo).map((p) => p.id), ['recap-from-repo']);
  assert.deepEqual(prompts.filter((p) => p.seed).map((p) => p.seed), ['seeds/explainer.json']);
  assert.ok(prompts.some((p) => /diagram/i.test(p.prompt)), 'a prompt asks for a diagram');
  assert.ok(prompts.some((p) => /\bchart\b/i.test(p.prompt) && /month,signups/.test(p.prompt)), 'a prompt asks for a chart from a CSV pasted in the prompt');
  assert.ok(prompts.some((p) => /slides/i.test(p.prompt)) && prompts.some((p) => /checklist/i.test(p.prompt)));
  assert.match(prompts.find((p) => p.repo).prompt, /\.\/repo/);
});

test('the explainer seed validates and the edit prompt asks for changes the scorer can see', async () => {
  const seedFile = path.join(evalDir, 'fixtures', 'seeds', 'explainer.json');
  const r = await run(['node', path.join(skillsDir, 'make-explainer/scripts/validate.mjs'), seedFile, '--json'], { env: { EVAL_LOG: '' } });
  assert.equal(r.code, 0, r.out);
  const seed = readJson('fixtures', 'seeds', 'explainer.json');
  const changed = structuredClone(seed);
  changed.sections[0].tone = 'warn';
  changed.sections[2].items.find((c) => c.title === 'Cache').title = 'Edge cache';
  assert.deepEqual(diffPaths(seed, changed), ['sections[0].tone', 'sections[2].items[1].title']);
  const prompt = readJson('prompts', 'explainer.json').find((p) => p.seed).prompt;
  assert.match(prompt, /'Cache'.*'Edge cache'/);
  assert.match(prompt, /tl;dr.*'warn'/);
});

test('createFixtureRepo builds a branch the gather script can read: commits, files and a test file', async () => {
  const dir = path.join(tmp(), 'repo');
  createFixtureRepo(dir);
  const r = await run(['node', path.join(skillsDir, 'make-explainer/scripts/gather.mjs'), 'git', '--repo', dir, '--base', 'main', '--json'], { env: { EVAL_LOG: '' } });
  assert.equal(r.code, 0, r.out);
  const facts = JSON.parse(r.out.trim().split('\n').pop());
  assert.equal(facts.branch, 'feat/search');
  assert.equal(facts.base, 'main');
  assert.equal(facts.commits.length, 3);
  assert.deepEqual(facts.files.map((f) => f.path).sort(), ['docs/search.md', 'src/search.js', 'test/search.test.js']);
  assert.deepEqual(facts.tests, ['test/search.test.js']);
});

const prepare = (p, skillCfg) => prepareWorkdir(p, { skillCfg, skillsRoot, evalDir, tmpDir: tmp() });
const skillsRoot = skillsDir;

test('prepareWorkdir (explainer): the skill and both siblings sit side by side with linked node_modules', () => {
  const { work, seedSpec } = prepare({ id: 'plain', prompt: 'x' }, SKILLS.explainer);
  assert.equal(seedSpec, null);
  for (const name of ['make-explainer', 'make-diagram', 'make-dashboard']) {
    const dir = path.join(work, 'skills', name);
    assert.ok(fs.existsSync(path.join(dir, 'SKILL.md')), `${name} was copied`);
    assert.ok(fs.lstatSync(path.join(dir, 'node_modules')).isDirectory() && !fs.lstatSync(path.join(dir, 'node_modules')).isSymbolicLink(), `${name} has a real node_modules folder`);
    assert.ok(fs.lstatSync(path.join(dir, 'node_modules/ajv')).isSymbolicLink(), `${name} node_modules entries are links to the source`);
  }
  assert.equal(fs.existsSync(path.join(work, 'skills/make-motion')), false, 'make-motion is not part of the explainer eval');
  assert.equal(fs.existsSync(path.join(work, 'skills/make-explainer/test')), false, 'the skill\'s tests are not copied');
  assert.ok(fs.existsSync(path.join(work, 'data/sales.csv')));
  assert.equal(fs.existsSync(path.join(work, 'repo')), false, 'no repo unless the prompt asks');
  assert.equal(fs.existsSync(path.join(work, 'explainer.json')), false, 'no seed unless the prompt has one');
});

test('prepareWorkdir: a repo prompt gets ./repo that make-explainer can gather, a seed prompt gets the seed spec', async () => {
  const { work } = prepare({ id: 'recap', repo: true, prompt: 'x' }, SKILLS.explainer);
  assert.ok(fs.existsSync(path.join(work, 'repo/.git')));
  const r = await run(['node', path.join(work, 'skills/make-explainer/scripts/gather.mjs'), 'git', '--repo', path.join(work, 'repo'), '--json'], { env: { EVAL_LOG: '' } });
  assert.equal(r.code, 0, r.out);
  assert.equal(JSON.parse(r.out.trim().split('\n').pop()).commits.length, 3);
  const seeded = prepare({ id: 'edit', seed: 'seeds/explainer.json', prompt: 'x' }, SKILLS.explainer);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(seeded.work, 'explainer.json'), 'utf8')), seeded.seedSpec);
  assert.equal(seeded.seedSpec.preset, 'concept');
});

test('prepareWorkdir: a skill without siblings gets only itself', () => {
  const { work } = prepare({ id: 'dash', prompt: 'x' }, SKILLS.diagram);
  assert.deepEqual(fs.readdirSync(path.join(work, 'skills')), ['make-diagram']);
});

test('createFixtureRepo says what to upgrade when git cannot init a branch name', () => {
  const dir = path.join(tmp(), 'repo');
  const bogus = tmp();
  fs.writeFileSync(path.join(bogus, 'git'), '#!/bin/sh\necho "unknown switch b" >&2\nexit 129\n', { mode: 0o755 });
  const prev = process.env.PATH;
  process.env.PATH = `${bogus}${path.delimiter}${prev}`;
  try {
    assert.throws(() => createFixtureRepo(dir), /git init .*failed: unknown switch b \(git 2\.28 or newer is needed for init -b\)/);
  } finally { process.env.PATH = prev; }
});

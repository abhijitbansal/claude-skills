import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { SKILLS, buildPrompt, expandCmd, readSpecModel, diffPaths, countValidateRuns, scoreRun, summarize, run, linkNodeModules, createFixtureRepo, prepareWorkdir, copySkill, loadPrompts, parseExpect, parseAlternatives, featureUsed, readValidateLog, LOCAL_MODEL_GATED_SKILLS } from '../lib.mjs';

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

test('diagram prompts: two per type, a story prompt, an emoji prompt, and one edit prompt whose seed exists', () => {
  const prompts = readJson('prompts', 'diagram.json');
  assert.equal(prompts.length, 10);
  assert.equal(new Set(prompts.map((p) => p.id)).size, 10);
  const seeded = prompts.filter((p) => p.seed);
  assert.deepEqual(seeded.map((p) => p.seed), ['seeds/diagram.json']);
  const seed = readJson('fixtures', seeded[0].seed);
  assert.equal(seed.type, 'architecture');
  const typeOf = (p) => (p.seed ? seed.type : ['architecture', 'flowchart', 'sequence', 'state'].find((t) => new RegExp(t, 'i').test(p.prompt)));
  const counts = {};
  for (const p of prompts) counts[typeOf(p)] = (counts[typeOf(p)] ?? 0) + 1;
  assert.deepEqual(counts, { architecture: 3, flowchart: 2, sequence: 3, state: 2 });
  const story = prompts.find((p) => p.id === 'order-story');
  assert.match(story.prompt, /story/i);
  assert.match(story.prompt, /caption/i);
  const emoji = prompts.find((p) => p.id === 'emoji-map');
  assert.match(emoji.prompt, /emoji/i);
  assert.match(emoji.prompt, /detail/i);
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

test('SKILLS.scene builds into <work>/out/scene.html and needs the diagram and dashboard siblings', () => {
  const cfg = SKILLS.scene;
  assert.equal(cfg.dir, 'make-scene');
  assert.equal(cfg.spec, 'scene.json');
  assert.deepEqual(cfg.outputCmd('/s', '/w/scene.json', '/w'), ['/s/scripts/build.mjs', '/w/scene.json', '--out', '/w/out/scene.html']);
  assert.deepEqual(cfg.artifacts, ['out/scene.html']);
  assert.match(buildPrompt(cfg, 'Show X.'), /skills\/make-scene\/SKILL\.md.*\.\/scene\.json/);
  assert.deepEqual(cfg.siblings, ['make-diagram', 'make-dashboard']);
  const pkg = readJson('..', 'skills', 'make-scene', 'package.json');
  assert.deepEqual(cfg.siblings, pkg.portableArtifacts.requires, 'the eval copies exactly the skills make-scene requires');
  for (const name of [cfg.dir, ...cfg.siblings]) assert.ok(fs.existsSync(path.join(skillsDir, name, 'SKILL.md')), `${name} exists`);
});

test('scene prompts: ten unique ids, four worlds, a repo prompt, two lifts, three edit prompts whose seeds exist', () => {
  const prompts = readJson('prompts', 'scene.json');
  assert.equal(prompts.length, 10);
  assert.equal(new Set(prompts.map((p) => p.id)).size, 10);
  assert.deepEqual(prompts.filter((p) => p.repo).map((p) => p.id), ['git-activity']);
  for (const id of ['city-inline', 'forest-parent', 'galaxy-links', 'terrain-traffic', 'git-activity', 'lift-diagram', 'lift-dashboard', 'edit-add-tour', 'edit-switch-forest', 'edit-rename-group']) {
    assert.ok(prompts.some((p) => p.id === id), `prompt ${id}`);
  }
  const seeded = prompts.filter((p) => p.seed);
  assert.deepEqual(seeded.map((p) => p.id), ['edit-add-tour', 'edit-switch-forest', 'edit-rename-group']);
  for (const p of seeded) assert.ok(fs.existsSync(path.join(evalDir, 'fixtures', p.seed)), `${p.seed} exists`);
  // every data file a prompt names ships in fixtures/data
  for (const p of prompts) {
    for (const [, file] of p.prompt.matchAll(/\bdata\/([\w.-]*\w)/g)) assert.ok(fs.existsSync(path.join(evalDir, 'fixtures', 'data', file)), `${p.id}: data/${file} exists`);
  }
  assert.match(prompts.find((p) => p.repo).prompt, /\.\/repo/);
  assert.ok(prompts.some((p) => p.id === 'terrain-traffic' && /web_traffic\.csv/.test(p.prompt)));
  assert.match(prompts.find((p) => p.id === 'lift-diagram').prompt, /3D/);
});

test('scene seeds, lift inputs and the terrain CSV validate with make-scene', async () => {
  const scene = path.join(skillsDir, 'make-scene/scripts/validate.mjs');
  const files = [
    path.join(evalDir, 'fixtures/seeds/scene.json'),
    path.join(evalDir, 'fixtures/seeds/scene-tour.json'),
  ];
  for (const f of files) {
    const r = await run(['node', scene, f, '--json'], { env: { EVAL_LOG: '' } });
    assert.equal(r.code, 0, `${path.basename(f)}: ${r.out}`);
  }
  // the fixtures a prompt points at (data/…) feed the spec that prompt should produce
  const work = tmp();
  fs.cpSync(path.join(evalDir, 'fixtures', 'data'), path.join(work, 'data'), { recursive: true });
  const specs = {
    galaxy: { title: 'Service calls', world: 'galaxy', data: { file: 'data/service_calls.json' } },
    terrain: { title: 'Web traffic', world: 'terrain', data: { csv: 'data/web_traffic.csv', columns: { group: 'channel', t: 'date', value: 'sessions' } } },
    diagram: { title: 'Orders', lift: { diagram: 'data/orders.diagram.json' } },
    dashboard: { title: 'Units', lift: { dashboard: 'data/units.dashboard.json', chart: 'units' } },
  };
  for (const [name, spec] of Object.entries(specs)) {
    const f = path.join(work, `${name}.json`);
    fs.writeFileSync(f, JSON.stringify(spec));
    const r = await run(['node', scene, f, '--json'], { env: { EVAL_LOG: '' } });
    assert.equal(r.code, 0, `${name}: ${r.out}`);
  }
});

test('scene edit prompts ask for changes the scorer can see in the seed', () => {
  const prompts = readJson('prompts', 'scene.json');
  const bare = readJson('fixtures', 'seeds', 'scene.json');
  assert.equal(bare.tour, undefined, 'the tour prompt starts from a scene with no tour');
  const withTour = structuredClone(bare);
  withTour.tour = [1, 2, 3];
  assert.deepEqual(diffPaths(bare, withTour), ['tour']);
  const forest = structuredClone(bare);
  forest.world = 'forest';
  assert.notEqual(bare.world, 'forest');
  assert.deepEqual(diffPaths(bare, forest), ['world']);
  const ts = readJson('fixtures', 'seeds', 'scene-tour.json');
  assert.ok(ts.tour?.some((b) => b.focus.includes('api')), 'the rename seed has a tour that names the group');
  assert.match(prompts.find((p) => p.id === 'edit-rename-group').prompt, /api.*backend/s);
  assert.match(prompts.find((p) => p.id === 'edit-add-tour').prompt, /3|three/);
  assert.match(prompts.find((p) => p.id === 'edit-switch-forest').prompt, /forest/i);
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
    if (!fs.existsSync(path.join(skillsRoot, name, 'node_modules'))) continue; // deps not installed (CI before npm ci): copySkill links nothing
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

test('copySkill: a skill whose deps are not installed is copied without node_modules (CI runs this before npm ci)', () => {
  const src = path.join(tmp(), 'make-bare');
  fs.mkdirSync(path.join(src, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(src, 'SKILL.md'), '# bare\n');
  const work = tmp();
  copySkill(src, work);
  assert.ok(fs.existsSync(path.join(work, 'skills/make-bare/SKILL.md')));
  assert.equal(fs.existsSync(path.join(work, 'skills/make-bare/node_modules')), false);
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

test('expandCmd adds agentArgs only when an agent is given', () => {
  const host = { cmd: ['h', '{prompt}'], modelArgs: ['--model', '{model}'], agentArgs: ['--agent', '{agent}'] };
  assert.deepEqual(expandCmd(host, { prompt: 'p', cwd: '/w' }), ['h', 'p']);
  assert.deepEqual(expandCmd(host, { prompt: 'p', cwd: '/w', agent: 'artifact-builder' }), ['h', 'p', '--agent', 'artifact-builder']);
  assert.deepEqual(expandCmd(host, { prompt: 'p', cwd: '/w', model: 'm', agent: 'a' }), ['h', 'p', '--model', 'm', '--agent', 'a']);
});

test('expandCmd ignores an agent for a host without agentArgs (run-eval rejects it earlier)', () => {
  assert.deepEqual(expandCmd({ cmd: ['h', '{prompt}'] }, { prompt: 'p', cwd: '/w', agent: 'a' }), ['h', 'p']);
});

test('hosts.json: only copilot defines agentArgs', () => {
  const hosts = readJson('hosts.json');
  assert.deepEqual(hosts.copilot.agentArgs, ['--agent', '{agent}']);
  assert.deepEqual(Object.keys(hosts).filter((h) => hosts[h].agentArgs), ['copilot']);
});

// Runs the real run-eval.mjs with PATH pointing only at fake `claude` and `copilot` executables that record
// a marker and exit 1, plus --only __none__ so no prompt can run. If a usage check ever slid below the host
// check, the marker file would appear (and no real host or billed command could run).
function runEvalWithFakeHosts(args) {
  const bin = tmp();
  const marker = path.join(bin, 'host-launched.txt');
  for (const name of ['claude', 'copilot', 'codex', 'ollama']) {
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${marker}"\nexit 1\n`, { mode: 0o755 });
  }
  const r = spawnSync(process.execPath, [path.join(evalDir, 'run-eval.mjs'), '--skill', 'dashboard', '--only', '__none__', ...args], {
    encoding: 'utf8', env: { ...process.env, PATH: bin },
  });
  return { r, hostLaunched: fs.existsSync(marker) };
}

test('run-eval: --agent on a host without agentArgs is a usage error before any host runs', () => {
  const { r, hostLaunched } = runEvalWithFakeHosts(['--host', 'claude', '--agent', 'artifact-builder']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /host "claude" has no agentArgs/);
  assert.match(r.stderr, /\[--agent name\]/);
  assert.equal(hostLaunched, false, 'no host executable may be launched');
});

test('run-eval: --agent needs a non-empty name', () => {
  const { r, hostLaunched } = runEvalWithFakeHosts(['--host', 'copilot', '--agent', '']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--agent needs a name/);
  assert.equal(hostLaunched, false, 'no host executable may be launched');
});

test('the fake host executables really are what runs: a valid --agent reaches the host check', () => {
  const { r, hostLaunched } = runEvalWithFakeHosts(['--host', 'copilot', '--agent', 'artifact-builder']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /host "copilot" not available/);
  assert.equal(hostLaunched, true);
});

test('readSpecModel reads generatedBy.model from the saved spec, "-" when absent or unreadable', () => {
  const d = tmp();
  const w = (name, text) => { fs.writeFileSync(path.join(d, name), text); return path.join(d, name); };
  assert.equal(readSpecModel(w('a.json', '{"generatedBy":{"model":"Claude Haiku 5.5","effort":"low"}}')), 'Claude Haiku 5.5');
  assert.equal(readSpecModel(w('b.json', '{"title":"x"}')), '-');
  assert.equal(readSpecModel(w('c.json', '{"generatedBy":{"model":""}}')), '-');
  assert.equal(readSpecModel(w('d.json', '{"generatedBy":"gpt"}')), '-');
  assert.equal(readSpecModel(w('e.json', 'not json')), '-');
  assert.equal(readSpecModel(path.join(d, 'nope.json')), '-');
  assert.equal(readSpecModel(w('f.json', '{"generatedBy":{"model":" \\n\\t "}}')), '-');
});

test('readSpecModel treats the model as untrusted: whitespace collapses and the length is capped', () => {
  const d = tmp();
  const w = (name, model) => { fs.writeFileSync(path.join(d, name), JSON.stringify({ generatedBy: { model } })); return path.join(d, name); };
  assert.equal(readSpecModel(w('a.json', 'Haiku\n| fake | row |\r\n\tx')), 'Haiku | fake | row | x');
  const long = readSpecModel(w('b.json', 'm'.repeat(5000)));
  assert.equal(long.length, 80);
  assert.ok(long.endsWith('…'));
  assert.equal(readSpecModel(w('c.json', 'x'.repeat(80))), 'x'.repeat(80));
});

test('summary.md keeps one table row per case even when the reported model is hostile', async () => {
  const work = tmp();
  fs.writeFileSync(path.join(work, 'spec.json'), JSON.stringify({ ok: true, generatedBy: { model: 'Haiku\n| fake | row | ✓ |\n' + 'z'.repeat(5000) } }));
  const s = await scoreRun({ work, skillCfg: cfg, skillDir: fakeSkill() });
  const md = summarize([{ id: 'a', seconds: 1, ...s }, { id: 'b', seconds: 1, ...s }], { host: 'copilot', skill: 'dashboard' });
  const tableRows = md.split('\n').filter((l) => l.startsWith('| '));
  assert.equal(tableRows.length, 1 + 2, 'header plus one row per case');
  assert.ok(tableRows.every((l) => l.length < 400));
});

test('scoreRun: motion-style case, the spec reports a model and the output has no page or MP4', async () => {
  const skill = fakeSkill();
  const pngCfg = { ...cfg, artifacts: ['out'], outputCmd: (s, spec, work) => [path.join(s, 'scripts/png.mjs'), path.join(work, 'out')] };
  fs.writeFileSync(path.join(skill, 'scripts/png.mjs'), `
    import fs from 'node:fs';
    fs.mkdirSync(process.argv[2], { recursive: true });
    fs.writeFileSync(process.argv[2] + '/sheet.png', 'x');
  `);
  const work = tmp();
  fs.writeFileSync(path.join(work, 'spec.json'), '{"ok": true, "generatedBy": {"model": "GPT-5.4 nano"}}');
  const s = await scoreRun({ work, skillCfg: pngCfg, skillDir: skill });
  assert.equal(s.outputOk, true);
  assert.equal(s.model, 'GPT-5.4 nano');
});

test('scoreRun: the model comes from the spec only (an invalid spec still reports it; no spec or no model is "-")', async () => {
  const score = async (spec) => {
    const work = tmp();
    if (spec) fs.writeFileSync(path.join(work, 'spec.json'), JSON.stringify(spec));
    return scoreRun({ work, skillCfg: cfg, skillDir: fakeSkill() });
  };
  assert.equal((await score({ ok: true, generatedBy: { model: 'Spec Model' } })).model, 'Spec Model');
  assert.equal((await score({ ok: true })).model, '-');
  assert.equal((await score(null)).model, '-');
  const bad = await score({ ok: false, generatedBy: { model: 'Spec Model' } });
  assert.equal(bad.finalValid, false);
  assert.equal(bad.model, 'Spec Model');
});

test('summarize has a "model reported" column and names the agent', () => {
  const md = summarize([
    { id: 'a', specExists: true, finalValid: true, validateRuns: 1, outputOk: true, seconds: 3, errors: [], model: 'Claude Haiku 5.5' },
    { id: 'b', specExists: false, finalValid: false, validateRuns: 0, outputOk: false, seconds: 3, errors: [] },
  ], { host: 'copilot', skill: 'dashboard', agent: 'artifact-builder' });
  assert.match(md, /\| seconds \| model reported \| notes \|/);
  assert.match(md, /\| a \| ✓ \| ✓ \| 1 \| ✓ \| 3 \| Claude Haiku 5\.5 \|/);
  assert.match(md, /\| b \| ✗ \| ✗ \| 0 \| ✗ \| 3 \| - \|/);
  assert.match(md, /artifact-builder/);
});

// --- --set prompt sets, the check column, the motion benchmark and its fixtures (Task 3) ---

const promptsDir = path.join(evalDir, 'prompts');

test('loadPrompts: no set reads prompts/<skill>.json, a set reads prompts/<skill>-<set>.json', () => {
  assert.deepEqual(loadPrompts(promptsDir, 'motion'), readJson('prompts', 'motion.json'));
  assert.deepEqual(loadPrompts(promptsDir, 'motion', 'benchmark'), readJson('prompts', 'motion-benchmark.json'));
  assert.deepEqual(loadPrompts(promptsDir, 'motion', 'items'), readJson('prompts', 'motion-items.json'));
});

test('loadPrompts: an unknown set names the sets that exist, and a set is never joined into a path', () => {
  assert.throws(() => loadPrompts(promptsDir, 'motion', 'x'), { message: 'unknown --set "x"; available for motion: benchmark, items' });
  assert.throws(() => loadPrompts(promptsDir, 'motion', '../motion'), { message: 'unknown --set "../motion"; available for motion: benchmark, items' });
  assert.throws(() => loadPrompts(promptsDir, 'scene', 'benchmark'), { message: 'unknown --set "benchmark"; available for scene: (none)' });
  assert.throws(() => loadPrompts(promptsDir, 'dashboard', 'benchmark'), { message: 'unknown --set "benchmark"; available for dashboard: kinds' });
  assert.throws(() => loadPrompts(promptsDir, 'explainer', 'x'), { message: 'unknown --set "x"; available for explainer: features' });
  assert.throws(() => loadPrompts(promptsDir, 'diagram', 'x'), { message: 'unknown --set "x"; available for diagram: cloud' });
  assert.throws(() => loadPrompts(promptsDir, 'motion', ''), /unknown --set ""/);
});

test('run-eval: an unknown --set exits 2 listing the sets before any host runs; a known set gets past that check', () => {
  const { r, hostLaunched } = runEvalWithFakeHosts(['--host', 'claude', '--skill', 'motion', '--set', 'nope']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown --set "nope"; available for motion: benchmark, items/);
  assert.match(r.stderr, /\[--set name\]/);
  assert.equal(hostLaunched, false, 'no host executable may be launched');
  const known = runEvalWithFakeHosts(['--host', 'claude', '--skill', 'motion', '--set', 'benchmark']);
  assert.equal(known.r.status, 2);
  assert.match(known.r.stderr, /host "claude" not available/);
});

// A fake skill whose scripts/check.mjs prints `body` and exits `code`.
function fakeSkillWithCheck(body, code = 0) {
  const skill = fakeSkill();
  fs.writeFileSync(path.join(skill, 'scripts/check.mjs'), `process.stdout.write(${JSON.stringify(body)}); process.exit(${code});`);
  return skill;
}
const checkCfg = { ...cfg, checkCmd: (skill, spec) => [path.join(skill, 'scripts/check.mjs'), spec, '--json'] };
const scoreWithCheck = async (body, code, skillCfg = checkCfg) => {
  const work = tmp();
  fs.writeFileSync(path.join(work, 'spec.json'), '{"ok": true}');
  return scoreRun({ work, skillCfg, skillDir: fakeSkillWithCheck(body, code) });
};

test('scoreRun records checkOk from checkCmd and null when the check skips', async () => {
  assert.equal((await scoreWithCheck('{"ok":true}\n', 0)).checkOk, true);
  assert.equal((await scoreWithCheck('{"ok":true,"skipped":true,"reason":"no browser"}\n', 0)).checkOk, null);
  assert.equal((await scoreWithCheck('{"ok":false,"errors":[{"path":"a","message":"b"}]}\n', 1)).checkOk, false);
  assert.equal((await scoreWithCheck('{"ok":true}\n', 1)).checkOk, false, 'a non-zero exit fails even with ok:true');
  assert.equal((await scoreWithCheck('boom, not json\n', 1)).checkOk, false, 'a check that printed no JSON is a failed check');
  assert.equal((await scoreWithCheck('{"ok":true,"warnings":["w"]}\nsome stderr after\n', 0)).checkOk, true, 'the JSON line need not be last');
});

test('scoreRun: checkOk is null without a checkCmd and when the output step did not succeed', async () => {
  assert.equal((await scoreWithCheck('{"ok":true}\n', 0, cfg)).checkOk, null);
  const invalidWork = tmp();
  fs.writeFileSync(path.join(invalidWork, 'spec.json'), '{"ok": false}');
  const invalid = await scoreRun({ work: invalidWork, skillCfg: checkCfg, skillDir: fakeSkillWithCheck('{"ok":true}\n', 0) });
  assert.equal(invalid.checkOk, null);
  const noSpec = await scoreRun({ work: tmp(), skillCfg: checkCfg, skillDir: fakeSkill() });
  assert.equal(noSpec.checkOk, null);
  const failOut = { ...checkCfg, outputCmd: (skill) => [path.join(skill, 'scripts/missing.mjs')] };
  const outWork = tmp();
  fs.writeFileSync(path.join(outWork, 'spec.json'), '{"ok": true}');
  const s = await scoreRun({ work: outWork, skillCfg: failOut, skillDir: fakeSkillWithCheck('{"ok":true}\n', 0) });
  assert.equal(s.outputOk, false);
  assert.equal(s.checkOk, null);
});

test('SKILLS checkCmd: motion checks the spec; diagram, explainer and scene check the page the build wrote; dashboard has none', () => {
  assert.deepEqual(SKILLS.motion.checkCmd('/s', '/w/motion.json', '/w'), [path.join('/s', 'scripts/check.mjs'), '/w/motion.json', '--json']);
  assert.deepEqual(SKILLS.diagram.checkCmd('/s', '/w/diagram.json', '/w'), [path.join('/s', 'scripts/check.mjs'), '/w/out/diagram.html', '--json']);
  assert.deepEqual(SKILLS.explainer.checkCmd('/s', '/w/explainer.json', '/w'), [path.join('/s', 'scripts/check.mjs'), '/w/out/explainer.html', '--json']);
  assert.deepEqual(SKILLS.scene.checkCmd('/s', '/w/scene.json', '/w'), [path.join('/s', 'scripts/check.mjs'), '/w/out/scene.html', '--json']);
  assert.deepEqual(Object.keys(SKILLS).filter((k) => SKILLS[k].checkCmd).sort(), ['diagram', 'explainer', 'motion', 'scene']);
  // the page each check opens is the artifact the output step is scored on
  for (const name of ['diagram', 'explainer', 'scene']) {
    const page = SKILLS[name].checkCmd('/s', `/w/${SKILLS[name].spec}`, '/w')[1];
    assert.ok(SKILLS[name].artifacts.includes(path.relative('/w', page)), `${name}: the check opens ${page}`);
  }
});

test('scoreRun hands checkCmd the workdir, so a check that needs the built page can find it', async () => {
  const pageCfg = { ...cfg, checkCmd: (skill, spec, work) => [path.join(skill, 'scripts/check.mjs'), path.join(work, 'dist/index.html'), '--json'] };
  const skill = fakeSkill();
  fs.writeFileSync(path.join(skill, 'scripts/check.mjs'), `
    import fs from 'node:fs';
    const ok = fs.existsSync(process.argv[2]);
    process.stdout.write(JSON.stringify({ ok }) + '\\n'); process.exit(ok ? 0 : 1);
  `);
  const work = tmp();
  fs.writeFileSync(path.join(work, 'spec.json'), '{"ok": true}');
  assert.equal((await scoreRun({ work, skillCfg: pageCfg, skillDir: skill })).checkOk, true);
});

test('summarize has a check column: ✓ passed, ✗ failed, - skipped or not run', () => {
  const base = { specExists: true, finalValid: true, validateRuns: 1, outputOk: true, seconds: 3, errors: [] };
  const md = summarize([{ id: 'a', ...base, checkOk: true }, { id: 'b', ...base, checkOk: false }, { id: 'c', ...base, checkOk: null }, { id: 'd', ...base }], { host: 'claude', skill: 'motion' });
  assert.match(md, /\| model reported \| notes \| check \|/, 'the check column keeps its place; later columns go after it');
  const columns = md.split('\n').find((l) => l.startsWith('| id |')).split('|').map((c) => c.trim());
  const cell = (id) => md.split('\n').find((l) => l.startsWith(`| ${id} |`)).split('|').map((c) => c.trim())[columns.indexOf('check')];
  assert.deepEqual(['a', 'b', 'c', 'd'].map(cell), ['✓', '✗', '-', '-']);
  assert.match(md, /check ok 1\/2/, 'counted over the rows whose check ran');
  const none = summarize([{ id: 'x', ...base }], { host: 'claude', skill: 'dashboard' });
  assert.doesNotMatch(none, /check ok/, 'the totals line only mentions the check when some row ran one');
});

const BENCHMARK_ORDER = [
  ['product-launch', ['launch-teaser', 'launch-feature-trio']],
  ['pr-walkthrough', ['pr-walkthrough', 'pr-code-diff']],
  ['data-viz', ['chart-race', 'map-regions']],
  ['captioned-social', ['captioned-social', 'captioned-vertical']],
  ['docs-to-video', ['docs-steps', 'docs-faq']],
  ['templated-batch', ['batch-welcome', 'batch-kpi-cards']],
];

test('the motion benchmark file has 12 prompts, unique ids, two per category tag', () => {
  const prompts = readJson('prompts', 'motion-benchmark.json');
  assert.equal(prompts.length, 12);
  assert.equal(new Set(prompts.map((p) => p.id)).size, 12);
  assert.deepEqual(prompts.map((p) => [p.category, p.id]), BENCHMARK_ORDER.flatMap(([c, ids]) => ids.map((id) => [c, id])));
  for (const [category] of BENCHMARK_ORDER) assert.equal(prompts.filter((p) => p.category === category).length, 2, category);
  for (const p of prompts) {
    assert.deepEqual(Object.keys(p).sort(), ['category', 'id', 'prompt'], `${p.id}: only id, category, prompt`);
    const seconds = [...p.prompt.matchAll(/(\d+)[- ]second/g)].map((m) => Number(m[1]));
    assert.equal(seconds.length, 1, `${p.id} names exactly one duration`);
    assert.ok(seconds[0] >= 10 && seconds[0] <= 30, `${p.id} duration ${seconds[0]} s is within 10-30`);
  }
});

test('the motion benchmark prompts carry the wording and fixtures the plan pins', () => {
  const by = Object.fromEntries(readJson('prompts', 'motion-benchmark.json').map((p) => [p.id, p.prompt]));
  assert.match(by['pr-walkthrough'], /as monospace text lines starting with \+ and -/);
  assert.match(by['pr-code-diff'], /a code-diff block/);
  assert.match(by['captioned-social'], /16:9/);
  assert.match(by['captioned-social'], /data\/captions\.srt/);
  assert.match(by['captioned-social'], /plain captions/);
  assert.match(by['captioned-vertical'], /9:16/);
  assert.match(by['captioned-vertical'], /data\/captions\.vtt/);
  assert.match(by['captioned-vertical'], /karaoke captions/);
  assert.match(by['captioned-vertical'], /data\/music\.wav/);
  assert.match(by['batch-welcome'], /name and city/);
  assert.match(by['batch-welcome'], /so it can be rendered per row of data\/rows\.json/);
  for (const [id, text] of Object.entries(by)) {
    for (const [, file] of text.matchAll(/\bdata\/([\w-]+\.\w+)/g)) assert.ok(fs.existsSync(path.join(evalDir, 'fixtures/data', file)), `${id} names data/${file}`);
  }
});

// The keys run-eval reads from a prompt entry: id and prompt always; category (benchmark), seed and repo (prepareWorkdir) when set.
const PROMPT_KEYS = ['id', 'prompt', 'category', 'seed', 'repo', 'expect', 'maxChanged'];

test('motion-items.json holds prompt entries with unique ids (tasks append to it) and the default motion.json is untouched', () => {
  const items = readJson('prompts', 'motion-items.json');
  assert.ok(Array.isArray(items));
  for (const p of items) {
    assert.equal(typeof p.id, 'string', JSON.stringify(p));
    assert.ok(p.id.length > 0, 'an id is never empty');
    assert.equal(typeof p.prompt, 'string', `${p.id}: prompt is a string`);
    assert.ok(p.prompt.trim().length > 0, `${p.id}: prompt is not empty`);
    const unknown = Object.keys(p).filter((k) => !PROMPT_KEYS.includes(k));
    assert.deepEqual(unknown, [], `${p.id}: keys are ${PROMPT_KEYS.join(', ')}`);
  }
  assert.equal(new Set(items.map((p) => p.id)).size, items.length, 'ids are unique');
  const ids = readJson('prompts', 'motion.json').map((p) => p.id);
  assert.equal(ids.length, 10);
  assert.equal(ids[0], 'q3-counter');
  assert.equal(ids[9], 'edit-existing');
});

const dataFile = (name) => path.join(evalDir, 'fixtures/data', name);
const words = (text) => text.split(/\s+/).filter(Boolean).length;

test('captions.srt has 6 cues and 24 words, and captions.vtt carries the same text under a WEBVTT header', () => {
  const srt = fs.readFileSync(dataFile('captions.srt'), 'utf8');
  const vtt = fs.readFileSync(dataFile('captions.vtt'), 'utf8');
  const blocks = (text) => text.trim().split(/\r?\n\r?\n/);
  const cueText = (block) => block.split(/\r?\n/).filter((l) => !/^\d+$/.test(l) && !l.includes('-->')).join(' ');
  const srtBlocks = blocks(srt);
  assert.equal(srtBlocks.length, 6);
  assert.ok(srtBlocks.every((b) => /^\d+\n\d\d:\d\d:\d\d,\d{3} --> \d\d:\d\d:\d\d,\d{3}\n\S/.test(b)));
  assert.equal(words(srtBlocks.map(cueText).join(' ')), 24);
  assert.match(vtt, /^WEBVTT\n/);
  const vttCues = blocks(vtt).slice(1);
  assert.equal(vttCues.length, 6);
  assert.ok(vttCues.every((b) => /\d\d:\d\d:\d\d\.\d{3} --> \d\d:\d\d:\d\d\.\d{3}/.test(b)));
  assert.deepEqual(vttCues.map(cueText), srtBlocks.map(cueText));
});

test('rows.json has 3 rows of name, city and count', () => {
  const rows = JSON.parse(fs.readFileSync(dataFile('rows.json'), 'utf8'));
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row), ['name', 'city', 'count']);
    assert.equal(typeof row.name, 'string');
    assert.equal(typeof row.city, 'string');
    assert.equal(typeof row.count, 'number');
  }
});

test('music.wav is exactly writeWav({ clickBpm: 120 }): 10 s mono 8 kHz, a 20 ms 1 kHz burst every 0.5 s', async () => {
  const { wavBuffer } = await import('../../skills/make-motion/test/helpers/wav.mjs');
  const file = fs.readFileSync(dataFile('music.wav'));
  assert.deepEqual(file, wavBuffer({ seconds: 10, sampleRate: 8000, clickBpm: 120 }));
  assert.equal(file.readUInt16LE(22), 1);
  assert.equal(file.readUInt32LE(24), 8000);
  assert.equal(file.length, 44 + 10 * 8000 * 2);
});

test('clip.mp4 is a small committed H.264 file: 2 s, 320x180, no audio', (t) => {
  const file = dataFile('clip.mp4');
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.subarray(4, 8).toString('latin1'), 'ftyp');
  assert.ok(bytes.length < 100 * 1024, `${bytes.length} bytes is under 100 KB`);
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height:format=duration', '-of', 'json', file], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) { t.skip('ffprobe unavailable'); return; }
  const info = JSON.parse(probe.stdout);
  assert.deepEqual(info.streams.map((s) => s.codec_type), ['video']);
  assert.equal(info.streams[0].codec_name, 'h264');
  assert.equal(`${info.streams[0].width}x${info.streams[0].height}`, '320x180');
  assert.ok(Math.abs(Number(info.format.duration) - 2) < 0.15, `duration ${info.format.duration}`);
});

// --- PA-55: relative fixture dates, feature-used scoring, edit size limit, validate log, host allowlist ---

const DAY_MS = 24 * 60 * 60 * 1000;
const commitDates = (dir) => {
  const r = spawnSync('git', ['log', '--format=%cI'], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim().split('\n').map((d) => Date.parse(d));
};

test('createFixtureRepo dates its commits relative to the clock, so they stay inside the 12-week lookback of make-scene rows', () => {
  const lookback = 12 * 7 * DAY_MS;
  for (const now of [Date.parse('2026-10-20T12:00:00Z'), Date.parse('2027-06-01T12:00:00Z'), Date.parse('2029-01-15T08:30:00Z')]) {
    const dir = path.join(tmp(), 'repo');
    createFixtureRepo(dir, { now });
    const dates = commitDates(dir);
    assert.equal(dates.length, 4);
    for (const d of dates) assert.ok(d <= now && now - d < lookback, `commit at ${new Date(d).toISOString()} is inside ${new Date(now).toISOString()} minus 12 weeks`);
    assert.deepEqual([...dates].sort((a, b) => a - b), [...dates].reverse(), 'oldest commit first, newest last');
  }
});

test('createFixtureRepo with no clock given uses the real one', () => {
  const dir = path.join(tmp(), 'repo');
  const before = Date.now();
  createFixtureRepo(dir);
  for (const d of commitDates(dir)) assert.ok(d <= Date.now() && before - d < 12 * 7 * DAY_MS);
});

test('parseExpect reads `key`, `key=value` and `key^=prefix`, and refuses an empty token', () => {
  assert.deepEqual(parseExpect('cues'), { key: 'cues', op: 'has' });
  assert.deepEqual(parseExpect('block=title-card'), { key: 'block', op: 'eq', value: 'title-card' });
  assert.deepEqual(parseExpect('cue^=kenney:'), { key: 'cue', op: 'prefix', value: 'kenney:' });
  assert.deepEqual(parseExpect('format=9:16'), { key: 'format', op: 'eq', value: '9:16' });
  for (const bad of ['', '=x', '^=x', 'a=', 42, null]) assert.throws(() => parseExpect(bad), /expect/, String(bad));
});

test('featureUsed: a spec lacking the feature fails, one that uses it at any depth passes (the feature-used predicate)', () => {
  const spec = { scenes: [{ elements: [{ type: 'block', block: 'title-card', params: {} }, { type: 'text', hold: true }, { cue: 'kenney:click' }] }], format: '9:16' };
  assert.deepEqual(featureUsed(spec, ['block=title-card']), { ok: true, missing: [] });
  assert.deepEqual(featureUsed(spec, ['block=lower-third']), { ok: false, missing: ['block=lower-third'] });
  assert.deepEqual(featureUsed(spec, ['hold=true', 'cue^=kenney:', 'format=9:16']), { ok: true, missing: [] });
  assert.deepEqual(featureUsed(spec, ['hold', 'camera', 'vars']), { ok: false, missing: ['camera', 'vars'] });
  assert.deepEqual(featureUsed({ title: 'bare' }, ['block=title-card']), { ok: false, missing: ['block=title-card'] });
  assert.deepEqual(featureUsed(spec, []), { ok: true, missing: [] });
  assert.deepEqual(featureUsed(spec), { ok: true, missing: [] });
});

test('featureUsed: `a|b` is met when either alternative is, so a bare transition name and a transition object both count', () => {
  const bare = { scenes: [{ id: 'a', transition: 'push' }] };
  const object = { scenes: [{ id: 'a', transition: { type: 'push', direction: 'left' } }] };
  const none = { scenes: [{ id: 'a', transition: 'fade' }] };
  assert.equal(featureUsed(bare, ['type=push']).ok, false, 'one form alone misses the other');
  assert.equal(featureUsed(object, ['transition=push']).ok, false);
  for (const spec of [bare, object]) assert.deepEqual(featureUsed(spec, ['transition=push|type=push']), { ok: true, missing: [] });
  assert.deepEqual(featureUsed(none, ['transition=push|type=push']), { ok: false, missing: ['transition=push|type=push'] });
  assert.deepEqual(featureUsed(object, ['transition=push|type=push', 'camera']).missing, ['camera'], 'each token is judged on its own');
  assert.equal(parseAlternatives('a=1|b^=x|c').length, 3);
  assert.throws(() => parseAlternatives('a=1|'), /expect/);
});

test('featureUsed ignores inherited names and does not match a value that only appears as text', () => {
  assert.deepEqual(featureUsed({ a: {} }, ['constructor', 'toString', '__proto__', 'hasOwnProperty']).missing, ['constructor', 'toString', '__proto__', 'hasOwnProperty'], 'names every object inherits are not features');
  assert.equal(featureUsed({ text: 'block=title-card' }, ['block=title-card']).ok, false);
  assert.equal(featureUsed({ block: 'title-card-2' }, ['block=title-card']).ok, false, 'a value must match whole');
  assert.equal(featureUsed({ toString: 1 }, ['constructor']).ok, false);
  assert.equal(featureUsed({ n: 3 }, ['n=3']).ok, true, 'a number matches its text');
});

test('scoreRun: featureOk is null with no expectation, false and named when the spec ignores the feature, true when it uses it', async () => {
  const score = async (spec, expect) => {
    const work = tmp();
    fs.writeFileSync(path.join(work, 'spec.json'), JSON.stringify(spec));
    return scoreRun({ work, skillCfg: cfg, skillDir: fakeSkill(), expect });
  };
  assert.equal((await score({ ok: true })).featureOk, null);
  const miss = await score({ ok: true }, ['block=title-card']);
  assert.equal(miss.featureOk, false);
  assert.deepEqual(miss.missingFeatures, ['block=title-card']);
  assert.equal(miss.finalValid, true, 'a missing feature does not change what valid means, so old summaries stay comparable');
  assert.equal(miss.outputOk, true);
  const hit = await score({ ok: true, block: 'title-card' }, ['block=title-card']);
  assert.equal(hit.featureOk, true);
  assert.deepEqual(hit.missingFeatures, []);
});

test('scoreRun: no spec leaves featureOk null; an invalid spec still reports the missing feature', async () => {
  assert.equal((await scoreRun({ work: tmp(), skillCfg: cfg, skillDir: fakeSkill(), expect: ['x'] })).featureOk, null);
  const work = tmp();
  fs.writeFileSync(path.join(work, 'spec.json'), '{"ok": false}');
  const s = await scoreRun({ work, skillCfg: cfg, skillDir: fakeSkill(), expect: ['x'] });
  assert.equal(s.finalValid, false);
  assert.equal(s.featureOk, false);
});

test('scoreRun: an edit that rewrites more paths than the prompt allows is flagged (editOk false), a targeted one is not; valid is untouched', async () => {
  const seed = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`f${i}`, i]));
  const rewritten = { ok: true, ...Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`f${i}`, i + 100])) };
  const targeted = { ok: true, ...seed, f3: 99 };
  const score = async (spec, maxChanged) => {
    const work = tmp();
    fs.writeFileSync(path.join(work, 'spec.json'), JSON.stringify(spec));
    return scoreRun({ work, skillCfg: cfg, skillDir: fakeSkill(), seedSpec: seed, maxChanged });
  };
  const bad = await score(rewritten, 4);
  assert.equal(bad.editOk, false);
  assert.equal(bad.editLimit, 4);
  assert.equal(bad.finalValid, true, 'the limit is reported, not scored: summaries from before it stay comparable');
  assert.equal(bad.outputOk, true);
  assert.equal(bad.changedPaths.length, 17);
  const good = await score(targeted, 4);
  assert.equal(good.editOk, true);
  assert.equal(good.finalValid, true);
  assert.deepEqual(good.changedPaths.sort(), ['f3', 'ok']);
  assert.equal((await score(rewritten, undefined)).editOk, null, 'no limit on the prompt: no check');
  const md = summarize([{ id: 'e', specExists: true, finalValid: true, validateRuns: 1, outputOk: true, seconds: 1, errors: [], ...bad }], { host: 'claude', skill: 'dashboard' });
  assert.match(md, /edit too broad: 17 paths changed, limit 4/);
});

test('readValidateLog: one record per line, bad lines skipped, messages kept when the writer provides them', () => {
  const d = tmp();
  const f = path.join(d, 'log');
  assert.deepEqual(readValidateLog(path.join(d, 'nope')), []);
  fs.writeFileSync(f, [
    JSON.stringify({ ts: 't1', ok: false, errors: 2, messages: [{ path: 'a', message: 'bad a' }, 'bare string'] }),
    'not json',
    JSON.stringify({ ts: 't2', ok: true, errors: 0 }),
    '',
    JSON.stringify({ ok: 'yes', errors: 'x' }),
  ].join('\n'));
  assert.deepEqual(readValidateLog(f), [
    { ts: 't1', ok: false, errors: 2, messages: ['a: bad a', 'bare string'] },
    { ts: 't2', ok: true, errors: 0, messages: [] },
    { ts: null, ok: null, errors: null, messages: [] },
  ]);
});

test('scoreRun: firstTryValid tells never-validated (null) from first-call-valid (true) and needed-retries (false)', async () => {
  const score = async (lines) => {
    const work = tmp();
    fs.writeFileSync(path.join(work, 'spec.json'), '{"ok": true}');
    if (lines) fs.writeFileSync(path.join(work, '.eval-log.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n'));
    return scoreRun({ work, skillCfg: cfg, skillDir: fakeSkill() });
  };
  const never = await score(null);
  assert.equal(never.validateRuns, 0);
  assert.equal(never.firstTryValid, null);
  assert.deepEqual(never.validateAttempts, []);
  const first = await score([{ ok: true, errors: 0 }]);
  assert.equal(first.firstTryValid, true);
  const retry = await score([{ ok: false, errors: 3, messages: ['a: x'] }, { ok: true, errors: 0 }]);
  assert.equal(retry.firstTryValid, false);
  assert.equal(retry.validateRuns, 2);
  assert.deepEqual(retry.validateAttempts.map((a) => a.errors), [3, 0]);
  assert.deepEqual(retry.validateAttempts[0].messages, ['a: x']);
});

test('summarize adds feature and first-try columns after check, keeps the old ones, and counts only rows that had an expectation', () => {
  const base = { specExists: true, finalValid: true, validateRuns: 1, outputOk: true, seconds: 3, errors: [] };
  const md = summarize([
    { id: 'a', ...base, featureOk: true, firstTryValid: true },
    { id: 'b', ...base, featureOk: false, missingFeatures: ['block=title-card'], firstTryValid: false },
    { id: 'c', ...base, featureOk: null, firstTryValid: null, validateRuns: 0 },
  ], { host: 'claude', skill: 'motion' });
  const header = md.split('\n').find((l) => l.startsWith('| id |')).split('|').map((c) => c.trim());
  assert.deepEqual(header.slice(header.indexOf('check')), ['check', 'feature', 'first try', '']);
  const cells = (id) => md.split('\n').find((l) => l.startsWith(`| ${id} |`)).split('|').map((c) => c.trim());
  assert.deepEqual(['a', 'b', 'c'].map((id) => cells(id)[header.indexOf('feature')]), ['✓', '✗', '-']);
  assert.deepEqual(['a', 'b', 'c'].map((id) => cells(id)[header.indexOf('first try')]), ['✓', '✗', '-']);
  assert.match(md, /feature used 1\/2/);
  assert.match(md.split('\n').find((l) => l.startsWith('| b |')), /missing feature: block=title-card/);
  assert.doesNotMatch(summarize([{ id: 'x', ...base }], { host: 'claude', skill: 'dashboard' }), /feature used/);
});

test('hosts.json: the claude host may run read-only helpers (echo, pwd, head) that agents reach for', () => {
  const claude = readJson('hosts.json').claude;
  const tools = claude.cmd.slice(claude.cmd.indexOf('--allowedTools') + 1);
  for (const t of ['Bash(echo:*)', 'Bash(pwd:*)', 'Bash(head:*)', 'Bash(node:*)']) assert.ok(tools.includes(t), t);
  for (const t of tools) assert.doesNotMatch(t, /^Bash\((rm|curl|wget|sh|bash|git|mv|cp)\b/, `${t} is not read-only`);
});

test('hosts.json: claude-frontmatter is claude without modelArgs (the account default model; frontmatter use unverified)', () => {
  const hosts = readJson('hosts.json');
  assert.deepEqual(hosts['claude-frontmatter'].cmd, hosts.claude.cmd);
  assert.deepEqual(hosts['claude-frontmatter'].check, hosts.claude.check);
  assert.equal(hosts['claude-frontmatter'].modelArgs, undefined);
  assert.equal(hosts.claude.modelArgs.length > 0, true);
});

// PA-46: the harness copies the skill to <work>/skills/<dir>/ and the prompt says "Read skills/<dir>/SKILL.md", so
// the skill is read as a plain file, not invoked. No docs line may claim the SKILL.md frontmatter decides the model
// of this host until a session log shows it. Each line that names the host must say it is unverified.
test('docs: no line claims the claude-frontmatter host applies the SKILL.md model or effort; each says unverified', () => {
  const pluginDir = path.resolve(evalDir, '..');
  const files = ['README.md', 'USAGE.md', 'eval/README.md', 'eval/results/INDEX.md', 'eval/results/summary-routing-2026-10-21.md'];
  const claim = /(model and effort|model or effort)[^.\n]*(apply|applies|decides|from each `SKILL\.md`|is what runs)|decides the model|SKILL\.md model and effort/i;
  let named = 0;
  for (const f of files) {
    const lines = fs.readFileSync(path.join(pluginDir, f), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!line.includes('claude-frontmatter')) return;
      named += 1;
      const ctx = lines.slice(Math.max(0, i - 1), i + 6).join(' ');
      assert.doesNotMatch(line, claim, `${f}:${i + 1} claims the frontmatter applies`);
      assert.match(ctx, /unverified|not verified/i, `${f}:${i + 1} names claude-frontmatter without saying it is unverified`);
    });
  }
  assert.ok(named >= 5, `expected the host named in all five docs, saw ${named}`);
});

test('run-eval: --model on a host without modelArgs is a usage error before any host runs, not silently ignored', () => {
  const { r, hostLaunched } = runEvalWithFakeHosts(['--host', 'claude-frontmatter', '--model', 'haiku']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /host "claude-frontmatter" has no modelArgs/);
  assert.match(r.stderr, /\[--model m\]/);
  assert.equal(hostLaunched, false);
  const ok = runEvalWithFakeHosts(['--host', 'claude-frontmatter']);
  assert.match(ok.r.stderr, /host "claude-frontmatter" not available/, 'without --model it reaches the host check');
});

// --- NEW-69: local models are gated, and a run that never writes a spec is cut short ---

test('LOCAL_MODEL_GATED_SKILLS: motion and explainer, where local models failed', () => {
  assert.deepEqual([...LOCAL_MODEL_GATED_SKILLS].sort(), ['explainer', 'motion']);
});

test('hosts.json: codex-oss is marked local and carries a no-spec abort time; no other host is local', () => {
  const hosts = readJson('hosts.json');
  assert.equal(hosts['codex-oss'].local, true);
  assert.ok(Number.isInteger(hosts['codex-oss'].abortNoSpecSec) && hosts['codex-oss'].abortNoSpecSec > 0);
  assert.deepEqual(Object.keys(hosts).filter((h) => hosts[h].local), ['codex-oss']);
});

test('run-eval: a local model on motion or explainer needs --allow-local-models, and says why; dashboard, diagram and scene need no flag', () => {
  for (const skill of ['motion', 'explainer']) {
    const { r, hostLaunched } = runEvalWithFakeHosts(['--host', 'codex-oss', '--model', 'gemma4', '--skill', skill]);
    assert.equal(r.status, 2, skill);
    assert.match(r.stderr, /--allow-local-models/, skill);
    assert.match(r.stderr, new RegExp(`${skill}`), skill);
    assert.equal(hostLaunched, false, 'no host runs before the gate');
  }
  const allowed = runEvalWithFakeHosts(['--host', 'codex-oss', '--model', 'gemma4', '--skill', 'motion', '--allow-local-models']);
  assert.match(allowed.r.stderr, /host "codex-oss" not available/, 'the flag lets it reach the host check');
  const dash = runEvalWithFakeHosts(['--host', 'codex-oss', '--model', 'gemma4', '--skill', 'diagram']);
  assert.match(dash.r.stderr, /host "codex-oss" not available/);
  const hosted = runEvalWithFakeHosts(['--host', 'claude', '--skill', 'motion']);
  assert.match(hosted.r.stderr, /host "claude" not available/, 'a hosted model is never gated');
});

test('run-eval: --abort-no-spec must be a whole number of seconds (0 turns it off)', () => {
  const bad = runEvalWithFakeHosts(['--host', 'claude', '--abort-no-spec', 'soon']);
  assert.equal(bad.r.status, 2);
  assert.match(bad.r.stderr, /--abort-no-spec must be a whole number of seconds/);
  assert.match(bad.r.stderr, /\[--abort-no-spec sec\]/);
  const zero = runEvalWithFakeHosts(['--host', 'claude', '--abort-no-spec', '0']);
  assert.match(zero.r.stderr, /host "claude" not available/);
});

test('run: abortIf kills a host that has produced nothing by the deadline, and leaves one that has', async () => {
  const slow = await run(['node', '-e', 'setTimeout(()=>{},60000)'], { abortIf: { afterMs: 300, done: () => false } });
  assert.equal(slow.aborted, true);
  assert.equal(slow.timedOut, false);
  assert.ok(slow.seconds < 10, `killed in ${slow.seconds}s`);
  const fine = await run(['node', '-e', 'setTimeout(()=>{},900)'], { abortIf: { afterMs: 300, done: () => true } });
  assert.equal(fine.aborted, false);
  assert.equal(fine.code, 0);
  const plain = await run(['node', '-e', 'console.log(1)']);
  assert.equal(plain.aborted, false);
});

// --- PA-54: every block, section type and chart kind has a prompt that asks for it ---

// All prompts for a skill, default file and every --set file: prompts/<skill>.json, prompts/<skill>-<set>.json.
const allPrompts = (skill) => fs.readdirSync(promptsDir)
  .filter((f) => f === `${skill}.json` || (f.startsWith(`${skill}-`) && f.endsWith('.json')))
  .sort()
  .flatMap((f) => readJson('prompts', f).map((p) => ({ ...p, file: f })));
const promptsExpecting = (skill, token) => allPrompts(skill).filter((p) => p.expect?.includes(token)).map((p) => p.id);
const uncovered = (skill, tokens) => tokens.filter((t) => promptsExpecting(skill, t).length === 0);

// What the code defines, read from the code and not from docs: a rename or a new entry turns these tests red.
const { BLOCK_NAMES } = await import('../../skills/make-motion/template/blocks/index.mjs');
const { TYPES: SECTION_TYPES } = await import('../../skills/make-explainer/scripts/lib/schema.mjs');
const { KIND_NAMES } = await import('../../skills/make-dashboard/scripts/lib/kinds.mjs');

// Sections no prompt can ask for: the explainer eval copies neither make-motion nor make-scene (see SKILLS.explainer).
const EXPLAINER_EXEMPT = ['motion', 'scene'];

test('every make-motion block has a prompt that expects it', () => {
  assert.ok(BLOCK_NAMES.length >= 38, `${BLOCK_NAMES.length} blocks`);
  assert.deepEqual(uncovered('motion', BLOCK_NAMES.map((b) => `block=${b}`)), []);
});

test('every make-explainer section type except motion and scene has a prompt that expects it', () => {
  assert.ok(SECTION_TYPES.includes('diff') && SECTION_TYPES.length === 25, `${SECTION_TYPES.length} section types`);
  const wanted = SECTION_TYPES.filter((t) => !EXPLAINER_EXEMPT.includes(t));
  assert.deepEqual(uncovered('explainer', wanted.map((t) => `type=${t}`)), []);
});

test('the explainer exemption is exact: those two sections are real, no prompt expects them, and the eval does not copy their skills', () => {
  for (const t of EXPLAINER_EXEMPT) {
    assert.ok(SECTION_TYPES.includes(t), `${t} is a section type`);
    assert.deepEqual(promptsExpecting('explainer', `type=${t}`), [], `no prompt can ask for ${t}`);
  }
  assert.equal(SKILLS.explainer.siblings.includes('make-motion'), false);
  assert.equal(SKILLS.explainer.siblings.includes('make-scene'), false);
});

test('every make-dashboard chart kind has a prompt that expects it', () => {
  assert.equal(KIND_NAMES.length, 11);
  assert.deepEqual(uncovered('dashboard', KIND_NAMES.map((k) => `kind=${k}`)), []);
});

test('the diagram eval has a cloud-icon prompt', () => {
  assert.ok(allPrompts('diagram').some((p) => p.expect?.includes('icon^=cloud:') && /aws|google cloud/i.test(p.prompt)));
});

test('every expectation parses, names something real, and no prompt id repeats within a skill', () => {
  for (const skill of ['motion', 'explainer', 'dashboard', 'diagram', 'scene']) {
    const prompts = allPrompts(skill);
    for (const p of prompts) {
      for (const token of p.expect ?? []) {
        for (const { key, value } of parseAlternatives(token)) {
          if (key === 'block') assert.ok(BLOCK_NAMES.includes(value), `${p.id}: ${token} is a block`);
          if (skill === 'explainer' && key === 'type') assert.ok(SECTION_TYPES.includes(value), `${p.id}: ${token} is a section type`);
          if (skill === 'dashboard' && key === 'kind') assert.ok(KIND_NAMES.includes(value), `${p.id}: ${token} is a chart kind`);
        }
      }
      if (p.maxChanged !== undefined) assert.ok(Number.isInteger(p.maxChanged) && p.maxChanged > 0 && p.seed, `${p.id}: maxChanged is a whole number on an edit prompt`);
    }
    const ids = prompts.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length, `${skill}: ids are unique across sets`);
  }
});

test('every motion expectation is met by a spec the skill ships, and a bare spec meets none (the predicate can fail)', () => {
  const examples = path.join(skillsDir, 'make-motion/references/examples');
  const specs = [...fs.readdirSync(examples).filter((f) => f.endsWith('.json')).map((f) => path.join(examples, f)),
    ...fs.readdirSync(path.join(examples, 'blocks')).filter((f) => f.endsWith('.json')).map((f) => path.join(examples, 'blocks', f))]
    .map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
  const tokens = new Set(allPrompts('motion').flatMap((p) => p.expect ?? []));
  assert.ok(tokens.size > 40, `${tokens.size} distinct expectations`);
  for (const token of tokens) {
    assert.ok(specs.some((s) => featureUsed(s, [token]).ok), `no shipped example uses ${token}`);
    assert.equal(featureUsed({ scenes: [{ id: 'a', duration: 3, elements: [] }] }, [token]).ok, false, `a bare spec must not meet ${token}`);
  }
});

test('every motion item prompt names a feature to expect (the feature-used check)', () => {
  const items = readJson('prompts', 'motion-items.json');
  assert.deepEqual(items.filter((p) => !p.expect?.length).map((p) => p.id), []);
});

test('item-beats leaves no dead stretch: a clip no longer than its last beat plus a closing line, not seven idle seconds', () => {
  const prompt = readJson('prompts', 'motion-items.json').find((p) => p.id === 'item-beats').prompt;
  assert.match(prompt, /Make a 6-second clip/);
  assert.match(prompt, /beats 2, 4 and 6/);
  assert.match(prompt, /closing line .* beat 8 and stays until the end/);
  assert.doesNotMatch(prompt, /10-second/);
});

// Limits sit above what committed summaries show a correct edit changing (dashboard edit-existing: 3 to 4 paths, scene
// tour: 1, forest: 2) and far below the 16-path rewrite one local model produced.
test('seeded edit prompts carry a path limit generous enough for the edit asked and far below a rewrite', () => {
  for (const [skill, id, limit] of [['dashboard', 'edit-existing', 10], ['dashboard', 'edit-kind', 8], ['explainer', 'edit-existing', 6], ['explainer', 'edit-add-risk', 4], ['diagram', 'edit-existing', 8], ['scene', 'edit-add-tour', 4], ['scene', 'edit-switch-forest', 6]]) {
    assert.equal(allPrompts(skill).find((p) => p.id === id).maxChanged, limit, `${skill}/${id}`);
  }
});

test('run-eval cuts a local-model run short when it has written no spec by the deadline, and records it', () => {
  const bin = tmp();
  const out = tmp();
  // fake `ollama` passes the host check; fake `codex` never writes a spec and would idle for a minute
  fs.writeFileSync(path.join(bin, 'ollama'), `#!${process.execPath}\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'codex'), `#!${process.execPath}\nsetTimeout(() => {}, 60000);\n`, { mode: 0o755 });
  const started = Date.now();
  const evalOnce = (id) => {
    const r = spawnSync(process.execPath, [path.join(evalDir, 'run-eval.mjs'), '--skill', 'diagram', '--host', 'codex-oss', '--model', 'gemma4', '--only', id, '--abort-no-spec', '1', '--out', path.join(out, id)], {
      encoding: 'utf8', env: { ...process.env, PATH: bin }, timeout: 40000,
    });
    assert.equal(r.status, 0, r.stderr);
    const dir = path.join(out, id, 'codex-oss-diagram');
    return { row: JSON.parse(fs.readFileSync(path.join(dir, 'results.json'), 'utf8')).rows[0], summary: fs.readFileSync(path.join(dir, 'summary.md'), 'utf8') };
  };
  const fresh = evalOnce('checkout-path');
  assert.equal(fresh.row.aborted, true);
  assert.equal(fresh.row.specExists, false);
  assert.match(fresh.summary, /aborted: no spec and no validate by the deadline/);
  // an edit prompt starts with the seed spec in place, so an unchanged seed is not progress either
  const seeded = evalOnce('edit-existing');
  assert.equal(seeded.row.aborted, true);
  assert.equal(seeded.row.specExists, true);
  assert.ok(Date.now() - started < 30000, 'neither run waited for the 60 s the fake host would idle');
});

test('run: abortIf also kills the grandchildren the host started', async () => {
  const d = tmp();
  const pidFile = path.join(d, 'gc.pid');
  const script = `const c=require('child_process').spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{stdio:'ignore'});require('fs').writeFileSync(${JSON.stringify(pidFile)},String(c.pid));setTimeout(()=>{},60000);`;
  const r = await run(['node', '-e', script], { abortIf: { afterMs: 400, done: () => false } });
  assert.equal(r.aborted, true);
  const gc = Number(fs.readFileSync(pidFile, 'utf8'));
  await new Promise((res) => setTimeout(res, 300));
  assert.throws(() => process.kill(gc, 0), /ESRCH/);
});

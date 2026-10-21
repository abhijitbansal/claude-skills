import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { SKILLS, buildPrompt, expandCmd, readReportedModel, readSpecModel, diffPaths, countValidateRuns, scoreRun, summarize, run, linkNodeModules, createFixtureRepo, prepareWorkdir, copySkill } from '../lib.mjs';

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

test('run-eval: --agent on a host without agentArgs is a usage error before any host runs', () => {
  const r = spawnSync('node', [path.join(evalDir, 'run-eval.mjs'), '--skill', 'dashboard', '--host', 'claude', '--agent', 'artifact-builder'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /host "claude" has no agentArgs/);
  assert.match(r.stderr, /\[--agent name\]/);
});

test('run-eval: --agent needs a non-empty name', () => {
  const r = spawnSync('node', [path.join(evalDir, 'run-eval.mjs'), '--skill', 'dashboard', '--host', 'copilot', '--agent', ''], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--agent needs a name/);
});

const pageWith = (model) => `<!doctype html><html><head><meta name="generator" content="portable-artifacts make-dashboard; model=${model}; effort=low; agent=copilot"></head><body></body></html>`;

test('readReportedModel reads generatedBy.model from the generator meta of a built page', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'index.html'), pageWith('Claude Haiku 5.5'));
  assert.equal(readReportedModel(path.join(d, 'index.html')), 'Claude Haiku 5.5');
});

test('readReportedModel gives "-" for "not reported", a page without the meta, a missing file or a non-page', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'a.html'), pageWith('not reported'));
  fs.writeFileSync(path.join(d, 'b.html'), '<html></html>');
  fs.writeFileSync(path.join(d, 'c.png'), 'x');
  assert.equal(readReportedModel(path.join(d, 'a.html')), '-');
  assert.equal(readReportedModel(path.join(d, 'b.html')), '-');
  assert.equal(readReportedModel(path.join(d, 'nope.html')), '-');
  assert.equal(readReportedModel(path.join(d, 'c.png')), '-');
});

test('scoreRun records the model reported by the built page, "-" when the output carries none', async () => {
  const skill = fakeSkill();
  fs.writeFileSync(path.join(skill, 'scripts/build.mjs'), `
    import fs from 'node:fs';
    fs.mkdirSync(process.argv[4], { recursive: true });
    fs.writeFileSync(process.argv[4] + '/index.html', ${JSON.stringify(pageWith('GPT-5.4 nano'))});
  `);
  const work = tmp();
  fs.writeFileSync(path.join(work, 'spec.json'), '{"ok": true}');
  assert.equal((await scoreRun({ work, skillCfg: cfg, skillDir: skill })).model, 'GPT-5.4 nano');
  const bare = tmp();
  fs.writeFileSync(path.join(bare, 'spec.json'), '{"ok": true}');
  assert.equal((await scoreRun({ work: bare, skillCfg: cfg, skillDir: fakeSkill() })).model, '-');
  assert.equal((await scoreRun({ work: tmp(), skillCfg: cfg, skillDir: fakeSkill() })).model, '-');
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

test('scoreRun: the spec model wins over the page, an invalid spec still reports it, the page fills in when the spec has none', async () => {
  const skill = fakeSkill();
  fs.writeFileSync(path.join(skill, 'scripts/build.mjs'), `
    import fs from 'node:fs';
    fs.mkdirSync(process.argv[4], { recursive: true });
    fs.writeFileSync(process.argv[4] + '/index.html', ${JSON.stringify(pageWith('Page Model'))});
  `);
  const score = async (spec) => {
    const work = tmp();
    fs.writeFileSync(path.join(work, 'spec.json'), JSON.stringify(spec));
    return scoreRun({ work, skillCfg: cfg, skillDir: skill });
  };
  assert.equal((await score({ ok: true, generatedBy: { model: 'Spec Model' } })).model, 'Spec Model');
  assert.equal((await score({ ok: true })).model, 'Page Model');
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

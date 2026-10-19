// Pure-ish helpers for the cross-host eval runner. Kept separate from the CLI
// so scoring can be tested with a fake host and no LLM.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SKILLS = {
  dashboard: {
    dir: 'make-dashboard',
    spec: 'dashboard.json',
    // Build into <work>/dist; success = dist/index.html exists.
    outputCmd: (skill, spec, work) => [path.join(skill, 'scripts/build.mjs'), spec, '--out', path.join(work, 'dist')],
    artifacts: ['dist/index.html'],
  },
  motion: {
    dir: 'make-motion',
    spec: 'motion.json',
    // Contact sheet into <work>/out; success = at least one PNG.
    outputCmd: (skill, spec, work) => [path.join(skill, 'scripts/render.mjs'), spec, '--contact-sheet', '--out', path.join(work, 'out')],
    artifacts: ['out'],
  },
  diagram: {
    dir: 'make-diagram',
    spec: 'diagram.json',
    // Build into <work>/out; success = out/diagram.html exists.
    outputCmd: (skill, spec, work) => [path.join(skill, 'scripts/build.mjs'), spec, '--out', path.join(work, 'out/diagram.html')],
    artifacts: ['out/diagram.html'],
  },
  explainer: {
    dir: 'make-explainer',
    spec: 'explainer.json',
    // Sibling skills are copied next to it: make-explainer resolves them as ../<name> and loads them lazily.
    // make-motion is left out: motion sections need ffmpeg and Chromium, and no prompt asks for one.
    siblings: ['make-diagram', 'make-dashboard'],
    // Build into <work>/out; success = out/explainer.html exists.
    outputCmd: (skill, spec, work) => [path.join(skill, 'scripts/build.mjs'), spec, '--out', path.join(work, 'out/explainer.html')],
    artifacts: ['out/explainer.html'],
  },
  scene: {
    dir: 'make-scene',
    spec: 'scene.json',
    // A lift loads make-diagram or make-dashboard, resolved as ../<name> beside the skill.
    siblings: ['make-diagram', 'make-dashboard'],
    // Build into <work>/out; success = out/scene.html exists.
    outputCmd: (skill, spec, work) => [path.join(skill, 'scripts/build.mjs'), spec, '--out', path.join(work, 'out/scene.html')],
    artifacts: ['out/scene.html'],
  },
};

// A prompt with `"repo": true` gets a small git repository at <work>/repo: `main`, then the branch
// feat/search with three commits (one adds a test file). Git runs with argument arrays and a scrubbed
// environment, so the developer's own git config (signing, hooks, templates) cannot change the result.
export function createFixtureRepo(dir) {
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_SYSTEM: os.devNull,
    GIT_AUTHOR_NAME: 'Eval Author', GIT_AUTHOR_EMAIL: 'author@example.com',
    GIT_COMMITTER_NAME: 'Eval Author', GIT_COMMITTER_EMAIL: 'author@example.com',
  };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[k];
  const git = (...args) => {
    const r = spawnSync('git', ['-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${os.devNull}`, ...args], { cwd: dir, encoding: 'utf8', env });
    if (r.error) throw new Error(`git ${args.join(' ')} could not run: ${r.error.code ?? r.error.message}`);
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.trim()}${args[0] === 'init' ? ' (git 2.28 or newer is needed for init -b)' : ''}`);
  };
  const write = (rel, content) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  let day = 1;
  const commit = (message) => {
    const when = `2026-10-${String(day++).padStart(2, '0')}T12:00:00Z`;
    git('add', '-A');
    env.GIT_AUTHOR_DATE = when;
    env.GIT_COMMITTER_DATE = when;
    git('commit', '-q', '-m', message);
  };
  fs.mkdirSync(dir, { recursive: true });
  git('init', '-q', '-b', 'main');
  write('README.md', '# notes-app\n\nA small notes service.\n');
  write('src/notes.js', 'export const notes = [];\nexport const add = (text) => notes.push(text);\n');
  commit('chore: start the notes app');
  git('checkout', '-q', '-b', 'feat/search');
  write('src/search.js', 'import { notes } from "./notes.js";\nexport const search = (q) => notes.filter((n) => n.includes(q));\n');
  commit('feat: search notes by text');
  write('src/search.js', 'import { notes } from "./notes.js";\nexport const search = (q) => notes.filter((n) => n.toLowerCase().includes(q.toLowerCase()));\n');
  write('docs/search.md', 'Search is case-insensitive.\n');
  commit('fix: make search case-insensitive');
  write('test/search.test.js', 'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { search } from "../src/search.js";\ntest("empty store", () => assert.deepEqual(search("x"), []));\n');
  commit('test: cover search on an empty store');
}

const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'test']);

// Copy a skill into <work>/skills/<name> without node_modules, which is linked back to the original.
export function copySkill(src, work) {
  const dst = path.join(work, 'skills', path.basename(src));
  fs.cpSync(src, dst, {
    recursive: true,
    filter: (from) => !path.relative(src, from).split(path.sep).some((seg) => SKIP_DIRS.has(seg)),
  });
  // Deps not installed (CI runs these tests before npm ci): nothing to link; a real run fails later with npm's own error.
  if (fs.existsSync(path.join(src, 'node_modules'))) linkNodeModules(path.join(src, 'node_modules'), path.join(dst, 'node_modules'));
}

// A fresh work directory for one prompt: the skill and its sibling skills under skills/, the data fixtures
// under data/, ./repo for a `"repo": true` prompt, and the seed spec for an edit prompt.
// `skillsRoot` holds the skill folders, `evalDir` the fixtures. -> { work, seedSpec }.
export function prepareWorkdir(p, { skillCfg, skillsRoot, evalDir, tmpDir = os.tmpdir() }) {
  const work = fs.mkdtempSync(path.join(tmpDir, `pa-eval-${p.id}-`));
  for (const name of [skillCfg.dir, ...(skillCfg.siblings ?? [])]) copySkill(path.join(skillsRoot, name), work);
  if (p.repo) createFixtureRepo(path.join(work, 'repo'));
  fs.cpSync(path.join(evalDir, 'fixtures', 'data'), path.join(work, 'data'), { recursive: true });
  let seedSpec = null;
  if (p.seed) {
    const seedPath = path.join(evalDir, 'fixtures', p.seed);
    fs.copyFileSync(seedPath, path.join(work, skillCfg.spec));
    seedSpec = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  }
  return { work, seedSpec };
}

export function buildPrompt(skillCfg, task) {
  return [
    `Read skills/${skillCfg.dir}/SKILL.md and follow its workflow exactly.`,
    `The skill's scripts are in skills/${skillCfg.dir}/scripts/ and its dependencies are already installed.`,
    'Work only inside the current directory.',
    'Do not start serve.mjs or preview.mjs (they never exit); stop after validate and build/render.',
    `Task: ${task}`,
    `Save the spec as ./${skillCfg.spec}.`,
  ].join(' ');
}

// Substitute {prompt} {cwd} {model} in a host command template.
// One pass, function replacer: text inside the prompt is never re-substituted
// and `$&`-style patterns stay literal.
export function expandCmd(host, { prompt, cwd, model }) {
  const values = { prompt, cwd, model: model ?? '' };
  const sub = (s) => s.replace(/\{(prompt|cwd|model)\}/g, (_, k) => values[k]);
  const argv = host.cmd.map(sub);
  if (model && host.modelArgs) argv.push(...host.modelArgs.map(sub));
  return argv;
}

export function run(argv, { cwd, env, timeoutMs = 0, logFile } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    // detached = own process group, so a timeout also kills grandchildren
    // (renders, servers) the host started.
    // NODE_USE_SYSTEM_CA makes Node 24 read the macOS keychain at startup; the codex
    // sandbox denies that and every node process SIGSEGVs. The eval is offline.
    const { NODE_USE_SYSTEM_CA: _drop, ...baseEnv } = process.env;
    const child = spawn(argv[0], argv.slice(1), {
      cwd, env: { ...baseEnv, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    });
    let out = '';
    const onData = (d) => { out += d; };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    let timedOut = false;
    const killGroup = () => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    };
    const timer = timeoutMs > 0 ? setTimeout(() => { timedOut = true; killGroup(); }, timeoutMs) : null;
    const finish = (code) => {
      if (timer) clearTimeout(timer);
      if (logFile) fs.writeFileSync(logFile, out);
      resolve({ code, out, timedOut, seconds: (Date.now() - started) / 1000 });
    };
    child.on('error', (e) => { out += `\n[spawn error] ${e.message}`; finish(127); });
    child.on('close', (code) => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* group already gone */ }
      finish(code ?? 1);
    });
  });
}

// A workdir gets a REAL node_modules directory whose entries are symlinks to
// the source packages. Hosts sometimes run `npm ci` / delete node_modules; with
// a single symlinked node_modules that wiped the source checkout's deps. Here
// they can only delete the links.
export function linkNodeModules(srcNodeModules, dstNodeModules) {
  fs.mkdirSync(dstNodeModules, { recursive: true });
  for (const entry of fs.readdirSync(srcNodeModules)) {
    const from = path.join(srcNodeModules, entry);
    const to = path.join(dstNodeModules, entry);
    if (entry.startsWith('@') && fs.statSync(from).isDirectory()) {
      linkNodeModules(from, to); // scoped packages: link each package, not the scope
    } else {
      fs.symlinkSync(from, to);
    }
  }
}

export function countValidateRuns(logPath) {
  if (!fs.existsSync(logPath)) return 0;
  return fs.readFileSync(logPath, 'utf8').split('\n').filter((l) => l.trim()).length;
}

// Leaf-level JSON paths that differ between two values (for edit prompts:
// a targeted edit should change only a few paths).
export function diffPaths(a, b, base = '') {
  if (a === b) return [];
  const isObj = (v) => v && typeof v === 'object';
  if (!isObj(a) || !isObj(b) || Array.isArray(a) !== Array.isArray(b)) return [base || '(root)'];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out = [];
  for (const k of keys) {
    const p = Array.isArray(a) ? `${base}[${k}]` : base ? `${base}.${k}` : k;
    out.push(...diffPaths(a[k], b[k], p));
  }
  return out;
}

// Score one finished host run in `work`. The harness re-runs validate and the
// output step itself, so a host that couldn't run commands is still scored.
export async function scoreRun({ work, skillCfg, skillDir, seedSpec, outputTimeoutMs = 300000 }) {
  const specPath = path.join(work, skillCfg.spec);
  const score = {
    specExists: fs.existsSync(specPath),
    validateRuns: countValidateRuns(path.join(work, '.eval-log.jsonl')),
    finalValid: false,
    errors: [],
    outputOk: false,
    changedPaths: null,
  };
  if (!score.specExists) return score;
  const env = { EVAL_LOG: '' };
  const v = await run(['node', path.join(skillDir, 'scripts/validate.mjs'), specPath, '--json'], { cwd: work, env });
  try {
    const parsed = JSON.parse(v.out.trim().split('\n').pop());
    score.finalValid = parsed.ok === true;
    score.errors = parsed.errors ?? [];
  } catch {
    score.errors = [{ path: '(validate)', message: v.out.slice(0, 500) }];
  }
  if (seedSpec) {
    try { score.changedPaths = diffPaths(seedSpec, JSON.parse(fs.readFileSync(specPath, 'utf8'))); } catch { /* invalid JSON already scored */ }
    // An untouched seed validates trivially; for an edit prompt that is a miss.
    if (score.changedPaths?.length === 0) {
      score.finalValid = false;
      score.errors = [{ path: '(edit)', message: 'spec unchanged from the seed: the requested edit was not made' }];
    }
  }
  if (!score.finalValid) return score;
  const o = await run(['node', ...skillCfg.outputCmd(skillDir, specPath, work)], {
    cwd: work, env, timeoutMs: outputTimeoutMs, logFile: path.join(work, 'output.log'),
  });
  score.outputOk = o.code === 0 && skillCfg.artifacts.every((a) => {
    const p = path.join(work, a);
    if (!fs.existsSync(p)) return false;
    return fs.statSync(p).isDirectory() ? fs.readdirSync(p, { recursive: true }).some((f) => String(f).endsWith('.png')) : true;
  });
  return score;
}

export function summarize(rows, { host, skill, model }) {
  const n = rows.length;
  const pct = (k) => `${rows.filter((r) => r[k]).length}/${n}`;
  const lines = [
    `# Eval — ${skill} on ${host}${model ? ` (${model})` : ''}`,
    '',
    `Spec written ${pct('specExists')} · valid ${pct('finalValid')} · output ok ${pct('outputOk')}`,
    '',
    '| id | spec | valid | validate runs | output | seconds | notes |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    const notes = [
      r.timedOut ? 'timed out' : '',
      r.errors?.length ? `${r.errors.length} errors: ${r.errors[0].path}: ${r.errors[0].message}` : '',
      r.changedPaths ? `changed: ${r.changedPaths.join(', ')}` : '',
    ].filter(Boolean).join('; ').replaceAll('|', '\\|');
    const b = (x) => (x ? '✓' : '✗');
    lines.push(`| ${r.id} | ${b(r.specExists)} | ${b(r.finalValid)} | ${r.validateRuns} | ${b(r.outputOk)} | ${r.seconds.toFixed(0)} | ${notes} |`);
  }
  return `${lines.join('\n')}\n`;
}

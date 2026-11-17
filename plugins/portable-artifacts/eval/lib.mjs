// Pure-ish helpers for the cross-host eval runner. Kept separate from the CLI
// so scoring can be tested with a fake host and no LLM.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { agentFile } from '../shared/agents.mjs';
import { SESSION_HEADERS, sessionCells, sessionNotes, sessionTotals, sessionSetup } from './session-columns.mjs';

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
    // Visual check on the spec once the contact sheet built; prints {"ok":true,"skipped":true} without a browser.
    // checkCmd(skill, spec, work): motion's check reads the spec, the other three read the page the build wrote.
    checkCmd: (skill, spec) => [path.join(skill, 'scripts/check.mjs'), spec, '--json'],
  },
  diagram: {
    dir: 'make-diagram',
    spec: 'diagram.json',
    // Build into <work>/out; success = out/diagram.html exists.
    outputCmd: (skill, spec, work) => [path.join(skill, 'scripts/build.mjs'), spec, '--out', path.join(work, 'out/diagram.html')],
    artifacts: ['out/diagram.html'],
    checkCmd: (skill, spec, work) => [path.join(skill, 'scripts/check.mjs'), path.join(work, 'out/diagram.html'), '--json'],
  },
  explainer: {
    dir: 'make-explainer',
    spec: 'explainer.json',
    // Sibling skills are copied next to it: make-explainer resolves them as ../<name> and loads them lazily.
    // make-motion is left out on purpose: motion sections need ffmpeg and Chromium, and no prompt asks for one.
    // scene is left out too: a scene section needs the page's WebGL and no prompt asks for one.
    siblings: ['make-diagram', 'make-dashboard'],
    // Build into <work>/out; success = out/explainer.html exists.
    outputCmd: (skill, spec, work) => [path.join(skill, 'scripts/build.mjs'), spec, '--out', path.join(work, 'out/explainer.html')],
    artifacts: ['out/explainer.html'],
    checkCmd: (skill, spec, work) => [path.join(skill, 'scripts/check.mjs'), path.join(work, 'out/explainer.html'), '--json'],
  },
  scene: {
    dir: 'make-scene',
    spec: 'scene.json',
    // A lift loads make-diagram or make-dashboard, resolved as ../<name> beside the skill.
    siblings: ['make-diagram', 'make-dashboard'],
    // Build into <work>/out; success = out/scene.html exists.
    outputCmd: (skill, spec, work) => [path.join(skill, 'scripts/build.mjs'), spec, '--out', path.join(work, 'out/scene.html')],
    artifacts: ['out/scene.html'],
    checkCmd: (skill, spec, work) => [path.join(skill, 'scripts/check.mjs'), path.join(work, 'out/scene.html'), '--json'],
  },
};

// Skills a local model (a host marked `local` in hosts.json) is not run on without --allow-local-models: gemma4
// through Ollama often ended its turn before it wrote the spec on these two (see results/INDEX.md), and each such
// run waits out the whole timeout.
export const LOCAL_MODEL_GATED_SKILLS = Object.freeze(['motion', 'explainer']);

const DAY_MS = 24 * 60 * 60 * 1000;
const FIXTURE_COMMITS = 4;

// A prompt with `"repo": true` gets a small git repository at <work>/repo: `main`, then the branch
// feat/search with three commits (one adds a test file). Git runs with argument arrays and a scrubbed
// environment, so the developer's own git config (signing, hooks, templates) cannot change the result.
// The commits are dated one day apart ending at `now` (default: the clock), so they always sit inside a
// "last N weeks" window such as make-scene's rows.mjs default of 12.
export function createFixtureRepo(dir, { now = Date.now() } = {}) {
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
    const when = new Date(now - (FIXTURE_COMMITS - day++) * DAY_MS).toISOString().replace(/\.\d{3}Z$/, 'Z');
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
// `skillsRoot` holds the skill folders, `evalDir` the fixtures. A host with `agentFile` (claude-director) also gets
// that host's builder agent file at <work>/.claude/agents/, so the session can delegate to it. -> { work, seedSpec }.
export function prepareWorkdir(p, { skillCfg, skillsRoot, evalDir, tmpDir = os.tmpdir(), host }) {
  const work = fs.mkdtempSync(path.join(tmpDir, `pa-eval-${p.id}-`));
  for (const name of [skillCfg.dir, ...(skillCfg.siblings ?? [])]) copySkill(path.join(skillsRoot, name), work);
  if (host?.agentFile) {
    const { fileName, content } = agentFile(host.agentFile);
    fs.mkdirSync(path.join(work, '.claude', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(work, '.claude', 'agents', fileName), content);
  }
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

// The prompts to run: prompts/<skill>.json, or with `set` prompts/<skill>-<set>.json. The set is looked up
// among the files that exist and never joined into a path. Throws `unknown --set "x"; available for <skill>: a, b`.
export function loadPrompts(promptsDir, skill, set) {
  if (set === undefined) return JSON.parse(fs.readFileSync(path.join(promptsDir, `${skill}.json`), 'utf8'));
  const prefix = `${skill}-`;
  const sets = fs.readdirSync(promptsDir)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
    .map((f) => f.slice(prefix.length, -'.json'.length))
    .sort();
  if (!sets.includes(set)) throw new Error(`unknown --set "${set}"; available for ${skill}: ${sets.join(', ') || '(none)'}`);
  return JSON.parse(fs.readFileSync(path.join(promptsDir, `${skill}-${set}.json`), 'utf8'));
}

// A host with `agentFile` runs the director and operator hand-off, so "stop after validate and build/render" (which
// steers a host around make.mjs and the agent) becomes "follow the Director and operator section". Every other host's
// prompt is unchanged, so committed summaries stay comparable.
export function buildPrompt(skillCfg, task, host) {
  const stop = host?.agentFile
    ? "follow the skill's Director and operator section; stop when the build is done."
    : 'stop after validate and build/render.';
  return [
    `Read skills/${skillCfg.dir}/SKILL.md and follow its workflow exactly.`,
    `The skill's scripts are in skills/${skillCfg.dir}/scripts/ and its dependencies are already installed.`,
    'Work only inside the current directory.',
    `Do not start serve.mjs or preview.mjs (they never exit); ${stop}`,
    `Task: ${task}`,
    `Save the spec as ./${skillCfg.spec}.`,
  ].join(' ');
}

// Substitute {prompt} {cwd} {model} {agent} {budget} in a host command template.
// One pass, function replacer: text inside the prompt is never re-substituted
// and `$&`-style patterns stay literal. agentArgs is appended only when an agent
// is named, budgetArgs only when a budget is (run-eval.mjs rejects --agent and
// --budget for a host that has none).
export function expandCmd(host, { prompt, cwd, model, agent, budget }) {
  const values = { prompt, cwd, model: model ?? '', agent: agent ?? '', budget: budget ?? '' };
  const sub = (s) => s.replace(/\{(prompt|cwd|model|agent|budget)\}/g, (_, k) => values[k]);
  const argv = host.cmd.map(sub);
  if (model && host.modelArgs) argv.push(...host.modelArgs.map(sub));
  if (agent && host.agentArgs) argv.push(...host.agentArgs.map(sub));
  if (budget && host.budgetArgs) argv.push(...host.budgetArgs.map(sub));
  return argv;
}

// The model the agent wrote into its saved spec (generatedBy.model). Every skill's SKILL.md asks for it,
// so this works for all five skills, motion included. The text is untrusted, so whitespace (newlines
// included) collapses to single spaces and the value is capped at MAX_MODEL_CHARS: one table row per case.
// '-' when absent, blank after cleaning, or the file is not JSON. The harness's own rebuilt page is not
// a source: it is built from this spec without --model, so it never carries more than the spec does.
const MAX_MODEL_CHARS = 80;
export function readSpecModel(specPath) {
  try {
    const model = JSON.parse(fs.readFileSync(specPath, 'utf8'))?.generatedBy?.model;
    if (typeof model !== 'string') return '-';
    const clean = model.replace(/\s+/g, ' ').trim();
    if (!clean) return '-';
    return clean.length > MAX_MODEL_CHARS ? `${clean.slice(0, MAX_MODEL_CHARS - 1)}…` : clean;
  } catch {
    return '-';
  }
}

// `abortIf: { afterMs, done }`: at afterMs, if done() is still false the host's whole process group is killed and
// the result says `aborted: true` (run-eval uses it to stop a local model that has written no spec and run no
// validate by then, instead of waiting out the full timeout).
export function run(argv, { cwd, env, timeoutMs = 0, logFile, abortIf } = {}) {
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
    let aborted = false;
    const timer = timeoutMs > 0 ? setTimeout(() => { timedOut = true; killGroup(); }, timeoutMs) : null;
    const abortTimer = abortIf ? setTimeout(() => { if (!abortIf.done()) { aborted = true; killGroup(); } }, abortIf.afterMs) : null;
    const finish = (code) => {
      if (timer) clearTimeout(timer);
      if (abortTimer) clearTimeout(abortTimer);
      if (logFile) fs.writeFileSync(logFile, out);
      resolve({ code, out, timedOut, aborted, seconds: (Date.now() - started) / 1000 });
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

// make.mjs adds its own `{ command: "make", ... }` line to the same log (and its validate stage adds the validate line),
// so a make line is never a validate call.
const isMakeLine = (line) => {
  try { return JSON.parse(line)?.command === 'make'; } catch { return false; }
};

export function countValidateRuns(logPath) {
  if (!fs.existsSync(logPath)) return 0;
  return fs.readFileSync(logPath, 'utf8').split('\n').filter((l) => l.trim() && !isMakeLine(l)).length;
}

// One record per validate call the host made, from $EVAL_LOG ({ ts, ok, errors } per line; a writer may add
// `messages`, strings or { path, message }). A line that is not JSON is skipped; a JSON line with odd fields
// becomes a record of nulls. The log is written by the host's own commands, so every field is untrusted:
// messages are capped in number and length.
const MAX_LOG_MESSAGES = 20;
const MAX_LOG_MESSAGE_CHARS = 300;
export function readValidateLog(logPath) {
  if (!fs.existsSync(logPath)) return [];
  const records = [];
  for (const line of fs.readFileSync(logPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let parsed;
    try { parsed = JSON.parse(line); } catch { continue; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
    if (parsed.command === 'make') continue;
    records.push({
      ts: typeof parsed.ts === 'string' ? parsed.ts : null,
      ok: typeof parsed.ok === 'boolean' ? parsed.ok : null,
      errors: Number.isInteger(parsed.errors) ? parsed.errors : null,
      messages: logMessages(parsed.messages),
    });
  }
  return records;
}

function logMessages(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_LOG_MESSAGES).map((m) => {
    if (typeof m === 'string') return m;
    if (m && typeof m.message === 'string') return m.path ? `${m.path}: ${m.message}` : m.message;
    return '';
  }).filter(Boolean).map((m) => m.replace(/\s+/g, ' ').slice(0, MAX_LOG_MESSAGE_CHARS));
}

// An expectation names a spec feature the prompt asked for: `key` (an object anywhere in the spec has that own key),
// `key=value` (…and its value is that string, number or boolean, whole), `key^=prefix` (a string value starting so).
export function parseExpect(token) {
  const m = typeof token === 'string' ? /^([^=^]+)(?:(\^?=)(.+))?$/.exec(token) : null;
  if (!m) throw new Error(`expect: "${String(token)}" is not key, key=value or key^=prefix`);
  if (m[2] === undefined) return { key: m[1], op: 'has' };
  return { key: m[1], op: m[2] === '=' ? 'eq' : 'prefix', value: m[3] };
}

function matches(node, { key, op, value }) {
  if (!Object.hasOwn(node, key)) return false;
  if (op === 'has') return true;
  const v = node[key];
  if (!['string', 'number', 'boolean'].includes(typeof v)) return false;
  return op === 'eq' ? String(v) === value : typeof v === 'string' && v.startsWith(value);
}

function anywhere(node, expectation) {
  if (Array.isArray(node)) return node.some((child) => anywhere(child, expectation));
  if (!node || typeof node !== 'object') return false;
  return matches(node, expectation) || Object.values(node).some((child) => anywhere(child, expectation));
}

// A token may list alternatives with `|` (`transition=push|type=push`): the spec may say a thing in more than one
// way (a transition is a bare name or an object with a `type`), and any one counts.
export const parseAlternatives = (token) => String(token).split('|').map(parseExpect);

// Did the spec use what the prompt asked for? -> { ok, missing: [tokens not found] }. Valid-and-builds says
// nothing about that: an item prompt passes today with its feature ignored.
export function featureUsed(spec, expect = []) {
  const missing = expect.filter((token) => !parseAlternatives(token).some((alt) => anywhere(spec, alt)));
  return { ok: missing.length === 0, missing };
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
// `expect`: spec features the prompt asked for (see featureUsed); `maxChanged`: for an edit prompt, the most leaf
// paths a targeted edit should change (editOk says whether it stayed inside).
export async function scoreRun({ work, skillCfg, skillDir, seedSpec, expect = [], maxChanged, outputTimeoutMs = 300000 }) {
  const specPath = path.join(work, skillCfg.spec);
  const logPath = path.join(work, '.eval-log.jsonl');
  const attempts = readValidateLog(logPath);
  const score = {
    specExists: fs.existsSync(specPath),
    validateRuns: countValidateRuns(logPath),
    validateAttempts: attempts, // one { ts, ok, errors, messages } per validate call the host made
    firstTryValid: attempts.length === 0 ? null : attempts[0].ok, // null: never validated (not the same as first-call-valid)
    finalValid: false,
    errors: [],
    outputOk: false,
    checkOk: null, // the skill's check: true/false, null when it has none, skipped, or the output step failed
    featureOk: null, // the spec used what the prompt asked for: true/false, null when the prompt names nothing or there is no spec
    missingFeatures: [],
    changedPaths: null,
    editOk: null, // an edit prompt with a path limit: the edit stayed inside it (true) or looks like a rewrite (false); never changes `valid`
    model: '-', // generatedBy.model the agent self-reported in its saved spec; '-' if none
  };
  if (!score.specExists) return score;
  score.model = readSpecModel(specPath);
  if (expect.length > 0) {
    let spec = null;
    try { spec = JSON.parse(fs.readFileSync(specPath, 'utf8')); } catch { /* not JSON: every feature is missing */ }
    const used = featureUsed(spec, expect);
    score.featureOk = used.ok;
    score.missingFeatures = used.missing;
  }
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
    } else if (Number.isInteger(maxChanged) && score.changedPaths) {
      // Reported, never scored as invalid: diffPaths is index-based, so one node inserted mid-array shifts every later
      // leaf, and summaries from before this field must stay comparable.
      score.editOk = score.changedPaths.length <= maxChanged;
      score.editLimit = maxChanged;
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
  if (score.outputOk && skillCfg.checkCmd) {
    const c = await run(['node', ...skillCfg.checkCmd(skillDir, specPath, work)], {
      cwd: work, env, timeoutMs: outputTimeoutMs, logFile: path.join(work, 'check.log'),
    });
    score.checkOk = readCheckResult(c);
  }
  return score;
}

// The result line of a check run: the last output line that parses to an object with a boolean `ok` (stderr
// shares the stream, so it need not be the last line). null when the check skipped (no browser), false when it
// failed, timed out, exited non-zero or printed no result.
function readCheckResult({ out, code, timedOut }) {
  if (timedOut) return false;
  for (const line of out.trim().split('\n').reverse()) {
    let parsed;
    try { parsed = JSON.parse(line); } catch { continue; }
    if (typeof parsed?.ok !== 'boolean') continue;
    if (parsed.skipped === true) return null;
    return parsed.ok && code === 0;
  }
  return false;
}

export function summarize(rows, { host, skill, model, agent }) {
  const n = rows.length;
  const pct = (k) => `${rows.filter((r) => r[k]).length}/${n}`;
  const checkedRows = rows.filter((r) => r.checkOk === true || r.checkOk === false); // a skipped or unrun check is not a miss
  const featureRows = rows.filter((r) => r.featureOk === true || r.featureOk === false); // a prompt that names no feature is not a miss
  // Rows from a host that streams its session (claude-director) carry `session`: five more columns, a totals line and a
  // setup line. Other hosts' summaries keep their old shape, so committed ones stay comparable.
  const sessions = rows.filter((r) => r.session).map((r) => r.session);
  const lines = [
    `# Eval — ${skill} on ${host}${model ? ` (${model})` : ''}${agent ? ` as agent ${agent}` : ''}`,
    '',
    `Spec written ${pct('specExists')} · valid ${pct('finalValid')} · output ok ${pct('outputOk')}${checkedRows.length ? ` · check ok ${checkedRows.filter((r) => r.checkOk).length}/${checkedRows.length}` : ''}${featureRows.length ? ` · feature used ${featureRows.filter((r) => r.featureOk).length}/${featureRows.length}` : ''}`,
    '',
    ...(sessions.length ? [sessionTotals(sessions), '', sessionSetup(sessions), ''] : []),
    `| id | spec | valid | validate runs | output | seconds | model reported${sessions.length ? ' (self-reported)' : ''} | notes | check | feature | first try |${sessions.length ? ` ${SESSION_HEADERS.join(' | ')} |` : ''}`,
    `|---|---|---|---|---|---|---|---|---|---|---|${sessions.length ? '---|'.repeat(SESSION_HEADERS.length) : ''}`,
  ];
  const tri = (x) => (x === true ? '✓' : x === false ? '✗' : '-');
  for (const r of rows) {
    const notes = [
      r.timedOut ? 'timed out' : '',
      r.aborted ? 'aborted: no spec and no validate by the deadline' : '',
      r.errors?.length ? `${r.errors.length} errors: ${r.errors[0].path}: ${r.errors[0].message}` : '',
      r.changedPaths ? `changed: ${r.changedPaths.join(', ')}` : '',
      r.editOk === false ? `edit too broad: ${r.changedPaths.length} paths changed, limit ${r.editLimit}` : '',
      r.missingFeatures?.length ? `missing feature: ${r.missingFeatures.join(', ')}` : '',
      ...(r.session ? sessionNotes(r.session) : []),
    ].filter(Boolean).join('; ').replaceAll('|', '\\|');
    const b = (x) => (x ? '✓' : '✗');
    const extra = r.session ? ` ${sessionCells(r.session).join(' | ')} |` : '';
    lines.push(`| ${r.id} | ${b(r.specExists)} | ${b(r.finalValid)} | ${r.validateRuns} | ${b(r.outputOk)} | ${r.seconds.toFixed(0)} | ${String(r.model ?? '-').replaceAll('|', '\\|')} | ${notes} | ${tri(r.checkOk)} | ${tri(r.featureOk)} | ${tri(r.firstTryValid)} |${extra}`);
  }
  return `${lines.join('\n')}\n`;
}

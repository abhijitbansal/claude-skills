#!/usr/bin/env node
// Cross-host eval: run each prompt through an agent host in a fresh temp
// workdir, then score the result (spec written, valid, validate retries,
// build/contact-sheet ok, time). See eval/README.md.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { SKILLS, LOCAL_MODEL_GATED_SKILLS, buildPrompt, expandCmd, loadPrompts, run, scoreRun, summarize, prepareWorkdir } from './lib.mjs';
import { readSession } from './session.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
let opts;
try {
  ({ values: opts } = parseArgs({
  options: {
    skill: { type: 'string' },
    host: { type: 'string' },
    model: { type: 'string' },
    agent: { type: 'string' },
    budget: { type: 'string' },
    set: { type: 'string' },
    limit: { type: 'string' },
    only: { type: 'string' },
    timeout: { type: 'string', default: '600' },
    out: { type: 'string' },
    'allow-local-models': { type: 'boolean', default: false },
    'abort-no-spec': { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
  }));
} catch (e) {
  usage(e.message);
}

function usageText() {
  return `usage: node eval/run-eval.mjs --skill ${Object.keys(SKILLS).join('|')} --host <${Object.keys(JSON.parse(fs.readFileSync(path.join(here, 'hosts.json'), 'utf8'))).join('|')}> [--model m] [--agent name] [--budget usd] [--set name] [--limit n] [--only id,id] [--timeout sec] [--abort-no-spec sec] [--allow-local-models] [--out dir] [--help]\n`;
}

function usage(msg) {
  process.stderr.write(`${msg}\n${usageText()}`);
  process.exit(2);
}

if (opts.help) {
  process.stdout.write(usageText());
  process.exit(0);
}

const skillCfg = SKILLS[opts.skill];
if (!skillCfg) usage(`unknown --skill ${opts.skill ?? ''}`);
const hosts = JSON.parse(fs.readFileSync(path.join(here, 'hosts.json'), 'utf8'));
const host = hosts[opts.host];
if (!host) usage(`unknown --host ${opts.host ?? ''}`);
if (opts.agent !== undefined) {
  if (opts.agent === '') usage('--agent needs a name');
  if (!host.agentArgs) usage(`host "${opts.host}" has no agentArgs`);
}
// --budget is the per-case spend cap of a billed host that has budgetArgs: refused where it would be ignored, required where
// a case would otherwise run uncapped.
if (opts.budget !== undefined && !host.budgetArgs) usage(`host "${opts.host}" has no budgetArgs, so --budget would be ignored`);
if (opts.budget === undefined && host.budgetArgs) usage(`host "${opts.host}" is billed per prompt and needs --budget <usd>`);
if (opts.budget !== undefined && !(Number.isFinite(Number(opts.budget)) && Number(opts.budget) > 0)) {
  usage(`--budget must be a positive number of dollars, got "${opts.budget}"`);
}
// A host without modelArgs runs whatever model its own settings pick (claude-frontmatter: the SKILL.md frontmatter), so a --model would be ignored.
if (opts.model !== undefined && !host.modelArgs) usage(`host "${opts.host}" has no modelArgs, so --model would be ignored; leave it out`);
if (host.local && LOCAL_MODEL_GATED_SKILLS.includes(opts.skill) && !opts['allow-local-models']) {
  usage(`${opts.skill} is not run on a local model by default (host "${opts.host}"): local models often end their turn before writing the spec on ${LOCAL_MODEL_GATED_SKILLS.join(' and ')}, and each such run waits out the timeout; see eval/results/INDEX.md. Pass --allow-local-models to run it anyway`);
}
// Seconds with no spec file and no validate call before a run is cut short: --abort-no-spec, else the host's abortNoSpecSec; 0 turns it off.
const abortNoSpecSec = opts['abort-no-spec'] === undefined ? (host.abortNoSpecSec ?? 0) : Number(opts['abort-no-spec']);
if (!Number.isInteger(abortNoSpecSec) || abortNoSpecSec < 0 || opts['abort-no-spec'] === '') usage(`--abort-no-spec must be a whole number of seconds (0 turns it off), got "${opts['abort-no-spec']}"`);

// --set picks prompts/<skill>-<set>.json (no flag: prompts/<skill>.json); an unknown set is a usage error before any host runs.
let prompts;
try {
  prompts = loadPrompts(path.join(here, 'prompts'), opts.skill, opts.set);
} catch (e) {
  usage(e.message);
}

const check = await run(host.check);
if (check.code !== 0) {
  process.stderr.write(`host "${opts.host}" not available (${host.check.join(' ')} failed)\n`);
  process.exit(2);
}

const skillSrc = path.resolve(here, '../skills', skillCfg.dir);
const siblingDirs = (skillCfg.siblings ?? []).map((name) => path.resolve(here, '../skills', name));
for (const src of [skillSrc, ...siblingDirs]) {
  if (!fs.existsSync(path.join(src, 'node_modules'))) {
    process.stderr.write(`run "npm ci" in ${src} first\n`);
    process.exit(2);
  }
}

if (opts.only) {
  const ids = opts.only.split(',');
  const unknown = ids.filter((id) => !prompts.some((p) => p.id === id));
  if (unknown.length) usage(`unknown --only id(s): ${unknown.join(', ')}; available: ${prompts.map((p) => p.id).join(', ')}`);
  prompts = prompts.filter((p) => ids.includes(p.id));
}
if (opts.limit !== undefined) {
  const n = Number(opts.limit);
  if (!Number.isInteger(n) || n < 1) usage(`--limit must be a positive integer, got "${opts.limit}"`);
  prompts = prompts.slice(0, n);
}
for (const k of ['timeout']) {
  if (!(Number(opts[k]) > 0)) usage(`--${k} must be a positive number of seconds, got "${opts[k]}"`);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const resultsDir = path.resolve(opts.out ?? path.join(here, 'results', stamp), `${opts.host}-${opts.skill}`);
fs.mkdirSync(resultsDir, { recursive: true });

const rows = [];
for (const p of prompts) {
  const { work, seedSpec } = prepareWorkdir(p, { skillCfg, skillsRoot: path.resolve(here, '../skills'), evalDir: here, host });
  const prompt = buildPrompt(skillCfg, p.prompt, host);
  const argv = expandCmd(host, { prompt, cwd: work, model: opts.model, agent: opts.agent, budget: opts.budget });
  process.stdout.write(`▶ ${p.id} (${work})\n`);
  const caseDir = path.join(resultsDir, p.id);
  fs.mkdirSync(caseDir, { recursive: true });
  const evalLog = path.join(work, '.eval-log.jsonl');
  const specFile = path.join(work, skillCfg.spec);
  // Progress = a validate call, or a spec the host wrote (for an edit prompt: one that differs from the seed it started with).
  const seedText = p.seed ? fs.readFileSync(specFile, 'utf8') : null;
  const madeProgress = () => fs.existsSync(evalLog) || (fs.existsSync(specFile) && (seedText === null || fs.readFileSync(specFile, 'utf8') !== seedText));
  const r = await run(argv, {
    cwd: work,
    env: { EVAL_LOG: evalLog, PA_OUTPUT_DIR: path.join(work, 'out') }, // PA_OUTPUT_DIR keeps the default output inside the workdir
    timeoutMs: Number(opts.timeout) * 1000,
    logFile: path.join(caseDir, 'transcript.txt'),
    abortIf: abortNoSpecSec > 0 ? { afterMs: abortNoSpecSec * 1000, done: madeProgress } : undefined,
  });
  const score = await scoreRun({ work, skillCfg, skillDir: path.join(work, 'skills', skillCfg.dir), seedSpec, expect: p.expect, maxChanged: p.maxChanged });
  // A host that streams its session (agentFile) is read for evidence of a delegation; the transcript is the stream.
  const session = host.agentFile ? readSession(path.join(caseDir, 'transcript.txt'), { specName: skillCfg.spec }) : null;
  const row = { id: p.id, hostExit: r.code, timedOut: r.timedOut, aborted: r.aborted, seconds: r.seconds, ...score, ...(session ? { session } : {}) };
  rows.push(row);
  // .eval-log.jsonl is every validate call the host made, in order: kept so a retry loop can be read back, not just counted.
  for (const f of [skillCfg.spec, 'output.log', 'check.log', '.eval-log.jsonl', ...skillCfg.artifacts]) {
    const src = path.join(work, f);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(caseDir, path.basename(f)), { recursive: true });
  }
  fs.rmSync(work, { recursive: true, force: true }); // artifacts already copied; rmSync does not follow the node_modules symlink
  const tri = (x) => (x === null ? '-' : x ? '✓' : '✗');
  process.stdout.write(`  spec ${row.specExists ? '✓' : '✗'}  valid ${row.finalValid ? '✓' : '✗'}  runs ${row.validateRuns}  output ${row.outputOk ? '✓' : '✗'}  check ${tri(row.checkOk)}  feature ${tri(row.featureOk)}  ${row.seconds.toFixed(0)}s  model ${row.model}${row.aborted ? '  (aborted: no spec)' : ''}${session ? `  delegated ${session.readable ? (session.delegated ? '✓' : 'no (director ran it)') : 'unreadable'}` : ''}\n`);
}

fs.writeFileSync(path.join(resultsDir, 'results.json'), `${JSON.stringify({ host: opts.host, skill: opts.skill, model: opts.model ?? null, agent: opts.agent ?? null, budget: opts.budget ?? null, rows }, null, 2)}\n`);
const summary = summarize(rows, { host: opts.host, skill: opts.skill, model: opts.model, agent: opts.agent });
fs.writeFileSync(path.join(resultsDir, 'summary.md'), summary);
process.stdout.write(`\n${summary}\nresults: ${resultsDir}\n`);

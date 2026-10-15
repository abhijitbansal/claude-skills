#!/usr/bin/env node
// Cross-host eval: run each prompt through an agent host in a fresh temp
// workdir, then score the result (spec written, valid, validate retries,
// build/contact-sheet ok, time). See eval/README.md.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { SKILLS, buildPrompt, expandCmd, run, scoreRun, summarize, prepareWorkdir } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: opts } = parseArgs({
  options: {
    skill: { type: 'string' },
    host: { type: 'string' },
    model: { type: 'string' },
    limit: { type: 'string' },
    only: { type: 'string' },
    timeout: { type: 'string', default: '600' },
    out: { type: 'string' },
  },
});

function usage(msg) {
  process.stderr.write(`${msg}\nusage: node eval/run-eval.mjs --skill ${Object.keys(SKILLS).join('|')} --host <${Object.keys(JSON.parse(fs.readFileSync(path.join(here, 'hosts.json'), 'utf8'))).join('|')}> [--model m] [--limit n] [--only id,id] [--timeout sec] [--out dir]\n`);
  process.exit(2);
}

const skillCfg = SKILLS[opts.skill];
if (!skillCfg) usage(`unknown --skill ${opts.skill ?? ''}`);
const hosts = JSON.parse(fs.readFileSync(path.join(here, 'hosts.json'), 'utf8'));
const host = hosts[opts.host];
if (!host) usage(`unknown --host ${opts.host ?? ''}`);

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

let prompts = JSON.parse(fs.readFileSync(path.join(here, 'prompts', `${opts.skill}.json`), 'utf8'));
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
  const { work, seedSpec } = prepareWorkdir(p, { skillCfg, skillsRoot: path.resolve(here, '../skills'), evalDir: here });
  const prompt = buildPrompt(skillCfg, p.prompt);
  const argv = expandCmd(host, { prompt, cwd: work, model: opts.model });
  process.stdout.write(`▶ ${p.id} (${work})\n`);
  const caseDir = path.join(resultsDir, p.id);
  fs.mkdirSync(caseDir, { recursive: true });
  const r = await run(argv, {
    cwd: work,
    env: { EVAL_LOG: path.join(work, '.eval-log.jsonl'), PA_OUTPUT_DIR: path.join(work, 'out') }, // PA_OUTPUT_DIR keeps make-diagram's default output inside the workdir
    timeoutMs: Number(opts.timeout) * 1000,
    logFile: path.join(caseDir, 'transcript.txt'),
  });
  const score = await scoreRun({ work, skillCfg, skillDir: path.join(work, 'skills', skillCfg.dir), seedSpec });
  const row = { id: p.id, hostExit: r.code, timedOut: r.timedOut, seconds: r.seconds, ...score };
  rows.push(row);
  for (const f of [skillCfg.spec, 'output.log', ...skillCfg.artifacts]) {
    const src = path.join(work, f);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(caseDir, path.basename(f)), { recursive: true });
  }
  fs.rmSync(work, { recursive: true, force: true }); // artifacts already copied; rmSync does not follow the node_modules symlink
  process.stdout.write(`  spec ${row.specExists ? '✓' : '✗'}  valid ${row.finalValid ? '✓' : '✗'}  runs ${row.validateRuns}  output ${row.outputOk ? '✓' : '✗'}  ${row.seconds.toFixed(0)}s\n`);
}

fs.writeFileSync(path.join(resultsDir, 'results.json'), `${JSON.stringify({ host: opts.host, skill: opts.skill, model: opts.model ?? null, rows }, null, 2)}\n`);
const summary = summarize(rows, { host: opts.host, skill: opts.skill, model: opts.model });
fs.writeFileSync(path.join(resultsDir, 'summary.md'), summary);
process.stdout.write(`\n${summary}\nresults: ${resultsDir}\n`);

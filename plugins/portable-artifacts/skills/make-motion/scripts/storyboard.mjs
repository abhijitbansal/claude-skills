#!/usr/bin/env node
// node scripts/storyboard.mjs <brief.json> --out plan.json [--non-interactive]
// For a clip over 20 s: writes a make-explainer `plan` page spec (the storyboard the user answers before the motion spec
// is written) and prints its path, then the command that builds it. Brief: { "title", "seconds", "scenes": [{ "id",
// "beat", "seconds" }], "theme"? }. Skips, with ONE stdout line `storyboard: skipped (<reason>)`, no file and exit 0, when
// the clip is 20 s or less, make-explainer is not beside this skill, or --non-interactive is passed. A script cannot tell
// an interactive session from `claude -p`, so the agent declares it. Exit 1: the brief breaks a rule (problems on stderr);
// exit 2: a usage or IO problem.
import { closeSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError, parseCli, exitUsage } from '../shared/cli.mjs';
import { checkBrief, storyboardDecision, storyboardPlan } from './lib/storyboard.mjs';

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ACCEPTED = '--out <file>, --non-interactive';
const USAGE = 'node scripts/storyboard.mjs <brief.json> --out plan.json [--non-interactive]';
const OPTIONS = { out: { type: 'string' }, 'non-interactive': { type: 'boolean' } };
const MAX_BRIEF_BYTES = 1024 * 1024;

function parseArgs(argv) {
  let parsed;
  try {
    parsed = parseCli(argv, OPTIONS, USAGE);
  } catch (e) {
    throw new UsageError(`${e.message} (accepted options: ${ACCEPTED})`);
  }
  const { values, positionals } = parsed;
  if (positionals.length !== 1) throw new UsageError(`expected one brief file, got ${positionals.length}; usage: ${USAGE}`);
  if (values.out === undefined || values.out === '') throw new UsageError(`--out <file> is required: where to write the plan; usage: ${USAGE}`);
  return { brief: positionals[0], out: values.out, nonInteractive: values['non-interactive'] === true };
}

function readBrief(file) {
  let text;
  try {
    if (statSync(file).size > MAX_BRIEF_BYTES) throw new UsageError(`${file} is over ${MAX_BRIEF_BYTES} bytes; a brief is a few lines per scene`);
    text = readFileSync(file, 'utf8');
  } catch (e) {
    if (e instanceof UsageError) throw e;
    throw new UsageError(`cannot read ${file}: ${e.code ?? e.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new UsageError(`${file} is not valid JSON: ${e.message}`);
  }
}

// The output may not be the brief itself (a mistyped --out would destroy the input).
function sameFile(a, b) {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

// The plan appears whole or not at all: written beside the target, then renamed onto it.
function writePlan(out, plan) {
  mkdirSync(path.dirname(out), { recursive: true });
  const partial = path.join(path.dirname(out), `.${path.basename(out)}.${process.pid}.partial`);
  rmSync(partial, { force: true });
  closeSync(openSync(partial, 'wx'));
  try {
    writeFileSync(partial, `${JSON.stringify(plan, null, 2)}\n`);
    renameSync(partial, out);
  } finally {
    rmSync(partial, { force: true });
  }
}

export function main(argv) {
  try {
    const opts = parseArgs(argv);
    if (sameFile(opts.brief, opts.out)) throw new UsageError('--out is the brief itself; name a new file for the plan, such as plan.json');
    const brief = readBrief(opts.brief);
    const problems = checkBrief(brief);
    if (problems.length > 0) {
      process.stderr.write(`${problems.join('\n')}\n`);
      return 1;
    }
    const explainerDir = path.join(SKILL_DIR, '..', 'make-explainer');
    const decision = storyboardDecision({ seconds: brief.seconds, explainerDir, nonInteractive: opts.nonInteractive });
    if (decision.action === 'skip') {
      process.stdout.write(`storyboard: skipped (${decision.reason})\n`);
      return 0;
    }
    const out = path.resolve(opts.out);
    writePlan(out, storyboardPlan(brief));
    process.stdout.write(`${out}\nbuild: node ${path.join(explainerDir, 'scripts/build.mjs')} ${out}\n`);
    return 0;
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    exitUsage(e);
    return 2;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}

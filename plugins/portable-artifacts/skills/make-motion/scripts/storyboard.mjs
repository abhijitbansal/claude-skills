#!/usr/bin/env node
// node scripts/storyboard.mjs <film.json> --out <plan.json> [--non-interactive]
// For a draft film longer than 20 s (its length estimated from its narration and holds: no voice is made and no browser
// starts) it writes a make-explainer `plan` page spec, the storyboard the user answers before the film is built, and
// prints its path, then the command that builds the page. Skips, with ONE stdout line `storyboard: skipped (<reason>)`,
// no file and exit 0, when the film is 20 s or less, make-explainer is not beside this skill, or --non-interactive is
// passed (a script cannot tell an interactive session from `claude -p`, so the agent declares it). Read the answers only
// through `node <make-explainer>/scripts/answers.mjs <plan.json> <answers.json>`. Exit 1: the film does not validate (its
// errors on stderr, one `path: message` per line); exit 2: a usage or IO problem.
import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError, parseCli } from '../shared/cli.mjs';
import { loadFilm } from './v2/pipeline.mjs';
import { SpecError } from './v2/spec.mjs';
import { STORYBOARD_MIN_SECONDS, storyboardPlan } from './v2/storyboard.mjs';

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ACCEPTED = '--out <file>, --non-interactive';
const USAGE = 'node scripts/storyboard.mjs <film.json> --out plan.json [--non-interactive]';
const OPTIONS = { out: { type: 'string' }, 'non-interactive': { type: 'boolean' } };
const MAX_PLAN_BYTES = 1024 * 1024;
const TENTHS = 10;

function parseArgs(argv) {
  let parsed;
  try {
    parsed = parseCli(argv, OPTIONS, USAGE);
  } catch (e) {
    if (e.help === true) throw e; // --help: the usage line, exit 0
    throw new UsageError(`${e.message} (accepted options: ${ACCEPTED})`);
  }
  const { values, positionals } = parsed;
  if (positionals.length !== 1) throw new UsageError(`expected one film file, got ${positionals.length}; usage: ${USAGE}`);
  if (values.out === undefined || values.out === '') throw new UsageError(`--out <file> is required: where to write the plan; usage: ${USAGE}`);
  return { film: positionals[0], out: values.out, nonInteractive: values['non-interactive'] === true };
}

// The output may not be the film itself (a mistyped --out would destroy the input).
function sameFile(a, b) {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

// An existing file may be replaced only when it is itself a storyboard plan (a JSON object with `preset: "plan"`) or
// empty: a rerun refreshes its own plan, and a film or any other file is never overwritten by a mistyped --out.
function isPlanFile(file) {
  try {
    const { size } = statSync(file);
    if (size === 0) return true;
    if (size > MAX_PLAN_BYTES) return false;
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return data !== null && typeof data === 'object' && data.preset === 'plan';
  } catch {
    return false; // unreadable or not JSON: not a plan, so never replaced
  }
}

function checkOut(out) {
  let stat;
  try { stat = lstatSync(out); } catch { return; }
  if (stat.isSymbolicLink()) throw new UsageError(`--out: ${path.basename(out)} is a symbolic link; choose a regular file name`);
  if (stat.isDirectory()) throw new UsageError(`--out: ${out} is a folder; name the .json file`);
  if (stat.isFile() && !isPlanFile(out)) throw new UsageError(`--out: ${path.basename(out)} exists and is not a storyboard plan; choose another --out`);
}

// Paths made of plain characters print as they are (the documented `build:` line); anything else is single-quoted.
const shellQuote = (text) => (/^[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replaceAll("'", `'\\''`)}'`);

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

// Why the storyboard is skipped, or null to write it: the film is short, make-explainer is not beside this skill, or no
// one can answer.
function skipReason(seconds, explainerDir, nonInteractive) {
  if (!(seconds > STORYBOARD_MIN_SECONDS)) return `not needed (${Math.round(seconds * TENTHS) / TENTHS} s is ${STORYBOARD_MIN_SECONDS} s or less)`;
  const marker = path.join(explainerDir, 'SKILL.md');
  try {
    statSync(marker);
  } catch {
    return `make-explainer is not installed beside make-motion (looked in ${marker})`;
  }
  return nonInteractive ? 'no one to ask (non-interactive run)' : null;
}

// The film as loaded, or the exit code of a film that does not validate (its errors written through `err`).
function filmOrExit(file, err) {
  try {
    return loadFilm(file);
  } catch (e) {
    if (e instanceof SpecError) {
      err(`${e.errors.map((x) => `${x.path}: ${x.message}`).join('\n')}\n`);
      return 1;
    }
    throw new UsageError(String(e.message).split('\n')[0]);
  }
}

/**
 * Runs the command on `argv`; returns the exit code. `explainerDir` (the make-explainer folder; default: beside this
 * skill), `out` and `err` (writers; default: the process's stdout and stderr) exist for tests.
 */
export function main(argv, { explainerDir = path.join(SKILL_DIR, '..', 'make-explainer'), out = (s) => process.stdout.write(s), err = (s) => process.stderr.write(s) } = {}) {
  try {
    const opts = parseArgs(argv);
    if (sameFile(opts.film, opts.out)) throw new UsageError('--out is the film itself; name a new file for the plan, such as plan.json');
    const loaded = filmOrExit(opts.film, err);
    if (typeof loaded === 'number') return loaded;
    const reason = skipReason(loaded.timeline.duration, explainerDir, opts.nonInteractive);
    if (reason !== null) {
      out(`storyboard: skipped (${reason})\n`);
      return 0;
    }
    const file = path.resolve(opts.out);
    checkOut(file);
    writePlan(file, storyboardPlan(loaded.film, loaded.timeline, { name: path.basename(opts.film, path.extname(opts.film)) }));
    out(`${file}\nbuild: node ${shellQuote(path.join(explainerDir, 'scripts/build.mjs'))} ${shellQuote(file)}\n`);
    return 0;
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    // --help is a usage line on stdout, not an error (main's 1.3.0 behaviour, through this command's own writers)
    if (e.help === true) {
      out(`usage: ${e.message}\n`); // the line shared/cli.mjs exitUsage prints for a help request
      return 0;
    }
    err(`${String(e.message).split('\n')[0]}\n`);
    return 2;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}

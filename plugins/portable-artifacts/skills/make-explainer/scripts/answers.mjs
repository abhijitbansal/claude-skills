#!/usr/bin/env node
// node scripts/answers.mjs <plan.json> <answers.json> [--json]
// Check a plan-answers/1 file (from the plan page's Copy or Download) against its plan and print a summary.
// exit 0 ok (warnings are printed), 1 the plan or the answers have errors, 2 usage/IO
import fs from 'node:fs';
import { loadSpec, validateSpec, exitSpecUsage } from './lib/spec.mjs';
import { checkAnswers } from './lib/answers.mjs';
import { UsageError, parseCli } from '../shared/cli.mjs';

const USAGE = 'node scripts/answers.mjs <plan.json> <answers.json> [--json]';
const OPTIONS = { json: { type: 'boolean' } };
const MAX_ANSWERS_BYTES = 2 * 1024 * 1024; // a real file is a few kilobytes
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// `errors` and `warnings` are the entries shown; the counts are the true totals (see checkAnswers).
function print({ ok, errors, warnings, errorCount, warningCount, summary }, { json, label }) {
  if (json) {
    process.stdout.write(`${JSON.stringify({ ok, errors, warnings, errorCount, warningCount, summary })}\n`);
    return;
  }
  const hidden = (count, shown) => (count > shown.length ? `… ${count - shown.length} more\n` : '');
  for (const e of errors) process.stdout.write(`${e.path || '(root)'}: ${e.message}\n`);
  process.stdout.write(hidden(errorCount, errors));
  for (const w of warnings) process.stdout.write(`${w.path || '(root)'}: warning: ${w.message}\n`);
  process.stdout.write(hidden(warningCount, warnings));
  if (summary !== '') process.stdout.write(`${errorCount || warningCount ? '\n' : ''}${summary}\n`);
  const tail = warningCount ? ` (${plural(warningCount, 'warning')})` : '';
  process.stdout.write(ok ? `\n${label}: valid${tail}\n` : `\n${label}: ${plural(errorCount, 'error')}${warningCount ? `, ${plural(warningCount, 'warning')}` : ''}\n`);
}

// A named pipe or a device would block or never end; refuse before opening anything. A file that cannot be
// examined is left to loadSpec, which says why.
function requireRegularFile(file, maxBytes) {
  let info;
  try {
    info = fs.statSync(file);
  } catch {
    return;
  }
  if (!info.isFile()) throw new UsageError(`not a regular file: ${file}`);
  if (maxBytes !== undefined && info.size > maxBytes) throw new UsageError(`answers file too large: ${file} is ${info.size} bytes; the limit is ${maxBytes}`);
}

async function check(planFile, answersFile) {
  requireRegularFile(planFile);
  requireRegularFile(answersFile, MAX_ANSWERS_BYTES);
  const { spec, dir } = loadSpec(planFile);
  const { spec: answers } = loadSpec(answersFile);
  const plan = await validateSpec(spec, { dir });
  if (!plan.ok) return { ok: false, errors: plan.errors, warnings: plan.warnings, errorCount: plan.errors.length, warningCount: plan.warnings.length, summary: '' };
  const checked = checkAnswers(spec, answers);
  return { ok: checked.errorCount === 0, ...checked };
}

const argv = process.argv.slice(2);
const json = argv.includes('--json');
try {
  const { values, positionals } = parseCli(argv, OPTIONS, USAGE);
  if (positionals.length !== 2) throw new UsageError(`expected a plan file and an answers file; usage: ${USAGE}`);
  const result = await check(positionals[0], positionals[1]);
  print(result, { json: values.json, label: positionals[1] });
  process.exitCode = result.ok ? 0 : 1;
} catch (e) {
  if (!(e instanceof UsageError)) throw e;
  exitSpecUsage(e, { json });
}

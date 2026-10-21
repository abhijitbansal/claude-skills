#!/usr/bin/env node
// node scripts/answers.mjs <plan.json> <answers.json> [--json]
// Check a plan-answers/1 file (from the plan page's Copy or Download) against its plan and print a summary.
// exit 0 ok (warnings are printed), 1 the plan or the answers have errors, 2 usage/IO
import { loadSpec, validateSpec, exitSpecUsage } from './lib/spec.mjs';
import { checkAnswers } from './lib/answers.mjs';
import { UsageError, parseCli } from '../shared/cli.mjs';

const USAGE = 'node scripts/answers.mjs <plan.json> <answers.json> [--json]';
const OPTIONS = { json: { type: 'boolean' } };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function print({ ok, errors, warnings, summary }, { json, label }) {
  if (json) {
    process.stdout.write(`${JSON.stringify({ ok, errors, warnings, summary })}\n`);
    return;
  }
  for (const e of errors) process.stdout.write(`${e.path || '(root)'}: ${e.message}\n`);
  for (const w of warnings) process.stdout.write(`${w.path || '(root)'}: warning: ${w.message}\n`);
  if (summary !== '') process.stdout.write(`${errors.length || warnings.length ? '\n' : ''}${summary}\n`);
  const tail = warnings.length ? ` (${plural(warnings.length, 'warning')})` : '';
  process.stdout.write(ok ? `\n${label}: valid${tail}\n` : `\n${label}: ${plural(errors.length, 'error')}${warnings.length ? `, ${plural(warnings.length, 'warning')}` : ''}\n`);
}

async function check(planFile, answersFile) {
  const { spec, dir } = loadSpec(planFile);
  const { spec: answers } = loadSpec(answersFile);
  const plan = await validateSpec(spec, { dir });
  if (!plan.ok) return { ok: false, errors: plan.errors, warnings: plan.warnings, summary: '' };
  const result = checkAnswers(spec, answers);
  return { ok: result.errors.length === 0, ...result };
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

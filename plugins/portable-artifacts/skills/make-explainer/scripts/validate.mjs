#!/usr/bin/env node
// node scripts/validate.mjs <explainer.json> [--json]
// exit 0 valid (warnings are printed), 1 spec errors, 2 usage/IO
import { loadSpec, validateSpec } from './lib/spec.mjs';
import { UsageError, parseCli, exitUsage, evalLog } from '../shared/cli.mjs';

const USAGE = 'node scripts/validate.mjs <explainer.json> [--json]';
const OPTIONS = { json: { type: 'boolean' } };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function print({ ok, errors, warnings }, { json, label }) {
  if (json) {
    process.stdout.write(`${JSON.stringify({ ok, errors, warnings })}\n`);
    return;
  }
  for (const e of errors) process.stdout.write(`${e.path || '(root)'}: ${e.message}\n`);
  for (const w of warnings) process.stdout.write(`${w.path || '(root)'}: warning: ${w.message}\n`);
  const tail = warnings.length ? ` (${plural(warnings.length, 'warning')})` : '';
  process.stdout.write(ok ? `${label}: valid${tail}\n` : `${label}: ${plural(errors.length, 'error')}${warnings.length ? `, ${plural(warnings.length, 'warning')}` : ''}\n`);
}

const argv = process.argv.slice(2);
const json = argv.includes('--json');
try {
  const { values, positionals } = parseCli(argv, OPTIONS, USAGE);
  if (positionals.length !== 1) throw new UsageError(`expected one spec file; usage: ${USAGE}`);
  const { spec, dir } = loadSpec(positionals[0]);
  const result = await validateSpec(spec, { dir });
  print(result, { json: values.json, label: positionals[0] });
  evalLog(result.ok, result.errors.length);
  process.exitCode = result.ok ? 0 : 1;
} catch (e) {
  if (!(e instanceof UsageError)) throw e;
  evalLog(false, 1);
  exitUsage(e, { json });
}

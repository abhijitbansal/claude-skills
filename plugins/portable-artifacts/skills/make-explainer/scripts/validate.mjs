#!/usr/bin/env node
// node scripts/validate.mjs <explainer.json> [--strict] [--json]
// --strict turns the section and page length caps into errors (warnings otherwise).
// exit 0 valid (warnings are printed), 1 spec errors, 2 usage/IO or dependencies not installed
//
// Imports only built-ins and shared/ up here: lib/spec.mjs (ajv) loads after preflight has found node_modules, so a
// missing install is one line naming the doctor command, not an ERR_MODULE_NOT_FOUND stack.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError, parseCli, evalLog } from '../shared/cli.mjs';
import { preflight } from '../shared/preflight.mjs';
import { exitSpecUsage } from './lib/usage-exit.mjs';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'node scripts/validate.mjs <explainer.json> [--strict] [--json]';
const OPTIONS = { json: { type: 'boolean' }, strict: { type: 'boolean' } };
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
  if (preflight(SKILL_ROOT, { argv })) {
    const { loadSpec, validateSpec } = await import('./lib/spec.mjs');
    const { provenanceWarnings } = await import('./lib/semantic.mjs');
    const { spec, dir } = loadSpec(positionals[0]);
    const checked = await validateSpec(spec, { dir, strict: values.strict === true });
    const result = { ...checked, warnings: [...checked.warnings, ...(checked.ok ? provenanceWarnings(spec) : [])] };
    print(result, { json: values.json, label: positionals[0] });
    evalLog(result.ok, result.errors.length);
    process.exitCode = result.ok ? 0 : 1;
  }
} catch (e) {
  if (!(e instanceof UsageError)) throw e;
  evalLog(false, 1);
  exitSpecUsage(e, { json });
}

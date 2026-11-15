// scripts/validate.mjs body, loaded by the entry script after its dependency preflight.
// node scripts/validate.mjs <spec.json> [--json] [--allow-outside] [--timeout s] [--bind-only]
// Runs every query and expands every chart, as build does, so valid means buildable;
// --bind-only stops after binding each query with LIMIT 0 (faster, misses value checks).
// exit 0 valid, 1 spec errors, 2 usage/IO
import { loadSpec, validateSpec } from '../lib/spec.mjs';
import { UsageError, parseCli, parseTimeout, exitUsage, evalLog } from '../../shared/cli.mjs';
import { printResult } from '../../shared/errors.mjs';

const USAGE = 'node scripts/validate.mjs <spec.json> [--json] [--allow-outside] [--timeout <seconds>] [--bind-only]';
const OPTIONS = {
  json: { type: 'boolean' },
  'allow-outside': { type: 'boolean' },
  timeout: { type: 'string' },
  'bind-only': { type: 'boolean' },
};

const argv = process.argv.slice(2);
const json = argv.includes('--json');
try {
  const { values, positionals } = parseCli(argv, OPTIONS, USAGE);
  if (positionals.length !== 1) throw new UsageError(`expected one spec file; usage: ${USAGE}`);
  const timeoutMs = parseTimeout(values.timeout, 30);
  const { spec, dir } = loadSpec(positionals[0]);
  const result = await validateSpec(spec, { dir, allowOutside: values['allow-outside'], timeoutMs, stage: values['bind-only'] ? 'bind' : 'full' });
  printResult(result, { json: values.json, label: positionals[0] });
  evalLog(result.ok, result.errors.length);
  process.exitCode = result.ok ? 0 : 1;
} catch (e) {
  if (!(e instanceof UsageError)) throw e;
  evalLog(false, 1);
  exitUsage(e, { json });
}

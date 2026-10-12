#!/usr/bin/env node
// node scripts/validate.mjs <spec.diagram.json> [--json]
// exit 0 valid, 1 spec errors, 2 usage/IO
import { loadSpec, validateSpec } from './lib/spec.mjs';
import { UsageError, parseCli, exitUsage, evalLog } from '../shared/cli.mjs';
import { printResult } from '../shared/errors.mjs';

const USAGE = 'node scripts/validate.mjs <spec.diagram.json> [--json]';
const OPTIONS = { json: { type: 'boolean' } };

const argv = process.argv.slice(2);
const json = argv.includes('--json');
try {
  const { values, positionals } = parseCli(argv, OPTIONS, USAGE);
  if (positionals.length !== 1) throw new UsageError(`expected one spec file; usage: ${USAGE}`);
  const { spec } = loadSpec(positionals[0]);
  const result = await validateSpec(spec);
  printResult(result, { json: values.json, label: positionals[0] });
  evalLog(result.ok, result.errors.length);
  process.exitCode = result.ok ? 0 : 1;
} catch (e) {
  if (!(e instanceof UsageError)) throw e;
  evalLog(false, 1);
  exitUsage(e, { json });
}

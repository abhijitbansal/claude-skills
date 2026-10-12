#!/usr/bin/env node
// node scripts/validate.mjs <spec.json> [--json] [--allow-outside] [--timeout s]
// exit 0 valid, 1 spec errors, 2 usage/IO
import fs from 'node:fs';
import { loadSpec, validateSpec } from './lib/spec.mjs';
import { UsageError, parseCli, parseTimeout, exitUsage } from '../shared/cli.mjs';
import { printResult } from '../shared/errors.mjs';

const USAGE = 'node scripts/validate.mjs <spec.json> [--json] [--allow-outside] [--timeout <seconds>]';
const OPTIONS = {
  json: { type: 'boolean' },
  'allow-outside': { type: 'boolean' },
  timeout: { type: 'string' },
};

// Best effort: a broken log path must never change the validation outcome.
function evalLog(ok, errors) {
  if (!process.env.EVAL_LOG) return;
  try {
    fs.appendFileSync(process.env.EVAL_LOG, `${JSON.stringify({ ts: new Date().toISOString(), ok, errors })}\n`);
  } catch {
    // ignored on purpose
  }
}

const argv = process.argv.slice(2);
const json = argv.includes('--json');
try {
  const { values, positionals } = parseCli(argv, OPTIONS, USAGE);
  if (positionals.length !== 1) throw new UsageError(`expected one spec file; usage: ${USAGE}`);
  const timeoutMs = parseTimeout(values.timeout, 30);
  const { spec, dir } = loadSpec(positionals[0]);
  const result = await validateSpec(spec, { dir, allowOutside: values['allow-outside'], timeoutMs });
  printResult(result, { json: values.json, label: positionals[0] });
  evalLog(result.ok, result.errors.length);
  process.exitCode = result.ok ? 0 : 1;
} catch (e) {
  if (!(e instanceof UsageError)) throw e;
  evalLog(false, 1);
  exitUsage(e, { json });
}

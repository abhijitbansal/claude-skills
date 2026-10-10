#!/usr/bin/env node
// node scripts/validate.mjs <motion.json> [--json]   exit 0 ok, 1 spec errors, 2 usage/IO
import { appendFileSync } from 'node:fs';
import { loadSpec, validateSpec, UsageError } from './lib/spec.mjs';
import { printResult } from './lib/errors.mjs';

const args = process.argv.slice(2);
const json = args.includes('--json');
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  process.stderr.write('usage: node scripts/validate.mjs <motion.json> [--json]\n');
  process.exit(2);
}
try {
  const { spec, dir } = loadSpec(file);
  const result = validateSpec(spec, { dir });
  printResult(result, { json, label: file });
  if (process.env.EVAL_LOG) {
    appendFileSync(process.env.EVAL_LOG, `${JSON.stringify({ ts: new Date().toISOString(), ok: result.ok, errors: result.errors.length })}\n`);
  }
  process.exit(result.ok ? 0 : 1);
} catch (e) {
  if (!(e instanceof UsageError)) throw e;
  process.stderr.write(`${e.message}\n`);
  process.exit(2);
}

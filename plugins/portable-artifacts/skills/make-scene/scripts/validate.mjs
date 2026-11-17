#!/usr/bin/env node
// node scripts/validate.mjs <scene.json> [--json] [--allow-outside]
// "valid" means it builds: a spec that passes the checks is also built the way build.mjs builds it, and a page over
// the size cap is reported with build.mjs's own message. Warnings (advice, never a failure) print as
// "path: warning: message" and do not change the exit code.
// exit 0 valid, 1 spec errors, 2 usage/IO or dependencies not installed (the doctor command is named)
//
// Imports only built-ins and shared/ up here: lib/spec.mjs (ajv) loads after preflight has found node_modules, so a
// missing install is one line naming the doctor command, not an ERR_MODULE_NOT_FOUND stack.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError, parseCli, exitUsage, evalLog } from '../shared/cli.mjs';
import { makeResult, printResult } from '../shared/errors.mjs';
import { preflight } from '../shared/preflight.mjs';
import { exitInternal } from './lib/internal-error.mjs';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'node scripts/validate.mjs <scene.json> [--json] [--allow-outside]';
const OPTIONS = { json: { type: 'boolean' }, 'allow-outside': { type: 'boolean' } };

const argv = process.argv.slice(2);
const json = argv.includes('--json');
try {
  const { values, positionals } = parseCli(argv, OPTIONS, USAGE);
  if (positionals.length !== 1) throw new UsageError(`expected one spec file; usage: ${USAGE}`);
  if (preflight(SKILL_ROOT, { argv })) {
    const { loadSpec, validateSpec } = await import('./lib/spec.mjs');
    await import('./lifts/index.mjs'); // registers the lift checks
    const { pageErrors } = await import('./lib/page-size.mjs');
    const { spec, dir } = loadSpec(positionals[0]);
    const allowOutside = values['allow-outside'];
    const checked = await validateSpec(spec, { dir, allowOutside });
    const result = checked.ok ? makeResult((await pageErrors(spec, { dir, allowOutside })).errors, checked.warnings) : checked;
    printResult(result, { json: values.json, label: positionals[0] });
    evalLog(result.ok, result.errors.length);
    process.exitCode = result.ok ? 0 : 1;
  }
} catch (e) {
  evalLog(false, 1);
  if (e instanceof UsageError) exitUsage(e, { json });
  else exitInternal(e, { json });
}

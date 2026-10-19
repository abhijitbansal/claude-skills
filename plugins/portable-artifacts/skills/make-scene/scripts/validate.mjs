#!/usr/bin/env node
// node scripts/validate.mjs <scene.json> [--json] [--allow-outside]
// "valid" means it builds: a spec that passes the checks is also built the way build.mjs builds it, and a page over
// the size cap is reported with build.mjs's own message. exit 0 valid, 1 spec errors, 2 usage/IO
import { loadSpec, validateSpec } from './lib/spec.mjs';
import './lifts/index.mjs'; // registers the lift checks
import { UsageError, parseCli, exitUsage, evalLog } from '../shared/cli.mjs';
import { printResult } from '../shared/errors.mjs';
import { exitInternal } from './lib/internal-error.mjs';
import { pageErrors } from './lib/page-size.mjs';

const USAGE = 'node scripts/validate.mjs <scene.json> [--json] [--allow-outside]';
const OPTIONS = { json: { type: 'boolean' }, 'allow-outside': { type: 'boolean' } };

const argv = process.argv.slice(2);
const json = argv.includes('--json');
try {
  const { values, positionals } = parseCli(argv, OPTIONS, USAGE);
  if (positionals.length !== 1) throw new UsageError(`expected one spec file; usage: ${USAGE}`);
  const { spec, dir } = loadSpec(positionals[0]);
  const allowOutside = values['allow-outside'];
  const checked = await validateSpec(spec, { dir, allowOutside });
  const result = checked.ok ? await pageErrors(spec, { dir, allowOutside }) : checked;
  printResult(result, { json: values.json, label: positionals[0] });
  evalLog(result.ok, result.errors.length);
  process.exitCode = result.ok ? 0 : 1;
} catch (e) {
  evalLog(false, 1);
  if (e instanceof UsageError) exitUsage(e, { json });
  else exitInternal(e, { json });
}

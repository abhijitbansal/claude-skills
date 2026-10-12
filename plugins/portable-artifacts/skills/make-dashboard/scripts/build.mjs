#!/usr/bin/env node
// node scripts/build.mjs <spec.json> [--out <dir>] [--json] [--allow-outside] [--timeout s] [--theme name]
// exit 0 ok, 1 spec/query errors, 2 usage/IO
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_ROWS_DEFAULT } from './lib/spec.mjs';
import { buildDashboard } from './lib/pipeline.mjs';
import { UsageError, parseCli, parseTimeout, exitUsage } from '../shared/cli.mjs';
import { printResult } from '../shared/errors.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const USAGE = 'node scripts/build.mjs <spec.json> [--out <dir>] [--json] [--allow-outside] [--timeout <seconds>] [--theme <name>]';
const OPTIONS = {
  out: { type: 'string' },
  json: { type: 'boolean' },
  'allow-outside': { type: 'boolean' },
  timeout: { type: 'string' },
  theme: { type: 'string' },
};

const argv = process.argv.slice(2);
const json = argv.includes('--json');
let jsonMode = json;

try {
  const { values, positionals } = parseCli(argv, OPTIONS, USAGE);
  jsonMode = values.json;
  if (positionals.length !== 1) throw new UsageError(`expected one spec file; usage: ${USAGE}`);
  const timeoutMs = parseTimeout(values.timeout, 30);
  const result = await buildDashboard(positionals[0], { out: values.out, theme: values.theme, allowOutside: values['allow-outside'], timeoutMs });
  if (!result.ok) {
    printResult({ ok: false, errors: result.errors }, { json: jsonMode, label: 'build' });
    process.exitCode = 1;
  } else {
    const { spec, target, outDir, results, sources } = result;
    const serve = JSON.stringify(path.join(HERE, 'serve.mjs'));
    const serveHint = `node ${serve} ${JSON.stringify(outDir)} --open`;
    const watchHint = `node ${serve} --watch ${JSON.stringify(path.resolve(positionals[0]))} --open`;
    if (jsonMode) {
      const queries = Object.fromEntries(Object.entries(results).map(([n, r]) => [n, { rowCount: r.rowCount, truncated: r.truncated }]));
      process.stdout.write(`${JSON.stringify({ ok: true, out: target, sources: Object.fromEntries(sources), queries })}\n`);
    } else {
      for (const [name, abs] of sources) process.stdout.write(`source ${name}: ${abs}\n`);
      for (const [name, r] of Object.entries(results)) {
        process.stdout.write(`${name}: ${r.rowCount} rows${r.truncated ? ` (truncated at ${spec.maxRows ?? MAX_ROWS_DEFAULT})` : ''}\n`);
      }
      process.stdout.write(`wrote ${target}\nserve: ${serveHint}\nwatch: ${watchHint}\n`);
    }
  }
} catch (e) {
  if (!(e instanceof UsageError)) throw e;
  exitUsage(e, { json: jsonMode });
}

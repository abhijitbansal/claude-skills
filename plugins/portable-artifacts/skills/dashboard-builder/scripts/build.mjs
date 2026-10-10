#!/usr/bin/env node
// node scripts/build.mjs <spec.json> [--out <dir>] [--json] [--allow-outside] [--timeout s]
// exit 0 ok, 1 spec/query errors, 2 usage/IO
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSpec, validateSpec, MAX_ROWS_DEFAULT } from './lib/spec.mjs';
import { runQueries, checkFields, QueryError } from './lib/data.mjs';
import { renderPage } from './lib/html.mjs';
import { checkSource } from './lib/sources.mjs';
import { UsageError, parseCli, parseTimeout, exitUsage } from './lib/cli.mjs';
import { printResult } from './lib/errors.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.resolve(HERE, '..');
const USAGE = 'node scripts/build.mjs <spec.json> [--out <dir>] [--json] [--allow-outside] [--timeout <seconds>]';
const OPTIONS = {
  out: { type: 'string' },
  json: { type: 'boolean' },
  'allow-outside': { type: 'boolean' },
  timeout: { type: 'string' },
};
const VENDOR_FILES = {
  vega: 'node_modules/vega/build/vega.min.js',
  vegaLite: 'node_modules/vega-lite/build/vega-lite.min.js',
  vegaEmbed: 'node_modules/vega-embed/build/vega-embed.min.js',
};

function readVendor() {
  const out = {};
  for (const [key, rel] of Object.entries(VENDOR_FILES)) {
    try {
      out[key] = fs.readFileSync(path.join(SKILL, rel), 'utf8');
    } catch {
      throw new UsageError(`missing ${rel}; run "npm ci" in ${SKILL}`);
    }
  }
  return out;
}

function writePage(outDir, html) {
  const target = path.join(outDir, 'index.html');
  try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(target, html);
  } catch (e) {
    throw new UsageError(`cannot write ${target}: ${e.code ?? e.message}`);
  }
  return target;
}

const argv = process.argv.slice(2);
const json = argv.includes('--json');
let jsonMode = json;

try {
  const { values, positionals } = parseCli(argv, OPTIONS, USAGE);
  jsonMode = values.json;
  if (positionals.length !== 1) throw new UsageError(`expected one spec file; usage: ${USAGE}`);
  const timeoutMs = parseTimeout(values.timeout, 30);
  const allowOutside = values['allow-outside'];
  const fail = (errors) => {
    printResult({ ok: false, errors }, { json: jsonMode, label: 'build' });
    process.exit(1);
  };

  const { spec, dir } = loadSpec(positionals[0]);
  const valid = await validateSpec(spec, { dir, allowOutside, timeoutMs });
  if (!valid.ok) fail(valid.errors);
  const vendor = readVendor();

  let results;
  try {
    results = await runQueries(spec, dir, { now: new Date(), allowOutside, timeoutMs });
  } catch (e) {
    if (e instanceof QueryError) fail(e.errors);
    throw e;
  }
  const fieldErrors = checkFields(spec, results);
  if (fieldErrors.length) fail(fieldErrors);

  const outDir = path.resolve(values.out ?? path.join(dir, 'dist'));
  const target = writePage(outDir, renderPage(spec, results, { vendor }));

  const sources = Object.entries(spec.sources).map(([name, src]) => [name, checkSource(src, dir, { allowOutside }).abs]);
  const serveHint = `node ${JSON.stringify(path.join(HERE, 'serve.mjs'))} ${JSON.stringify(outDir)} --open`;
  if (jsonMode) {
    const queries = Object.fromEntries(Object.entries(results).map(([n, r]) => [n, { rowCount: r.rowCount, truncated: r.truncated }]));
    process.stdout.write(`${JSON.stringify({ ok: true, out: target, sources: Object.fromEntries(sources), queries })}\n`);
  } else {
    for (const [name, abs] of sources) process.stdout.write(`source ${name}: ${abs}\n`);
    for (const [name, r] of Object.entries(results)) {
      process.stdout.write(`${name}: ${r.rowCount} rows${r.truncated ? ` (truncated at ${spec.maxRows ?? MAX_ROWS_DEFAULT})` : ''}\n`);
    }
    process.stdout.write(`wrote ${target}\nserve: ${serveHint}\n`);
  }
} catch (e) {
  if (!(e instanceof UsageError)) throw e;
  exitUsage(e, { json: jsonMode });
}

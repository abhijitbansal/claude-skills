// query.mjs body, loaded after the preflight (see scripts/query.mjs).
import { UsageError, parseCli, parseTimeout, exitUsage } from '../../shared/cli.mjs';
import { printResult } from '../../shared/errors.mjs';
import { chartData } from '../lib/pipeline.mjs';
import { loadSpec, MAX_ROWS_DEFAULT } from '../lib/spec.mjs';

const USAGE = 'node scripts/query.mjs <spec.json> --chart <id> [--limit <n>] [--json] [--allow-outside] [--timeout <seconds>]';
const DEFAULT_LIMIT = 20;
const OPTIONS = {
  chart: { type: 'string' },
  limit: { type: 'string' },
  json: { type: 'boolean' },
  'allow-outside': { type: 'boolean' },
  timeout: { type: 'string' },
};

function parseLimit(value) {
  if (value === undefined) return DEFAULT_LIMIT;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new UsageError(`--limit must be a whole number of rows >= 1, got ${JSON.stringify(value)}`);
  return n;
}

function printRows(chartId, { chart, result }, limit, maxRows) {
  const { rows, columns, types, rowCount, truncated } = result;
  const shown = rows.slice(0, limit);
  const out = (text) => process.stdout.write(`${text}\n`);
  out(`chart ${chartId} (query ${chart.query}): ${rowCount} rows${truncated ? ` (truncated at maxRows ${maxRows})` : ''}`);
  out(`columns: ${columns.map((c, i) => `${c} ${types[i]}`).join(', ')}`);
  for (const r of shown) out(`  ${JSON.stringify(r)}`);
  if (rows.length > shown.length) out(`  … ${rows.length - shown.length} more rows`);
}

export async function main(argv) {
  const json = argv.includes('--json');
  try {
    const { values, positionals } = parseCli(argv, OPTIONS, USAGE);
    if (positionals.length !== 1) throw new UsageError(`expected one spec file; usage: ${USAGE}`);
    if (!values.chart) throw new UsageError(`--chart <id> is required; usage: ${USAGE}`);
    const limit = parseLimit(values.limit);
    const timeoutMs = parseTimeout(values.timeout, 30);
    const { spec } = loadSpec(positionals[0]); // a usage error (exit 2) when the file is missing or not JSON
    const data = await chartData(positionals[0], values.chart, { allowOutside: values['allow-outside'], timeoutMs });
    if (!data.ok) {
      printResult({ ok: false, errors: data.errors }, { json, label: positionals[0] });
      process.exitCode = 1;
      return;
    }
    const maxRows = spec.maxRows ?? MAX_ROWS_DEFAULT;
    if (json) {
      const { rows, columns, types, rowCount, truncated } = data.result;
      const body = { ok: true, chart: values.chart, query: data.chart.query, rowCount, truncated, maxRows, columns: columns.map((name, i) => ({ name, type: types[i] })), rows: rows.slice(0, limit) };
      process.stdout.write(`${JSON.stringify(body)}\n`);
    } else {
      printRows(values.chart, data, limit, maxRows);
    }
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    exitUsage(e, { json });
  }
}

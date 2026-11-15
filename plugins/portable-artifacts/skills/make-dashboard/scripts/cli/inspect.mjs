// scripts/inspect.mjs body, loaded by the entry script after its dependency preflight.
// node scripts/inspect.mjs <file.csv|parquet|json> [--type t] [--json] [--allow-outside]
// node scripts/inspect.mjs --spec dashboard.json --source <name> [--table <t>] [--json] [--allow-outside]
// Column names, types and 5 sample rows, read through the same locked-down
// DuckDB (and the same SQL allowlist) as the build. A file path resolves
// against the current folder; with --spec, an attached source (duckdb, sqlite,
// postgres, mysql) lists its tables, or --table shows one of them.
import path from 'node:path';
import { UsageError, parseCli, exitUsage } from '../../shared/cli.mjs';
import { openLockedDb, checkSelect, errMessage, sqlLiteral, quoteId } from '../lib/sql.mjs';
import { fetchQuery } from '../lib/data.mjs';
import { loadSpec, validateSpec } from '../lib/spec.mjs';
import { printResult } from '../../shared/errors.mjs';
import { policyFor } from '../lib/sources.mjs';

const USAGE = 'node scripts/inspect.mjs <file.csv|parquet|json> [--type t] [--json] [--allow-outside] | --spec dashboard.json --source <name> [--table <t>]';
const SAMPLE_ROWS = 5;
const BY_EXTENSION = { '.csv': 'csv', '.tsv': 'csv', '.parquet': 'parquet', '.json': 'json', '.jsonl': 'json', '.ndjson': 'json' };
const VIEW_TYPES = ['csv', 'parquet', 'json'];

const out = (text) => process.stdout.write(text);

// A null share in [0, 1] as a whole percent ("0%", "12%"); "<1%" when small but not zero.
const percent = (share) => (share > 0 && share < 0.01 ? '<1%' : `${Math.round(share * 100)}%`);

function printRows({ rows, columns, types }, { label, json, extra, summary, summaryError }) {
  if (json) {
    out(`${JSON.stringify({ ...extra, columns: columns.map((name, i) => ({ name, type: types[i] })), rows, summary, ...(summaryError ? { summaryError } : {}) })}\n`);
    return;
  }
  const width = Math.max(...columns.map((c) => c.length));
  out(`${label}\ncolumns:\n`);
  columns.forEach((c, i) => out(`  ${c.padEnd(width)}  ${types[i]}\n`));
  out(`sample (${rows.length} rows):\n`);
  for (const r of rows) out(`  ${JSON.stringify(r)}\n`);
  if (summaryError) out(`summary: unavailable (${summaryError})\n`);
  if (!summary.length) return;
  // distinct is DuckDB's approximate count (SUMMARIZE's approx_unique), exact for small sets
  out('summary:\n');
  for (const s of summary) out(`  ${s.name.padEnd(width)}  distinct ${s.distinct}  min ${s.min ?? '—'}  max ${s.max ?? '—'}  null ${percent(s.nullShare)}\n`);
}

const SUMMARY_ROWS = 1000; // one row per column

async function guarded(db, sql, policy, limit) {
  const message = await checkSelect(db.conn, sql, policy);
  if (message) throw new UsageError(message);
  try {
    return await fetchQuery(db.conn, sql, limit, undefined, db.scrubData);
  } catch (e) {
    throw new UsageError(errMessage(e, 3, db.scrub));
  }
}

const sample = (db, sql, policy) => guarded(db, sql, policy, SAMPLE_ROWS);

// Per-column distinct count, min, max and null share, so colour and slice caps
// and value ranges are visible before a chart is written. Through the same guard.
// Best effort: SUMMARIZE scans the whole source (the sample reads 6 rows), so a value
// the sniffer did not expect or the timeout leaves { summary: [], summaryError } instead of failing inspect.
async function summarize(db, sql, policy) {
  try {
    const { rows } = await guarded(db, `SUMMARIZE ${sql}`, policy, SUMMARY_ROWS);
    return {
      summary: rows.map((r) => ({
        name: r.column_name,
        distinct: Number(r.approx_unique),
        min: r.min,
        max: r.max,
        nullShare: r.null_percentage === null ? 0 : Number(r.null_percentage) / 100,
      })),
    };
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    return { summary: [], summaryError: String(e.message).split('\n')[0] };
  }
}

async function open(spec, dir, allowOutside, folderLabel) {
  try {
    return await openLockedDb(spec, dir, { allowOutside, folderLabel });
  } catch (e) {
    throw new UsageError(e.errors?.[0]?.message ?? errMessage(e));
  }
}

async function inspectFile(file, values) {
  const type = values.type ?? BY_EXTENSION[path.extname(file).toLowerCase()];
  if (!VIEW_TYPES.includes(type)) throw new UsageError(`cannot tell the file type of ${file}; pass --type csv|parquet|json`);
  const spec = { sources: { t: { type, path: file } } };
  const db = await open(spec, process.cwd(), values['allow-outside'], 'working folder');
  try {
    const policy = policyFor(spec);
    const result = await sample(db, 'SELECT * FROM t', policy);
    const summary = await summarize(db, 'SELECT * FROM t', policy);
    printRows(result, { label: `file: ${path.resolve(file)}`, json: values.json, extra: { file }, ...summary });
  } finally {
    db.close();
  }
}

async function listTables(db, source, json) {
  const lit = sqlLiteral(source);
  const reader = await db.conn.runAndReadAll(
    `SELECT schema_name AS s, table_name AS t FROM duckdb_tables() WHERE database_name = ${lit} AND NOT internal
     UNION ALL SELECT schema_name, view_name FROM duckdb_views() WHERE database_name = ${lit} AND NOT internal ORDER BY 1, 2`,
  );
  const tables = reader.getRowObjectsJS().map((r) => ({ schema: db.scrubData(r.s), table: db.scrubData(r.t) }));
  if (json) out(`${JSON.stringify({ source, tables })}\n`);
  else {
    out(`tables in ${source}:\n`);
    for (const t of tables) out(`  ${t.schema}.${t.table}\n`);
    if (!tables.length) out('  (none)\n');
  }
}

async function inspectSource(values) {
  if (!values.source) throw new UsageError(`--spec needs --source <name>; usage: ${USAGE}`);
  const { spec, dir } = loadSpec(values.spec);
  // Schema, source-shape and guard checks before any database is opened: spec
  // text must never reach SQL unchecked (the source-name pattern is what keeps
  // sqlLiteral(source) in listTables safe). Queries are not bound: inspect is
  // how a draft finds its tables and columns, so they need not work yet.
  const valid = await validateSpec(spec, { dir, allowOutside: values['allow-outside'], stage: 'static' });
  if (!valid.ok) {
    printResult(valid, { json: values.json, label: values.spec });
    process.exitCode = 1; // not process.exit(): it can SIGSEGV after a pipe write on Node 24.7
    return;
  }
  if (values.table === '') throw new UsageError('--table needs a table name');
  const src = spec.sources?.[values.source];
  if (!src) throw new UsageError(`unknown source ${JSON.stringify(values.source)}; the spec declares: ${Object.keys(spec.sources ?? {}).join(', ') || 'nothing'}`);
  const isFile = VIEW_TYPES.includes(src.type);
  if (isFile && values.table) throw new UsageError('--table only applies to attached sources (duckdb, sqlite, postgres, mysql)');
  const db = await open(spec, dir, values['allow-outside']);
  try {
    if (!isFile && !values.table) return await listTables(db, values.source, values.json);
    const parts = isFile ? [] : values.table.split('.');
    if (parts.length > 2) throw new UsageError('--table takes <table> or <schema>.<table>');
    const sql = `SELECT * FROM ${[values.source, ...parts].map(quoteId).join('.')}`;
    const policy = policyFor(spec);
    const result = await sample(db, sql, policy);
    const summary = await summarize(db, sql, policy);
    const name = [values.source, ...parts].join('.');
    printRows(result, { label: `source: ${name}`, json: values.json, extra: { source: values.source, table: values.table }, ...summary });
  } finally {
    db.close();
  }
}

const argv = process.argv.slice(2);
const json = argv.includes('--json');
try {
  const { values, positionals } = parseCli(argv, {
    json: { type: 'boolean' },
    type: { type: 'string' },
    spec: { type: 'string' },
    source: { type: 'string' },
    table: { type: 'string' },
    'allow-outside': { type: 'boolean' },
  }, USAGE);
  if (values.spec) {
    if (positionals.length) throw new UsageError(`give either a file or --spec, not both; usage: ${USAGE}`);
    await inspectSource(values);
  } else {
    if (positionals.length !== 1) throw new UsageError(`expected one file; usage: ${USAGE}`);
    await inspectFile(positionals[0], values);
  }
} catch (e) {
  if (!(e instanceof UsageError)) throw e;
  exitUsage(e, { json });
}

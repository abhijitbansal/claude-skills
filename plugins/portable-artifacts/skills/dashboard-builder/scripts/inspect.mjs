#!/usr/bin/env node
// node scripts/inspect.mjs <file.csv|parquet|json> [--json] [--type csv|parquet|json] [--allow-outside]
// Column names, types and 5 sample rows, read through the same locked-down
// DuckDB as the build. Paths resolve against the current folder.
import path from 'node:path';
import { UsageError, parseCli, exitUsage } from './lib/cli.mjs';
import { openLockedDb, errMessage } from './lib/sql.mjs';
import { fetchQuery } from './lib/data.mjs';

const USAGE = 'node scripts/inspect.mjs <file.csv|parquet|json> [--json] [--type csv|parquet|json] [--allow-outside]';
const SAMPLE_ROWS = 5;
const BY_EXTENSION = { '.csv': 'csv', '.tsv': 'csv', '.parquet': 'parquet', '.json': 'json', '.jsonl': 'json', '.ndjson': 'json' };

const argv = process.argv.slice(2);
const json = argv.includes('--json');
try {
  const { values, positionals } = parseCli(argv, {
    json: { type: 'boolean' },
    type: { type: 'string' },
    'allow-outside': { type: 'boolean' },
  }, USAGE);
  if (positionals.length !== 1) throw new UsageError(`expected one file; usage: ${USAGE}`);
  const file = positionals[0];
  const type = values.type ?? BY_EXTENSION[path.extname(file).toLowerCase()];
  if (!['csv', 'parquet', 'json'].includes(type)) throw new UsageError(`cannot tell the file type of ${file}; pass --type csv|parquet|json`);

  const spec = { sources: { t: { type, path: file } } };
  let db;
  try {
    db = await openLockedDb(spec, process.cwd(), { allowOutside: values['allow-outside'], folderLabel: 'working folder' });
  } catch (e) {
    throw new UsageError(e.errors?.[0]?.message ?? errMessage(e));
  }
  try {
    const { rows, columns, types } = await fetchQuery(db.conn, 'SELECT * FROM t', SAMPLE_ROWS);
    if (values.json) {
      process.stdout.write(`${JSON.stringify({ file, columns: columns.map((name, i) => ({ name, type: types[i] })), rows })}\n`);
    } else {
      const width = Math.max(...columns.map((c) => c.length));
      process.stdout.write(`file: ${path.resolve(file)}\ncolumns:\n`);
      columns.forEach((c, i) => process.stdout.write(`  ${c.padEnd(width)}  ${types[i]}\n`));
      process.stdout.write(`sample (${rows.length} rows):\n`);
      for (const r of rows) process.stdout.write(`  ${JSON.stringify(r)}\n`);
    }
  } catch (e) {
    throw new UsageError(errMessage(e));
  } finally {
    db.close();
  }
} catch (e) {
  if (!(e instanceof UsageError)) throw e;
  exitUsage(e, { json });
}

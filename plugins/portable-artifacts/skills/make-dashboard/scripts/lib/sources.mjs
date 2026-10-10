// Source file resolution. A model writes the spec, so a source path is only
// accepted when its realpath is a regular file inside the spec folder, unless
// the person running the CLI passes --allow-outside (never a spec field).
import fs from 'node:fs';
import path from 'node:path';

export const RESERVED_SOURCE_NAMES = ['main', 'temp', 'system', 'memory'];
export const FILE_TYPES = ['csv', 'parquet', 'json', 'duckdb', 'sqlite']; // take `path`
export const URL_TYPES = ['postgres', 'mysql']; // take `env`
export const SOURCE_TYPES = [...FILE_TYPES, ...URL_TYPES];
const EXTENSION_FOR = { sqlite: 'sqlite', postgres: 'postgres', mysql: 'mysql' };
// Fixed SQL for the TYPE clause: spec text is never interpolated into it.
const ATTACH_TYPE = { duckdb: '', sqlite: 'TYPE sqlite, ', postgres: 'TYPE postgres, ', mysql: 'TYPE mysql, ' };
const own = (table, key) => typeof key === 'string' && Object.hasOwn(table, key);
const READERS = { csv: 'read_csv_auto', parquet: 'read_parquet', json: 'read_json_auto' };

export const sqlLiteral = (s) => `'${String(s).replaceAll("'", "''")}'`;
export const quoteId = (s) => `"${String(s).replaceAll('"', '""')}"`;

// What model-written SQL may reference (see guard.mjs): source views and attached catalogs.
export function policyFor(spec) {
  const entries = Object.entries(spec.sources ?? {});
  const named = (isView) => new Set(entries.filter(([, src]) => own(READERS, src.type) === isView).map(([name]) => name));
  return { views: named(true), attached: named(false) };
}

// DuckDB extensions the spec's sources need, in source order, once each.
export function extensionsFor(spec) {
  const wanted = Object.values(spec.sources ?? {}).map((src) => (own(EXTENSION_FOR, src.type) ? EXTENSION_FOR[src.type] : null)).filter(Boolean);
  return [...new Set(wanted)];
}

// The statement that makes a source queryable. `resolved` is { abs } for file
// types (a checked realpath) or { url } for postgres/mysql (the env value).
export function sourceStatement(name, src, resolved) {
  const id = quoteId(name);
  if (own(READERS, src.type)) return `CREATE VIEW ${id} AS SELECT * FROM ${READERS[src.type]}(${sqlLiteral(resolved.abs)})`;
  if (!own(ATTACH_TYPE, src.type) && !URL_TYPES.includes(src.type)) throw new Error(`unknown source type ${JSON.stringify(src.type)}`);
  const target = URL_TYPES.includes(src.type) ? resolved.url : resolved.abs;
  return `ATTACH ${sqlLiteral(target)} AS ${id} (${ATTACH_TYPE[src.type]}READ_ONLY)`;
}

// path-vs-env rules the JSON Schema cannot express. env comes first so a csv
// with only `env` reports both problems in a stable order.
export function sourceShapeErrors(name, src) {
  const errors = [];
  const at = (field) => `sources.${name}.${field}`;
  const byUrl = URL_TYPES.includes(src.type);
  if (byUrl && src.path !== undefined) errors.push({ path: at('path'), message: `not allowed for type ${JSON.stringify(src.type)}; use env` });
  if (byUrl && src.env === undefined) {
    errors.push({ path: at('env'), message: `required for type ${JSON.stringify(src.type)} (the name of an environment variable holding the connection string)` });
  }
  if (!byUrl && src.env !== undefined) errors.push({ path: at('env'), message: `not allowed for type ${JSON.stringify(src.type)}; use path` });
  if (!byUrl && src.path === undefined) errors.push({ path: at('path'), message: `required for type ${JSON.stringify(src.type)}` });
  return errors.sort((a, b) => (a.path.endsWith('.env') ? -1 : 1) - (b.path.endsWith('.env') ? -1 : 1));
}

// -> { url } from the environment, or { error }. The value is never echoed.
export function envUrl(src) {
  const url = process.env[src.env];
  return url ? { url } : { error: `environment variable ${src.env} is not set` };
}


// -> { abs } (the realpath) or { error }.
export function checkSource(src, dir, { allowOutside = false, folderLabel = 'spec folder' } = {}) {
  const wanted = path.resolve(dir, src.path);
  let real;
  try {
    real = fs.realpathSync(wanted);
  } catch {
    return { error: `file not found: ${wanted}` };
  }
  if (!allowOutside) {
    const root = fs.realpathSync(dir);
    const rel = path.relative(root, real);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
      return { error: `resolves outside the ${folderLabel} (${real}); move the data under ${root} or pass --allow-outside` };
    }
  }
  if (!fs.statSync(real).isFile()) return { error: `not a regular file: ${real}` };
  return { abs: real };
}

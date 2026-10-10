// DuckDB helpers: in-memory instances (plain and locked down), a parser-backed
// SELECT-only guard, the LIMIT wrapper, and the timed runner.
import { DuckDBInstance } from '@duckdb/node-api';
import { checkSource } from './sources.mjs';

export const DEFAULT_TIMEOUT_MS = 30000;
export const sqlLiteral = (s) => `'${String(s).replaceAll("'", "''")}'`;
export const quoteId = (s) => `"${String(s).replaceAll('"', '""')}"`;

export async function openDb() {
  const instance = await DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  return {
    conn,
    close() {
      conn.closeSync?.();
      instance.closeSync?.();
    },
  };
}

const READERS = { csv: 'read_csv_auto', parquet: 'read_parquet', json: 'read_json_auto' };

// Views / attachments first, then the lockdown (attaching needs file access).
// allowed_paths pins reads to exactly the declared files; the config is then
// locked so no query can undo it. Throws an error carrying `.errors`.
export async function openLockedDb(spec, dir, { allowOutside = false, folderLabel } = {}) {
  const db = await openDb();
  try {
    const allowed = [];
    for (const [name, src] of Object.entries(spec.sources ?? {})) {
      const { abs, error } = checkSource(src, dir, { allowOutside, folderLabel });
      if (error) throw Object.assign(new Error(error), { errors: [{ path: `sources.${name}.path`, message: error }] });
      allowed.push(abs);
      await db.conn.run(src.type === 'duckdb'
        ? `ATTACH ${sqlLiteral(abs)} AS ${quoteId(name)} (READ_ONLY)`
        : `CREATE VIEW ${quoteId(name)} AS SELECT * FROM ${READERS[src.type]}(${sqlLiteral(abs)})`);
    }
    await db.conn.run(`SET allowed_paths=[${allowed.map(sqlLiteral).join(', ')}]`);
    await db.conn.run('SET enable_external_access=false');
    await db.conn.run('SET lock_configuration=true');
    return db;
  } catch (e) {
    db.close();
    throw e;
  }
}

// Cause lines of a DuckDB error, without the LINE/caret context (it points
// into our wrapped SQL, not the author's).
export function errMessage(e, maxLines = 3) {
  return String(e.message ?? e)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^LINE \d+:/.test(l) && !/^\^+$/.test(l))
    .slice(0, maxLines)
    .join(' ');
}

export async function runTimed(conn, sql, timeoutMs = DEFAULT_TIMEOUT_MS) {
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; conn.interrupt(); }, timeoutMs);
  try {
    return await conn.runAndReadAll(sql);
  } catch (e) {
    if (timedOut) throw new Error(`timed out after ${timeoutMs / 1000}s (raise it with --timeout <seconds>)`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const NOT_SELECT = 'must be a single SELECT statement';
// Functions that would let a query read local settings and paths.
const FORBIDDEN_FUNCTIONS = ['duckdb_settings', 'current_setting', 'duckdb_secrets', 'duckdb_extensions', 'getenv'];
const FORBIDDEN_RE = new RegExp(`"function_name":"(${FORBIDDEN_FUNCTIONS.join('|')})"`, 'i');

// null when `sql` is exactly one SELECT; otherwise a message for the author.
// Uses DuckDB's own parser: json_serialize_sql errors on every non-SELECT.
// (It needs a constant argument, hence the inlined literal.)
export async function checkSelect(conn, sql) {
  let text;
  try {
    const reader = await conn.runAndReadAll(`SELECT json_serialize_sql(${sqlLiteral(sql)}) AS j`);
    text = reader.getRowObjectsJS()[0].j;
  } catch (e) {
    return `SQL parse error: ${errMessage(e, 1)}`;
  }
  const parsed = JSON.parse(text);
  if (parsed.error) {
    const msg = String(parsed.error_message ?? '');
    if (/^only select statements/i.test(msg)) return NOT_SELECT;
    return `SQL parse error: ${msg.split('\n')[0]}`;
  }
  if (parsed.statements?.length !== 1) return NOT_SELECT;
  const bad = text.match(FORBIDDEN_RE);
  if (bad) return `function ${bad[1].toLowerCase()}() is not allowed (it can expose local settings and paths)`;
  return null;
}

// `sql` without trailing whitespace, semicolons and comments, so it can sit
// inside parentheses. Quote-aware: a `--` inside a string literal is kept.
export function trimTrailing(sql) {
  let end = 0;
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const two = sql.slice(i, i + 2);
    if (c === "'" || c === '"') {
      i++;
      while (i < sql.length && !(sql[i] === c && sql[i + 1] !== c)) i += sql[i] === c ? 2 : 1;
      i++;
      end = Math.min(i, sql.length);
    } else if (two === '--') {
      while (i < sql.length && sql[i] !== '\n') i++;
    } else if (two === '/*') {
      const j = sql.indexOf('*/', i + 2);
      i = j < 0 ? sql.length : j + 2;
    } else {
      if (!/\s/.test(c) && c !== ';') end = i + 1;
      i++;
    }
  }
  return sql.slice(0, end);
}

// The newline before ')' keeps a final `-- comment` from swallowing it.
export function wrapLimit(sql, n, select = '*') {
  return `SELECT ${select} FROM (${trimTrailing(sql)}\n) LIMIT ${Math.trunc(n)}`;
}

export async function describeQuery(conn, sql, timeoutMs) {
  const reader = await runTimed(conn, wrapLimit(sql, 0), timeoutMs);
  return { columns: reader.columnNames(), types: reader.columnTypes().map((t) => t.toString()) };
}

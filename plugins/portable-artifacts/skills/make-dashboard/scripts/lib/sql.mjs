// DuckDB helpers: in-memory instances (plain and locked down), a parser-backed
// SELECT-only guard, the LIMIT wrapper, and the timed runner.
import { DuckDBInstance } from '@duckdb/node-api';
import { fileURLToPath } from 'node:url';
import { checkAst } from './guard.mjs';
import {
  checkSource, extensionsFor, sourceStatement, envUrl, FILE_TYPES, sqlLiteral, quoteId,
} from './sources.mjs';

export { sqlLiteral, quoteId };
export const DEFAULT_TIMEOUT_MS = 30000;
const SETUP_SCRIPT = fileURLToPath(new URL('../setup.mjs', import.meta.url));

// Setup statements run one at a time: a string that smuggles in a second
// statement is refused instead of executed.
export async function runOne(conn, sql) {
  const { count } = await conn.extractStatements(sql);
  if (count !== 1) throw new Error(`expected exactly one statement, got ${count}`);
  return conn.run(sql);
}

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

const MIN_DERIVED_SECRET = 4; // shorter password pieces would mangle ordinary text

// Passwords inside a connection string: `//user:pa@ss@host` (up to the last @
// before the host) and password=… / password='quoted value'.
function passwordsIn(url) {
  const found = [];
  const inUrl = /\/\/[^/\s:@]*:([^\s/]*)@/.exec(url);
  if (inUrl) found.push(inUrl[1]);
  for (const m of url.matchAll(/\b(?:password|passwd|pwd)\s*=\s*(?:'([^']*)'|"([^"]*)"|([^\s;'"]+))/gi)) found.push(m[1] ?? m[2] ?? m[3]);
  // libpq splits an unescaped `pa@ss` at the first @, so error text can echo a fragment
  const pieces = found.flatMap((p) => [p, ...p.split('@')]);
  return [...new Set(pieces)].filter((p) => p.length >= MIN_DERIVED_SECRET);
}

// Replaces secrets (the env connection strings and the passwords inside them).
// With heuristics (error text) it also masks URL credentials and password=
// pairs it was not told about; result cells use exact secrets only so ordinary
// data is never rewritten. `secrets` is read at call time, so it may grow.
export function makeScrubber(secrets = [], { heuristics = true } = {}) {
  return (text) => {
    let out = String(text);
    for (const secret of secrets) if (secret) out = out.split(secret).join('<redacted>');
    if (!heuristics) return out;
    return out
      .replace(/(\/\/[^/\s:@]*:)[^\s/]*@/g, '$1<redacted>@')
      .replace(/\b(password|passwd|pwd)\s*=\s*(?:'[^']*'|"[^"]*"|[^\s;'"]+)/gi, '$1=<redacted>');
  };
}

// Attached DuckDB files may hold views and macros that run with the lockdown
// but outside the SQL guard (e.g. a view calling sqlite_scan), so only plain
// tables are accepted. Throws an error carrying `.errors`.
async function refuseViewsAndMacros(conn, name) {
  const db = sqlLiteral(name);
  const names = async (sql) => (await conn.runAndReadAll(sql)).getRowObjectsJS().map((r) => r.n);
  const found = [
    ...await names(`SELECT view_name AS n FROM duckdb_views() WHERE database_name = ${db} AND NOT internal ORDER BY 1`),
    ...await names(`SELECT DISTINCT function_name AS n FROM duckdb_functions() WHERE database_name = ${db} AND NOT internal AND function_type IN ('macro', 'table_macro') ORDER BY 1`),
  ];
  if (!found.length) return;
  const message = `attached DuckDB file defines views/macros (${found.join(', ')}), which could bypass the lockdown; export plain tables instead`;
  throw Object.assign(new Error(message), { errors: [{ path: `sources.${name}`, message }] });
}

// Where extensions are cached; the env var lets an offline machine point at a
// pre-filled directory.
export async function useExtensionDirectory(conn) {
  const dir = process.env.DUCKDB_EXTENSION_DIRECTORY;
  if (dir) await runOne(conn, `SET extension_directory=${sqlLiteral(dir)}`);
}

// Sources first (attaching needs file/network access), then the lockdown:
// allowed_paths pins file reads to exactly the declared files and the config
// is locked so no query can undo it. Extensions are only ever LOADed from the
// cache, never installed or autoloaded, so a build makes no downloads.
// Throws an error carrying `.errors`; the db it returns has `scrub` (error text)
// and `scrubData` (result cells).
export async function openLockedDb(spec, dir, { allowOutside = false, folderLabel } = {}) {
  const db = await openDb();
  const secrets = [];
  const scrub = makeScrubber(secrets);
  const scrubData = makeScrubber(secrets, { heuristics: false });
  let current = null;
  try {
    await useExtensionDirectory(db.conn);
    await runOne(db.conn, 'SET autoinstall_known_extensions=false');
    await runOne(db.conn, 'SET autoload_known_extensions=false');
    const entries = Object.entries(spec.sources ?? {});
    for (const ext of extensionsFor(spec)) {
      current = entries.find(([, src]) => src.type === ext)[0];
      try {
        await runOne(db.conn, `LOAD ${ext}`);
      } catch (e) {
        throw new Error(`the "${ext}" DuckDB extension is not installed; run: node "${SETUP_SCRIPT}" (DuckDB: ${errMessage(e, 1)})`);
      }
    }
    const allowed = [];
    for (const [name, src] of entries) {
      current = name;
      let resolved;
      if (FILE_TYPES.includes(src.type)) {
        const { abs, error } = checkSource(src, dir, { allowOutside, folderLabel });
        if (error) throw Object.assign(new Error(error), { errors: [{ path: `sources.${name}.path`, message: error }] });
        allowed.push(abs);
        resolved = { abs };
      } else {
        const { url, error } = envUrl(src);
        if (error) throw Object.assign(new Error(error), { errors: [{ path: `sources.${name}.env`, message: error }] });
        secrets.push(url, ...passwordsIn(url));
        resolved = { url };
      }
      await runOne(db.conn, sourceStatement(name, src, resolved));
      if (src.type === 'duckdb') await refuseViewsAndMacros(db.conn, name);
    }
    await runOne(db.conn, `SET allowed_paths=[${allowed.map(sqlLiteral).join(', ')}]`);
    await runOne(db.conn, 'SET enable_external_access=false');
    await runOne(db.conn, 'SET lock_configuration=true');
    return { ...db, scrub, scrubData };
  } catch (e) {
    db.close();
    if (e.errors) throw e;
    const message = errMessage(e, 3, scrub);
    throw Object.assign(new Error(message), { errors: [{ path: current ? `sources.${current}` : 'sources', message }] });
  }
}

// Cause lines of a DuckDB error, without the LINE/caret context (it points
// into our wrapped SQL, not the author's).
export function errMessage(e, maxLines = 3, scrub = (t) => t) {
  return scrub(String(e.message ?? e))
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
// Names a CTE must not take: system views/tables/table functions (bare names
// resolve to these) plus the prefixes of the extension-provided ones, which a
// plain validation connection has not loaded.
const SYSTEM_PREFIX = /^(duckdb_|pragma_|pg_|sqlite_|postgres_|mysql_|read_|information_schema)/;
const systemNameCache = new WeakMap();

async function systemNames(conn) {
  if (!systemNameCache.has(conn)) {
    const reader = await conn.runAndReadAll(
      `SELECT DISTINCT lower(n) AS n FROM (
         SELECT view_name AS n FROM duckdb_views() WHERE database_name = 'system'
         UNION ALL SELECT table_name FROM duckdb_tables() WHERE database_name = 'system'
         UNION ALL SELECT function_name FROM duckdb_functions() WHERE database_name = 'system' AND function_type IN ('table', 'table_macro', 'pragma'))`,
    );
    const names = new Set(reader.getRowObjectsJS().map((r) => r.n));
    systemNameCache.set(conn, (name) => names.has(name) || SYSTEM_PREFIX.test(name));
  }
  return systemNameCache.get(conn);
}

const NO_SOURCES = { views: new Set(), attached: new Set() };

// null when `sql` is exactly one SELECT that passes the allowlist guard
// (guard.mjs); otherwise a message for the author. Uses DuckDB's own parser:
// json_serialize_sql errors on every non-SELECT. (It needs a constant
// argument, hence the inlined literal.)
export async function checkSelect(conn, sql, policy = NO_SOURCES) {
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
  return checkAst(parsed.statements[0].node, policy, await systemNames(conn));
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

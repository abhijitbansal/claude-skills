// DuckDB helpers: in-memory instances (plain and locked down), a parser-backed
// SELECT-only guard, the LIMIT wrapper, and the timed runner.
import { DuckDBInstance } from '@duckdb/node-api';
import { fileURLToPath } from 'node:url';
import {
  checkSource, extensionsFor, sourceStatement, envUrl, FILE_TYPES, sqlLiteral, quoteId,
} from './sources.mjs';

export { sqlLiteral, quoteId };
export const DEFAULT_TIMEOUT_MS = 30000;
const SETUP_SCRIPT = fileURLToPath(new URL('../setup.mjs', import.meta.url));

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

// Replaces secrets (the env connection strings), URL credentials and
// password= pairs, so DuckDB error text can be printed safely. `secrets` is read
// at call time, so it may grow after the scrubber is made.
export function makeScrubber(secrets = []) {
  return (text) => {
    let out = String(text);
    for (const secret of secrets) if (secret) out = out.split(secret).join('<redacted>');
    return out
      .replace(/(\/\/[^/\s:@]*:)[^@\s]*@/g, '$1<redacted>@')
      .replace(/\b(password|passwd|pwd)\s*=\s*[^\s;'"]+/gi, '$1=<redacted>');
  };
}

// Where extensions are cached; the env var lets an offline machine point at a
// pre-filled directory.
export async function useExtensionDirectory(conn) {
  const dir = process.env.DUCKDB_EXTENSION_DIRECTORY;
  if (dir) await conn.run(`SET extension_directory=${sqlLiteral(dir)}`);
}

// Sources first (attaching needs file/network access), then the lockdown:
// allowed_paths pins file reads to exactly the declared files and the config
// is locked so no query can undo it. Extensions are only ever LOADed from the
// cache, never installed or autoloaded, so a build makes no downloads.
// Throws an error carrying `.errors`; the db it returns has a `scrub` function.
export async function openLockedDb(spec, dir, { allowOutside = false, folderLabel } = {}) {
  const db = await openDb();
  const secrets = [];
  const scrub = makeScrubber(secrets);
  let current = null;
  try {
    await useExtensionDirectory(db.conn);
    await db.conn.run('SET autoinstall_known_extensions=false');
    await db.conn.run('SET autoload_known_extensions=false');
    const entries = Object.entries(spec.sources ?? {});
    for (const ext of extensionsFor(spec)) {
      current = entries.find(([, src]) => src.type === ext)[0];
      try {
        await db.conn.run(`LOAD ${ext}`);
      } catch {
        throw new Error(`the "${ext}" DuckDB extension is not installed; run: node "${SETUP_SCRIPT}"`);
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
        secrets.push(url);
        resolved = { url };
      }
      await db.conn.run(sourceStatement(name, src, resolved));
    }
    await db.conn.run(`SET allowed_paths=[${allowed.map(sqlLiteral).join(', ')}]`);
    await db.conn.run('SET enable_external_access=false');
    await db.conn.run('SET lock_configuration=true');
    return { ...db, scrub };
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
// Functions that would let a query read local settings and paths.
// The sqlite/postgres/mysql bridge functions open files or connections of their
// own, outside allowed_paths and enable_external_access, so they are never allowed.
const FORBIDDEN_FUNCTIONS = ['duckdb_settings', 'current_setting', 'duckdb_secrets', 'duckdb_extensions', 'getenv', '(?:sqlite|postgres|mysql)_[a-z_]+'];
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
  if (bad) return `function ${bad[1].toLowerCase()}() is not allowed (it can expose local settings and paths or reach outside the declared sources)`;
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

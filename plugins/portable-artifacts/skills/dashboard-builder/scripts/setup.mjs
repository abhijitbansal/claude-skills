#!/usr/bin/env node
// node scripts/setup.mjs [spec.json]
// One-time, online step: INSTALL the DuckDB extensions the spec's sources need
// (all of sqlite, postgres, mysql without a spec). Builds then only LOAD them
// from the cache, so they stay offline. DUCKDB_EXTENSION_DIRECTORY overrides
// the cache location. Exit 0 ok, 1 install failed, 2 usage.
import path from 'node:path';
import { UsageError, parseCli, exitUsage } from './lib/cli.mjs';
import { loadSpec } from './lib/spec.mjs';
import { extensionsFor } from './lib/sources.mjs';
import { openDb, useExtensionDirectory, errMessage } from './lib/sql.mjs';

const USAGE = 'node scripts/setup.mjs [spec.json]';
const ALL = ['sqlite', 'postgres', 'mysql'];

try {
  const { positionals } = parseCli(process.argv.slice(2), {}, USAGE);
  if (positionals.length > 1) throw new UsageError(`expected at most one spec file; usage: ${USAGE}`);
  const needed = positionals[0] ? extensionsFor(loadSpec(positionals[0]).spec) : ALL;
  if (!needed.length) {
    process.stdout.write('this spec needs no DuckDB extensions; nothing to install\n');
  } else {
    const db = await openDb();
    try {
      await useExtensionDirectory(db.conn);
      const installed = [];
      for (const ext of needed) {
        try {
          await db.conn.run(`INSTALL ${ext}`);
        } catch (e) {
          process.stderr.write(`cannot install ${ext}: ${errMessage(e, 1)}\n`);
          process.exit(1);
        }
        const rows = (await db.conn.runAndReadAll(`SELECT install_path FROM duckdb_extensions() WHERE extension_name LIKE '${ext}%'`)).getRowObjectsJS();
        installed.push([ext, rows[0]?.install_path ?? '(installed)']);
      }
      const dir = path.dirname(installed.find(([, p]) => p.startsWith('/') || /^[A-Za-z]:/.test(p))?.[1] ?? '.');
      process.stdout.write(`extension directory: ${dir}\n`);
      for (const [ext, where] of installed) process.stdout.write(`${ext}: ${where}\n`);
    } finally {
      db.close();
    }
  }
} catch (e) {
  if (!(e instanceof UsageError)) throw e;
  exitUsage(e);
}

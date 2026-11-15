#!/usr/bin/env node
// node scripts/inspect.mjs <file.csv|parquet|json> [--type t] [--json] [--allow-outside]
// node scripts/inspect.mjs --spec dashboard.json --source <name> [--table <t>] [--json] [--allow-outside]
// Column names, types, 5 sample rows and a per-column summary (distinct count, min, max, null share), read
// through the same locked-down DuckDB and SQL allowlist as the build.
// exit 0 ok, 1 spec errors, 2 usage/IO or missing node_modules
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preflight } from '../shared/preflight.mjs';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (preflight(SKILL)) await import('./cli/inspect.mjs');

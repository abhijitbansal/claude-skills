#!/usr/bin/env node
// node scripts/setup.mjs [spec.json]
// One-time, online step: INSTALL the DuckDB extensions the spec's sources need (all of sqlite, postgres, mysql
// without a spec). Builds then only LOAD them from the cache, so they stay offline. DUCKDB_EXTENSION_DIRECTORY
// overrides the cache location. Exit 0 ok, 1 install failed, 2 usage or missing node_modules.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preflight } from '../shared/preflight.mjs';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (preflight(SKILL)) await import('./cli/setup.mjs');

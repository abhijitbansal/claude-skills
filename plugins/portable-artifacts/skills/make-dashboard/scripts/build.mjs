#!/usr/bin/env node
// node scripts/build.mjs <spec.json> [--out <dir>] [--json] [--allow-outside] [--timeout s] [--theme name] [--model m] [--effort e] [--agent a]
// Prints the page path, then its file:// URL alone on its own line.
// exit 0 ok, 1 spec/query errors, 2 usage/IO or missing node_modules
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preflight } from '../shared/preflight.mjs';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (preflight(SKILL)) await import('./cli/build.mjs');

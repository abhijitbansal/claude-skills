#!/usr/bin/env node
// node scripts/query.mjs <spec.json> --chart <id> [--limit n] [--json] [--allow-outside] [--timeout s]
// Runs one chart's query exactly as build does and prints its rows (first 20 by
// default), so a chart title can state what the rows actually show.
// exit 0 ok, 1 spec/query errors, 2 usage/IO or missing node_modules
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preflight } from '../shared/preflight.mjs';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (preflight(SKILL)) await (await import('./cli/query.mjs')).main(process.argv.slice(2));

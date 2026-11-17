#!/usr/bin/env node
// node scripts/preview.mjs <motion.json> [--open]   exit 0 stopped, 1 spec errors, 2 usage/IO or dependencies missing; --help exits 0
// A thin entry: it checks for node_modules with Node built-ins only, then loads the preview (lib/preview-cli.mjs), which
// imports ajv. Without node_modules the one line names the doctor command and the exit is 2 (shared/preflight.mjs).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preflight } from '../shared/preflight.mjs';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (preflight(SKILL_ROOT)) await (await import('./lib/preview-cli.mjs')).main(process.argv.slice(2));

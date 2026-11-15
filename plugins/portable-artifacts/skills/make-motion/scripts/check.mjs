#!/usr/bin/env node
// node scripts/check.mjs <motion.json> [--json] [--theme <name>]   exit 0 ok or skipped (no browser), 1 problems (or an invalid spec), 2 usage/IO or dependencies missing
// Seeks the real render page to every contact-sheet moment of every scene and reads each element's box and opacity from the DOM:
// safe area, overlaps, empty endings, contrast, reading time, dead stretches, small text, captions and the viral warnings.
// The rules and their wording are documented at the top of lib/check-main.mjs, which the tests import.
// A thin entry: it checks for node_modules with Node built-ins only, then loads the checker (lib/check-main.mjs), which imports
// ajv through spec.mjs. Without node_modules the one line names the doctor command and the exit is 2 (shared/preflight.mjs).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preflight } from '../shared/preflight.mjs';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (preflight(SKILL_ROOT)) process.exitCode = await (await import('./lib/check-main.mjs')).main(process.argv.slice(2));

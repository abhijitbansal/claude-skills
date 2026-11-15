#!/usr/bin/env node
// node scripts/check.mjs <dist folder | index.html> [--json] [--shots <dir>]
// Opens a built dashboard at 1280 and 390 px, in light and dark, waits for every chart to render, and fails on
// console or page errors, a chart error, a chart pane that drew nothing, or horizontal page scroll.
// --shots <dir> then writes one PNG per width (390, 1280) and colour scheme (light, dark) into <dir> through
// shared/shot.mjs and prints each path: open them and look before you report.
// No browser (playwright not installed, PA_NO_BROWSER=1): prints "check: skipped (...)" and exits 0; say so in the report.
// exit 0 ok or skipped, 1 problems, 2 usage/IO, another headless browser running, or missing node_modules
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preflight } from '../shared/preflight.mjs';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (preflight(SKILL)) await (await import('./cli/check.mjs')).main(process.argv.slice(2));

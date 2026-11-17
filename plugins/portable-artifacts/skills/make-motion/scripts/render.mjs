#!/usr/bin/env node
// node scripts/render.mjs <motion.json> [--out <file>] [--fps n] [--size WxH] [--theme <name>] [--model <m>] [--effort <e>] [--agent <a>] [--workers n|auto] [--quality draft|final] [--contact-sheet]
// Every flag, the exit codes and what each prints are described at the top of scripts/lib/render-main.mjs. Exit 0 ok, 1 a render
// failed, 2 usage/IO or dependencies missing; --help exits 0.
// A thin entry: it checks for node_modules with Node built-ins only, then loads the renderer, which imports ajv and Playwright.
// Without node_modules the one line names the doctor command and the exit is 2 (shared/preflight.mjs).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preflight } from '../shared/preflight.mjs';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (preflight(SKILL_ROOT)) await (await import('./lib/render-main.mjs')).run();

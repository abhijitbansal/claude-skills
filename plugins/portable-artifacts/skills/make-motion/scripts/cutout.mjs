#!/usr/bin/env node
// node scripts/cutout.mjs <photo.png|clip.mp4> [--out <dir>] [--fps n]
// Cuts the person out of a photo or a clip with MODNet, locally; the full description is at the top of lib/cutout-cli.mjs.
// Needs `doctor --fix cutout` (onnxruntime-node, on demand). --help exits 0.
// A thin entry: it checks for node_modules with Node built-ins only, then loads the body (lib/cutout-cli.mjs), which imports
// playwright through lib/browser.mjs. Without node_modules the one line names the doctor command and the exit is 2 (shared/preflight.mjs).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preflight } from '../shared/preflight.mjs';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (preflight(SKILL_ROOT)) await (await import('./lib/cutout-cli.mjs')).run();

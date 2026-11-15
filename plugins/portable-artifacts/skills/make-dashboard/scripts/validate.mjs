#!/usr/bin/env node
// node scripts/validate.mjs <spec.json> [--json] [--allow-outside] [--timeout s] [--bind-only]
// Runs every query and expands every chart, as build does, so valid means buildable;
// --bind-only stops after binding each query with LIMIT 0 (faster, misses value checks).
// exit 0 valid, 1 spec errors, 2 usage/IO or missing node_modules
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preflight } from '../shared/preflight.mjs';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (preflight(SKILL)) await import('./cli/validate.mjs');

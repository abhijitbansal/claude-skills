#!/usr/bin/env node
// node scripts/serve.mjs [dir] [--port n] [--open]   static server on 127.0.0.1 only, local Host headers only
// node scripts/serve.mjs --watch <spec.json> [--interval s] [--theme name] [--port n] [--open] [--allow-outside] [--timeout s] [--out dir]
//   rebuilds on change and live-reloads the page; the page on disk stays as built
// --open never crashes without an opener; PA_NO_BROWSER=1 never opens one.
// exit 2 on usage errors, when the port cannot be bound, or when node_modules is missing
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preflight } from '../shared/preflight.mjs';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (preflight(SKILL)) await import('./cli/serve.mjs');

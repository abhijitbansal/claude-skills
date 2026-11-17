#!/usr/bin/env node
// make-dashboard, the one command: check the machine, validate the spec, build the page, check it, print one report.
//   node scripts/make.mjs <spec.json> [--out <dir>] [--json] [--no-check] [--theme <name>] [--model <m>] [--effort <e>] [--agent <a>]
//                         [--allow-outside] [--timeout <seconds>]
// It runs doctor.mjs, validate.mjs, build.mjs and check.mjs as they are; see shared/make-run.mjs for the report, the exit
// codes (0, 1, 2, 130) and the stages. --out is a folder: the page is <out>/index.html. validate.mjs and build.mjs stay
// available for stepwise work.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeMain } from '../shared/make-run.mjs';

await makeMain(process.argv.slice(2), {
  skill: 'make-dashboard',
  scriptsDir: path.dirname(fileURLToPath(import.meta.url)),
  extra: [
    { name: 'allow-outside', type: 'boolean', stages: ['validate', 'build'] },
    { name: 'timeout', type: 'string', value: 'seconds', stages: ['validate', 'build'] },
  ],
});

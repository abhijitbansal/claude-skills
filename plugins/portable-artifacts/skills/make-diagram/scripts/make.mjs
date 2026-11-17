#!/usr/bin/env node
// make-diagram, the one command: check the machine, validate the spec, build the page, check it, print one report.
//   node scripts/make.mjs <spec.diagram.json> [--out <file.html|dir>] [--json] [--no-check] [--theme <name>] [--model <m>] [--effort <e>] [--agent <a>]
// It runs doctor.mjs, validate.mjs, build.mjs and check.mjs as they are; see shared/make-run.mjs for the report, the exit
// codes (0, 1, 2, 130) and the stages. validate.mjs and build.mjs stay available for stepwise work (build --format svg
// is one of them: make.mjs always writes the page).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeMain } from '../shared/make-run.mjs';

await makeMain(process.argv.slice(2), {
  skill: 'make-diagram',
  scriptsDir: path.dirname(fileURLToPath(import.meta.url)),
  extra: [],
});

#!/usr/bin/env node
// make-scene, the one command: check the machine, validate the spec, build the page, check it, print one report.
//   node scripts/make.mjs <scene.json> [--out <file.html|dir>] [--json] [--no-check] [--theme <name>] [--model <m>] [--effort <e>] [--agent <a>]
//                         [--world <world>] [--allow-outside]
// It runs doctor.mjs, validate.mjs, build.mjs and check.mjs as they are; see shared/make-run.mjs for the report, the exit
// codes (0, 1, 2, 130) and the stages. A check skipped for want of a browser or WebGL is a stage with skipped true, never
// a silent pass. validate.mjs and build.mjs stay available for stepwise work (build --fragment is one of them).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeMain } from '../shared/make-run.mjs';

await makeMain(process.argv.slice(2), {
  skill: 'make-scene',
  scriptsDir: path.dirname(fileURLToPath(import.meta.url)),
  extra: [
    { name: 'world', type: 'string', value: 'world', stages: ['build'] },
    { name: 'allow-outside', type: 'boolean', stages: ['validate', 'build'] },
  ],
});

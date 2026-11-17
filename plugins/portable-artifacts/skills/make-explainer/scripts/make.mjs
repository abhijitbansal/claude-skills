#!/usr/bin/env node
// make-explainer, the one command: check the machine, validate the spec, build the page, check it, print one report.
//   node scripts/make.mjs <explainer.json> [--out <file.html|dir>] [--json] [--no-check] [--theme <name>] [--model <m>] [--effort <e>] [--agent <a>]
//                         [--strict] [--md] [--image-api <https-endpoint>]
// It runs doctor.mjs, validate.mjs, build.mjs and check.mjs as they are; see shared/make-run.mjs for the report, the exit
// codes (0, 1, 2, 130) and the stages. A warning from validate or build (a budget, a lint, a missing generatedBy) is a
// creative finding; with --strict it is an error and so a mechanical one. validate.mjs and build.mjs stay available for
// stepwise work.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeMain } from '../shared/make-run.mjs';

await makeMain(process.argv.slice(2), {
  skill: 'make-explainer',
  scriptsDir: path.dirname(fileURLToPath(import.meta.url)),
  extra: [
    { name: 'strict', type: 'boolean', stages: ['validate', 'build'] },
    { name: 'md', type: 'boolean', stages: ['build'] },
    { name: 'image-api', type: 'string', value: 'https-endpoint', stages: ['build'] },
  ],
});

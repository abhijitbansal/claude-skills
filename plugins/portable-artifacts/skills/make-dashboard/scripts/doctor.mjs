#!/usr/bin/env node
// What this skill needs, checked before first use. Imports only built-ins and shared/.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { doctorMain, nodeVersion, nodeModules } from '../shared/doctor.mjs';

const SKILL_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

// No browser step and no keyword targets: --for takes only a spec .json (nothing here depends on it).
export const requirementsFor = () => [nodeVersion(20), nodeModules()];

await doctorMain(process.argv.slice(2), {
  skill: 'make-dashboard',
  skillDir: SKILL_DIR,
  targets: [],
  requirementsFor,
});

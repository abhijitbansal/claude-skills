#!/usr/bin/env node
// What this skill needs, checked before first use. Imports only built-ins and shared/.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL, doctorMain, nodeVersion, nodeModules, browser } from '../shared/doctor.mjs';

const SKILL_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

// Plain diagnosis needs no browser; check.mjs / --fix (ALL) do.
await doctorMain(process.argv.slice(2), {
  skill: 'make-dashboard',
  skillDir: SKILL_DIR,
  targets: ['check'],
  requirementsFor: (target) => [nodeVersion(20), nodeModules(), ...(target === 'check' || target === ALL ? [browser()] : [])],
});

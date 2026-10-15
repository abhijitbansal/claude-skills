#!/usr/bin/env node
// What this skill needs, checked before first use. Imports only built-ins and shared/ (via lib/requirements.mjs).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { doctorMain } from '../shared/doctor.mjs';
import { targets, requirementsFor } from './lib/requirements.mjs';

const SKILL_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

await doctorMain(process.argv.slice(2), { skill: 'make-diagram', skillDir: SKILL_DIR, targets, requirementsFor });

#!/usr/bin/env node
// What this skill needs, checked before first use. Imports only built-ins and shared/.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL, doctorMain, nodeVersion, nodeModules, ffmpeg, browser, kokoro } from '../shared/doctor.mjs';

const SKILL_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

// Rendering always needs ffmpeg and a browser; kokoro only for a voiceover (or --fix, which may install any).
export const requirementsFor = (target) => [
  nodeVersion(20),
  nodeModules({ omitDev: false }),
  ffmpeg(),
  browser({ required: true }),
  ...(target === 'voiceover' || target === ALL ? [kokoro()] : []),
];

await doctorMain(process.argv.slice(2), {
  skill: 'make-motion',
  skillDir: SKILL_DIR,
  targets: ['voiceover'],
  requirementsFor,
});

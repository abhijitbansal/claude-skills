#!/usr/bin/env node
// What this skill needs, checked before first use. Imports only built-ins and shared/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL, doctorMain, nodeVersion, nodeModules, sisterSkill, ffmpeg, browser } from '../shared/doctor.mjs';

const SKILL_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SECTION_SISTERS = { diagram: 'make-diagram', chart: 'make-dashboard', motion: 'make-motion' };

// Requirements a spec adds: its sister skills, plus ffmpeg when it has a motion section (make-motion renders the video).
function specNeeds(specFile) {
  let spec;
  try {
    spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
  } catch (e) {
    throw new Error(`cannot read spec ${specFile}: ${String(e.message).split('\n')[0]}`);
  }
  const types = new Set((Array.isArray(spec?.sections) ? spec.sections : []).map((s) => s?.type));
  const sisters = Object.entries(SECTION_SISTERS).filter(([t]) => types.has(t)).map(([, name]) => sisterSkill(name));
  return types.has('motion') ? [...sisters, ffmpeg()] : sisters;
}

export function requirementsFor(target) {
  const base = [nodeVersion(20), nodeModules()];
  // check.mjs needs playwright (a devDependency): a full npm ci.
  const full = [nodeVersion(20), nodeModules({ omitDev: false })];
  if (target === ALL) return [...full, browser(), ffmpeg(), ...Object.values(SECTION_SISTERS).map(sisterSkill)];
  if (target === 'check') return [...full, browser()];
  if (typeof target === 'string' && target.endsWith('.json')) return [...base, ...specNeeds(target)];
  return base;
}

await doctorMain(process.argv.slice(2), { skill: 'make-explainer', skillDir: SKILL_DIR, targets: ['check'], requirementsFor });

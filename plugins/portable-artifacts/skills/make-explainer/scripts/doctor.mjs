#!/usr/bin/env node
// What this skill needs, checked before first use. Imports only built-ins and shared/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL, doctorMain, nodeVersion, nodeModules, sisterSkill, browser } from '../shared/doctor.mjs';

const SKILL_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SECTION_SISTERS = { diagram: 'make-diagram', chart: 'make-dashboard', motion: 'make-motion' };

function sistersFor(specFile) {
  let spec;
  try {
    spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
  } catch (e) {
    throw new Error(`cannot read spec ${specFile}: ${String(e.message).split('\n')[0]}`);
  }
  const types = new Set((Array.isArray(spec?.sections) ? spec.sections : []).map((s) => s?.type));
  return Object.entries(SECTION_SISTERS).filter(([t]) => types.has(t)).map(([, name]) => sisterSkill(name));
}

function requirementsFor(target) {
  const base = [nodeVersion(20), nodeModules()];
  if (target === ALL) return [...base, browser(), ...Object.values(SECTION_SISTERS).map(sisterSkill)];
  if (target === 'check') return [...base, browser()];
  if (typeof target === 'string' && target.endsWith('.json')) return [...base, ...sistersFor(target)];
  return base;
}

await doctorMain(process.argv.slice(2), { skill: 'make-explainer', skillDir: SKILL_DIR, targets: ['check'], requirementsFor });

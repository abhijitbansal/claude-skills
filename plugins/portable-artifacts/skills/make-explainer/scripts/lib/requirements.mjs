// What this skill needs, per doctor target. Side-effect free: imports only built-ins and ../../shared/.
import fs from 'node:fs';
import path from 'node:path';
import { ALL, nodeVersion, nodeModules, devDeps, sisterSkill, ffmpeg, browser } from '../../shared/doctor.mjs';

const SECTION_SISTERS = { diagram: 'make-diagram', chart: 'make-dashboard', motion: 'make-motion' };

// make-motion renders the video: ffmpeg may be make-motion's own ffmpeg-static, and the browser is required.
const motionFfmpeg = () => ffmpeg({ staticDir: (ctx) => path.join(path.dirname(ctx.skillDir), 'make-motion', 'node_modules') });
// The browser is installed with this skill's own playwright (shared browser cache), hence dev_deps.
const motionNeeds = () => [devDeps(), motionFfmpeg(), browser({ required: true })];

// Requirements a spec adds: its sister skills, plus ffmpeg and a browser when it has a motion section.
function specNeeds(specFile) {
  let spec;
  try {
    spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
  } catch (e) {
    throw new Error(`cannot read spec ${specFile}: ${String(e.message).split('\n')[0]}`);
  }
  const types = new Set((Array.isArray(spec?.sections) ? spec.sections : []).map((s) => s?.type));
  const sisters = Object.entries(SECTION_SISTERS).filter(([t]) => types.has(t)).map(([, name]) => sisterSkill(name));
  return types.has('motion') ? [...sisters, ...motionNeeds()] : sisters;
}

export const targets = ['check'];
export function requirementsFor(target) {
  const base = [nodeVersion(20), nodeModules()];
  // check.mjs needs playwright (a devDependency) and a browser.
  if (target === ALL) return [...base, ...Object.values(SECTION_SISTERS).map(sisterSkill), ...motionNeeds()];
  if (target === 'check') return [...base, devDeps(), browser()];
  if (typeof target === 'string' && target.endsWith('.json')) return [...base, ...specNeeds(target)];
  return base;
}

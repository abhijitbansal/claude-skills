// What this skill needs, per doctor target. Side-effect free: imports only built-ins and ../../shared/.
import fs from 'node:fs';
import { ALL, nodeVersion, nodeModules, devDeps, sisterSkill, browser, builderAgent } from '../../shared/doctor.mjs';

// A lift redraws a make-diagram diagram or a make-dashboard chart, so the spec needs that sister skill installed.
function specNeeds(specFile) {
  let spec;
  try {
    spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
  } catch (e) {
    throw new Error(`cannot read spec ${specFile}: ${String(e.message).split('\n')[0]}`);
  }
  const lift = spec?.lift;
  return [lift?.diagram && sisterSkill('make-diagram'), lift?.dashboard && sisterSkill('make-dashboard')].filter(Boolean);
}

export const targets = ['check'];
export function requirementsFor(target) {
  // Optional in every target: the cheap-model agent file the SKILL.md may hand the build to.
  const base = [nodeVersion(20), nodeModules({ restore: ['dev_deps'] })];
  const agent = builderAgent();
  // check.mjs needs playwright (a devDependency) and a browser.
  const checkNeeds = [...base, devDeps({ size: '≈54 MB', required: true }), browser({ required: true })];
  // ALL also lists both sister skills, so `--fix make-diagram` works without --for.
  if (target === ALL) return [...checkNeeds, sisterSkill('make-diagram'), sisterSkill('make-dashboard'), agent];
  if (target === 'check') return [...checkNeeds, agent];
  if (typeof target === 'string' && target.endsWith('.json')) return [...base, ...specNeeds(target), agent];
  return [...base, agent];
}

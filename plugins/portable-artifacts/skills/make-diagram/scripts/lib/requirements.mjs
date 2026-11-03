// What this skill needs, per doctor target. Side-effect free: imports only built-ins and ../../shared/.
import { ALL, nodeVersion, nodeModules, devDeps, browser, builderAgent } from '../../shared/doctor.mjs';

// check.mjs (and --fix, ALL) needs playwright, a devDependency, and a browser; plain diagnosis needs neither.
// builderAgent is optional in every target: the cheap-model agent file the SKILL.md may hand the build to.
export const targets = ['check'];
export const requirementsFor = (target) => (target === 'check' || target === ALL
  ? [nodeVersion(20), nodeModules({ restore: ['dev_deps'] }), devDeps({ size: '≈118 MB', required: true }), browser({ required: true }), builderAgent()]
  : [nodeVersion(20), nodeModules({ restore: ['dev_deps'] }), builderAgent()]);

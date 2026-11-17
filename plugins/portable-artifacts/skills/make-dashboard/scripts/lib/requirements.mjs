// What this skill needs, per doctor target. Side-effect free: imports only built-ins and ../../shared/.
import { ALL, nodeVersion, nodeModules, devDeps, browser, builderAgent } from '../../shared/doctor.mjs';

// A build needs no browser. check.mjs (and --fix, ALL) needs playwright, a devDependency, and a browser.
// --for also takes a spec .json (nothing here depends on it).
// builderAgent is optional: the cheap-model agent file the SKILL.md may hand the build to.
export const targets = ['check'];
export const requirementsFor = (target) => {
  if (target === 'check' || target === ALL) {
    return [nodeVersion(20), nodeModules({ restore: ['dev_deps'] }), devDeps({ size: '≈118 MB', required: true }), browser({ required: true }), builderAgent()];
  }
  return [nodeVersion(20), nodeModules(), builderAgent()];
};

// What this skill needs, per doctor target. Side-effect free: imports only built-ins and ../../shared/.
import { ALL, nodeVersion, nodeModules, devDeps, browser } from '../../shared/doctor.mjs';

// check.mjs (and --fix, ALL) needs playwright, a devDependency, and a browser; plain diagnosis needs neither.
export const targets = ['check'];
export const requirementsFor = (target) => (target === 'check' || target === ALL
  ? [nodeVersion(20), nodeModules(), devDeps({ size: '≈118 MB', required: true }), browser({ required: true })]
  : [nodeVersion(20), nodeModules()]);

// What this skill needs, per doctor target. Side-effect free: imports only built-ins and ../../shared/.
import { nodeVersion, nodeModules } from '../../shared/doctor.mjs';

// No browser step and no keyword targets: --for takes only a spec .json (nothing here depends on it).
export const targets = [];
export const requirementsFor = () => [nodeVersion(20), nodeModules()];

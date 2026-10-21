// What this skill needs, per doctor target. Side-effect free: imports only built-ins and ../../shared/.
import { nodeVersion, nodeModules, builderAgent } from '../../shared/doctor.mjs';

// No browser step and no keyword targets: --for takes only a spec .json (nothing here depends on it).
// builderAgent is optional: the cheap-model agent file the SKILL.md may hand the build to.
export const targets = [];
export const requirementsFor = () => [nodeVersion(20), nodeModules(), builderAgent()];

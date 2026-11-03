// What this skill needs, per doctor target. Side-effect free: imports only built-ins and ../../shared/.
import fs from 'node:fs';
import path from 'node:path';
import { ALL, nodeVersion, nodeModules, devDeps, sisterSkill, ffmpeg, browser, builderAgent } from '../../shared/doctor.mjs';

const SECTION_SISTERS = { diagram: 'make-diagram', chart: 'make-dashboard', motion: 'make-motion', scene: 'make-scene' };

// make-motion renders the video: ffmpeg may be make-motion's own ffmpeg-static, and the browser is required.
const motionDir = (ctx) => path.join(path.dirname(ctx.skillDir), 'make-motion');
const motionFfmpeg = () => ffmpeg({ staticDir: (ctx) => path.join(motionDir(ctx), 'node_modules') });
// make-motion's own browser and node_modules do the rendering, so this skill's dev dependencies are not involved.
// Its id differs from this skill's own `chromium` (the check.mjs browser), so --fix can address each one.
const motionNeeds = () => [motionFfmpeg(), browser({ required: true, dir: motionDir, id: 'motion_chromium' })];

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
  const base = [nodeVersion(20), nodeModules({ restore: ['dev_deps'] })];
  // Optional in every target: the cheap-model agent file the SKILL.md may hand the build to.
  const agent = builderAgent();
  // check.mjs needs playwright (a devDependency) and a browser.
  if (target === ALL) return [...base, devDeps({ size: '≈19 MB', required: true }), browser({ required: true }), ...Object.values(SECTION_SISTERS).map(sisterSkill), ...motionNeeds(), agent];
  if (target === 'check') return [...base, devDeps({ size: '≈19 MB', required: true }), browser({ required: true }), agent];
  if (typeof target === 'string' && target.endsWith('.json')) return [...base, ...specNeeds(target), agent];
  return [...base, agent];
}

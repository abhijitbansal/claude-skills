// What this skill needs, per doctor target. Side-effect free: imports only built-ins and ../../shared/.
import { ALL, nodeVersion, nodeModules, ffmpeg, browser, kokoro, builderAgent } from '../../shared/doctor.mjs';

// Rendering always needs ffmpeg and a browser; kokoro only for a voiceover (or --fix, which may install any).
// check.mjs needs only the browser (it captures no video), so `check` leaves ffmpeg and kokoro out.
export const targets = ['check', 'voiceover'];
// Optional in every target: the cheap-model agent file the SKILL.md may hand the build to.
export const requirementsFor = (target) => (target === 'check'
  ? [nodeVersion(20), nodeModules({ omitDev: false, restore: ['kokoro'] }), browser({ required: true }), builderAgent()]
  : [
    nodeVersion(20),
    nodeModules({ omitDev: false, restore: ['kokoro'] }),
    ffmpeg(),
    browser({ required: true }),
    ...(target === 'voiceover' || target === ALL ? [kokoro()] : []),
    builderAgent(),
  ]);

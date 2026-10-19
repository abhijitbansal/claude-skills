// What this skill needs, per doctor target. Side-effect free: imports only built-ins and ../../shared/.
import { ALL, nodeVersion, nodeModules, ffmpeg, browser, kokoro } from '../../shared/doctor.mjs';

// Rendering always needs ffmpeg and a browser; kokoro only for a voiceover (or --fix, which may install any).
// check.mjs needs only the browser (it captures no video), so `check` leaves ffmpeg and kokoro out.
export const targets = ['check', 'voiceover'];
export const requirementsFor = (target) => (target === 'check'
  ? [nodeVersion(20), nodeModules({ omitDev: false }), browser({ required: true })]
  : [
    nodeVersion(20),
    nodeModules({ omitDev: false }),
    ffmpeg(),
    browser({ required: true }),
    ...(target === 'voiceover' || target === ALL ? [kokoro()] : []),
  ]);

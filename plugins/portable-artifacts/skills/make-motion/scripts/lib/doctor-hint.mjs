// The command that runs this skill's doctor, for error hints. Real path, quoted for this platform.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { quoteArg, defaultCtx, onDemandHint } from '../../shared/doctor.mjs';

export const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DOCTOR = path.join(SKILL_DIR, 'scripts/doctor.mjs');
const PREFIX = quoteArg(SKILL_DIR);

export const doctorCommand = (...args) => ['node', quoteArg(DOCTOR), ...args].join(' ');
// The doctor's own step for each on-demand package (kokoro-js, onnxruntime-node, ffmpeg-static), not a command of the script's
// own: all three are `npm install <pin> --no-save`, which npm turns into "remove everything not named", so a hint that names
// one pin deletes the others. onDemandHint names the installed siblings too and runs from the skill folder, exactly as `--fix <id>`.
export const npmInstallKokoro = () => onDemandHint('kokoro', defaultCtx(SKILL_DIR));
export const npmInstallCutout = () => onDemandHint('cutout', defaultCtx(SKILL_DIR));
export const npmInstallFfmpegStatic = () => onDemandHint('ffmpeg-static', defaultCtx(SKILL_DIR));
export const npxInstallChromium = () => `npx --no --prefix ${PREFIX} playwright install chromium`;

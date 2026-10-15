// The command that runs this skill's doctor, for error hints. Real path, quoted for this platform.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { quoteArg, KOKORO_PIN } from '../../shared/doctor.mjs';

export const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DOCTOR = path.join(SKILL_DIR, 'scripts/doctor.mjs');
const PREFIX = quoteArg(SKILL_DIR);

export const doctorCommand = (...args) => ['node', quoteArg(DOCTOR), ...args].join(' ');
export const npmInstallKokoro = () => `npm install ${KOKORO_PIN} --no-save --prefix ${PREFIX}`;
export const npmInstallFfmpegStatic = () => `npm i ffmpeg-static --no-save --prefix ${PREFIX}`;
export const npxInstallChromium = () => `npx --no --prefix ${PREFIX} playwright install chromium`;

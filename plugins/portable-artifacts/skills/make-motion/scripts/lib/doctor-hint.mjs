// The command that runs this skill's doctor, for error hints. Real path, quoted for this platform.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { quoteArg, render, optionalInstallArgv } from '../../shared/doctor.mjs';

export const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DOCTOR = path.join(SKILL_DIR, 'scripts/doctor.mjs');
const PREFIX = quoteArg(SKILL_DIR);

export const doctorCommand = (...args) => ['node', quoteArg(DOCTOR), ...args].join(' ');
// What `doctor --fix <id>` runs for the optional voice ('kokoro') or cutout ('cutout') stack: npm ci into its own locked folder.
export const optionalInstall = (id) => render([optionalInstallArgv({ platform: process.platform, skillDir: SKILL_DIR }, id)], process.platform);
export const npxInstallChromium = () => `npx --no --prefix ${PREFIX} playwright install chromium`;

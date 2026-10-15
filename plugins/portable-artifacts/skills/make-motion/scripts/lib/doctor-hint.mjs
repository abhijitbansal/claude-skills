// The command that runs this skill's doctor, for error hints. Real path, quoted for this platform.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { quoteArg } from '../../shared/doctor.mjs';

export const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DOCTOR = path.join(SKILL_DIR, 'scripts/doctor.mjs');

export const doctorCommand = (...args) => ['node', quoteArg(DOCTOR), ...args].join(' ');
export const npmInstallKokoro = () => `npm install kokoro-js@1.2.1 --no-save --prefix ${quoteArg(SKILL_DIR)}`;

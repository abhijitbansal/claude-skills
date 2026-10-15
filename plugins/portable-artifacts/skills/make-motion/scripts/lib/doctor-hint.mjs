// The command that runs this skill's doctor, for error hints. Real path, quoted when it holds spaces or shell metacharacters.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCTOR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../doctor.mjs');
const quote = (p) => (/^[A-Za-z0-9_@%+=:,./\\-]+$/.test(p) ? p : process.platform === 'win32' ? `"${p}"` : `'${p.replace(/'/g, "'\\''")}'`);

export const doctorCommand = (...args) => ['node', quote(DOCTOR), ...args].join(' ');

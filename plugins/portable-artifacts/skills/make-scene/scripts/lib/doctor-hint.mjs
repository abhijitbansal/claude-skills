// The skip hint for check.mjs: names the doctor (real quoted path, --for check) and the requirement id to fix.
// Ids: `dev_deps` when playwright itself is missing, `chromium` when only the browser is.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { quoteArg } from '../../shared/doctor.mjs';

const DOCTOR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../doctor.mjs');

export const doctorCommand = (...args) => ['node', quoteArg(DOCTOR), ...args].join(' ');
export const skipHint = (reason = '') => {
  const id = /playwright is not installed/.test(reason) ? 'dev_deps' : 'chromium';
  return `ask the user, then run: ${doctorCommand('--for', 'check', '--fix', id)}`;
};

// Sibling skills (make-diagram, make-dashboard, make-motion) live in directories
// next to make-explainer on every install path. Resolved and loaded lazily; a
// missing one is a SiblingError carrying the exact install command.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const SELF_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NAME = /^[a-z][a-z0-9-]*$/;

export class SiblingError extends Error {
  constructor(message, command) {
    super(message);
    this.name = 'SiblingError';
    this.command = command;
  }
}

export const installCommand = (names) => `npx skills add abhijitbansal/claude-skills --skill make-explainer ${names.join(' ')}`;
export const MISSING_HINT = (names) => `install it with: ${installCommand(names)}`;
// Points at the doctor, which can install it for the user once they agree; its id for a sister skill is the skill name.
const shellQuote = (p) => (/^[A-Za-z0-9_@%+=:,./\\-]+$/.test(p) ? p : process.platform === 'win32' ? `"${p}"` : `'${p.replace(/'/g, "'\\''")}'`);
export const doctorHint = (id) => `(doctor: node ${shellQuote(path.join(SELF_DIR, 'scripts/doctor.mjs'))}, id ${id})`;

// Absolute path of the sibling skill folder. Does not check that it exists.
export function siblingDir(name) {
  if (!NAME.test(name)) throw new TypeError(`sibling name must be a plain skill name, got ${JSON.stringify(name)}`);
  return path.resolve(SELF_DIR, '..', name);
}

// Import a module (e.g. 'scripts/lib/api.mjs') from a sibling skill.
export async function loadSibling(name, relModule) {
  const dir = siblingDir(name);
  const file = path.resolve(dir, relModule);
  const rel = path.relative(dir, file);
  if (!rel || path.isAbsolute(relModule) || path.isAbsolute(rel) || rel === '..' || rel.startsWith(`..${path.sep}`)) {
    throw new TypeError(`module path must name a file inside the sibling skill, got ${JSON.stringify(relModule)}`);
  }
  if (!fs.existsSync(file)) {
    const where = fs.existsSync(dir) ? `${name}/${relModule} not found in ${dir}` : `${name} skill not found next to make-explainer (looked in ${dir})`;
    throw new SiblingError(`${where}; ${MISSING_HINT([name])} ${doctorHint(name)}`, installCommand([name]));
  }
  try {
    return await import(pathToFileURL(file).href);
  } catch (e) {
    // The folder is there but its npm dependencies are not: say so, with the fix, instead of a raw module error.
    const missing = e?.code === 'ERR_MODULE_NOT_FOUND' ? /Cannot find package '([^']+)' imported from (.+)$/.exec(e.message) : null;
    if (!missing || !path.resolve(missing[2]).startsWith(`${dir}${path.sep}`)) throw e;
    throw new SiblingError(`${name} is installed but its dependencies are missing (${missing[1]}); run "npm ci" in ${dir}, or ${MISSING_HINT([name])} ${doctorHint(name)}`, installCommand([name]));
  }
}

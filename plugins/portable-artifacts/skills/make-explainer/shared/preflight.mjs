// Entry-script preflight. Node built-ins and sibling shared files only: it must run before the skill's node_modules
// exists (or while it is only partly there). An entry script that statically imports a validator (which imports ajv) dies at link time with a raw
// ERR_MODULE_NOT_FOUND stack and exit 1; calling this first and importing the heavy modules afterwards turns that into
// one line that names the doctor command, exit 2.
//
//   import { preflight } from '../shared/preflight.mjs';
//   if (preflight(SKILL_ROOT)) await (await import('./lib/main.mjs')).main(process.argv.slice(2));
//
// It sets process.exitCode and returns false on a miss (never process.exit(): that can SIGSEGV after a pipe write on
// Node 24.7), so the caller just skips the rest. It also prints the stale-copy warning, first and always, so that
// warning fires in the case it was written for: an old plugin-cache copy that has no node_modules.
import fs from 'node:fs';
import path from 'node:path';
import { exitUsage } from './cli.mjs';
import { quoteArg } from './doctor.mjs';
import { warnIfStaleCopy } from './stale-copy.mjs';

/** The command that installs this skill's npm packages, quoted for this platform. */
export function doctorCommand(skillRoot) {
  return `node ${quoteArg(path.join(skillRoot, 'scripts', 'doctor.mjs'))} --fix node_modules`;
}

// The names under "dependencies" in the skill's package.json that have no folder with a package.json in its node_modules.
// A skill whose package.json cannot be read lists none: the folder check alone is what remains.
function missingPackages(skillRoot, exists) {
  let names;
  try {
    names = Object.keys(JSON.parse(fs.readFileSync(path.join(skillRoot, 'package.json'), 'utf8')).dependencies ?? {});
  } catch {
    return [];
  }
  return names.filter((name) => !exists(path.join(skillRoot, 'node_modules', name, 'package.json')));
}

/**
 * true when the skill's node_modules is there and holds every package the skill's package.json lists under
 * "dependencies" (a folder alone is not enough: an aborted npm ci leaves a partial one). Otherwise prints one line (JSON
 * on stdout under --json, text on stderr), sets exitCode 2 and returns false.
 * Options (tests): argv, scriptPath (default process.argv[1]), exists, warn (default warnIfStaleCopy).
 */
export function preflight(skillRoot, { argv = process.argv.slice(2), scriptPath = process.argv[1], exists = fs.existsSync, warn = warnIfStaleCopy } = {}) {
  warn(scriptPath);
  const present = exists(path.join(skillRoot, 'node_modules'));
  const missing = present ? missingPackages(skillRoot, exists) : [];
  if (present && missing.length === 0) return true;
  const what = present ? `node_modules in ${skillRoot} lacks ${missing.join(', ')}` : `no node_modules in ${skillRoot}`;
  exitUsage(new Error(`dependencies are not installed (${what}); run: ${doctorCommand(skillRoot)}`), { json: argv.includes('--json') });
  return false;
}

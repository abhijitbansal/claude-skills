// Entry-script preflight. Node built-ins and sibling shared files only: it must run before the skill's node_modules
// exists. An entry script that statically imports a validator (which imports ajv) dies at link time with a raw
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

/**
 * true when the skill's node_modules is there. Otherwise prints one line (JSON on stdout under --json, text on
 * stderr), sets exitCode 2 and returns false.
 * Options (tests): argv, scriptPath (default process.argv[1]), exists, warn (default warnIfStaleCopy).
 */
export function preflight(skillRoot, { argv = process.argv.slice(2), scriptPath = process.argv[1], exists = fs.existsSync, warn = warnIfStaleCopy } = {}) {
  warn(scriptPath);
  if (exists(path.join(skillRoot, 'node_modules'))) return true;
  const message = `dependencies are not installed (no node_modules in ${skillRoot}); run: ${doctorCommand(skillRoot)}`;
  exitUsage(new Error(message), { json: argv.includes('--json') });
  return false;
}

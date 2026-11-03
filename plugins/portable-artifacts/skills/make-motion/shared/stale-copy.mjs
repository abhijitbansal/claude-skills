// Warns when a build runs from an old plugin-cache copy.
// The incident shape: a session runs ~/.claude/plugins/cache/<marketplace>/portable-artifacts/<old>/skills/<skill>/scripts/…
// while ~/.claude/plugins/installed_plugins.json points at a newer folder, so the page comes out of the old code
// (or the old copy has no node_modules). The check compares paths only: silent outside the plugin cache (a repo
// checkout, `npx skills add`), and silent whenever installed_plugins.json is missing, unreadable or has no usable entry.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PLUGIN_KEY = 'portable-artifacts@claude-skills';
const DEFAULT_SKILL = 'make-explainer';
// <marketplace>/<plugin>/<version> under the cache root
const COPY_SEGMENTS = 3;

const within = (child, parent) => child === parent || child.startsWith(parent + path.sep);

function installPaths(home, readFile) {
  let parsed;
  try {
    parsed = JSON.parse(readFile(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), 'utf8'));
  } catch {
    return [];
  }
  const entries = parsed?.plugins?.[PLUGIN_KEY];
  if (!Array.isArray(entries)) return [];
  return entries.map((e) => e?.installPath).filter((p) => typeof p === 'string' && p !== '').map((p) => path.resolve(p));
}

export function staleCopyWarning({ scriptPath, home = os.homedir(), readFile = fs.readFileSync }) {
  const script = path.resolve(scriptPath);
  const cacheRoot = path.join(home, '.claude', 'plugins', 'cache');
  if (!within(script, cacheRoot)) return null;
  const installs = installPaths(home, readFile);
  if (installs.length === 0 || installs.some((p) => within(script, p))) return null;
  const segments = path.relative(cacheRoot, script).split(path.sep);
  const running = path.join(cacheRoot, ...segments.slice(0, COPY_SEGMENTS));
  const at = segments.indexOf('skills');
  const skill = at >= 0 && segments[at + 1] ? segments[at + 1] : DEFAULT_SKILL;
  const skillDir = path.join(installs[0], 'skills', skill);
  const doctor = path.join(skillDir, 'scripts', 'doctor.mjs');
  return `warning: this script runs from ${running}, not the installed copy ${installs[0]}; run npm ci in ${skillDir} (or node ${doctor} --fix node_modules), then use that copy`;
}

// Never throws and never changes an exit code: a diagnostic must not break a build.
export function warnIfStaleCopy(argv1 = process.argv[1], { stderr = process.stderr } = {}) {
  try {
    if (!argv1) return;
    const line = staleCopyWarning({ scriptPath: argv1 });
    if (line) stderr.write(`${line}\n`);
  } catch {}
}

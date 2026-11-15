// Where the on-demand models (the Kokoro voice, about 90 MB; the MODNet matte, 25 MB) are kept. A plugin update puts the skill in
// a new folder and the old one's .cache goes with it, so the models live in a per-user folder that outlives the version:
// $CLAUDE_PLUGIN_DATA, else the OS cache folder, else <skill>/.cache (shared/doctor.mjs stableCacheDir).
// An install that already downloaded them into <skill>/.cache/models keeps using that copy until the stable folder exists,
// so this never causes a second download.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stableCacheDir } from '../../shared/doctor.mjs';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The `models` folder for a skill at `skillDir`. `options` (env, platform, homedir) are for tests. */
export function modelsDir(skillDir = SKILL_ROOT, options = {}) {
  const stable = path.join(stableCacheDir({ skillDir, ...options }), 'models');
  const legacy = path.join(skillDir, '.cache', 'models');
  return existsSync(stable) || !existsSync(legacy) ? stable : legacy;
}

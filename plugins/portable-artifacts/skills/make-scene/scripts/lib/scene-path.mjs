// Where a built scene page goes: shared/output.mjs's rule (--out, else $PA_OUTPUT_DIR, else <git root>/.scratch for a
// spec inside a repository, else ~/.agent/diagrams), with the slug "scene" when the title leaves nothing.
// Built-ins and shared/ only, so build.mjs can load it before the skill's node_modules is known to exist.
import os from 'node:os';
import { resolveOutput } from '../../shared/output.mjs';

/** Absolute .html path for a build: `out` (a .html file, or a folder), else the shared default for `specPath`; always <slug-of-title>.html in a folder. */
export function resolveScenePath({ out, title, specPath, env = process.env, home = os.homedir() }) {
  return resolveOutput({ out, title, fallback: 'scene', specPath, env, home });
}

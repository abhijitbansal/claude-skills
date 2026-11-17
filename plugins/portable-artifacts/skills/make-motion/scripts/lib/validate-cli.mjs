// The body of scripts/validate.mjs, imported only after its preflight found node_modules (it imports ajv through spec.mjs).
import { loadSpec, validateSpec, withDefaults, UsageError as SpecUsageError } from './spec.mjs';
import { normalizeTransition } from '../../template/transitions.mjs';
import { glFallback } from '../../template/gl-transitions.mjs';
import { printResult } from '../../shared/errors.mjs';
import { UsageError, parseCli, exitUsage, evalLog } from '../../shared/cli.mjs';

const USAGE = 'node scripts/validate.mjs <motion.json> [--json]';
const OPTIONS = { json: { type: 'boolean' } };

// A valid spec with a GL transition (gl-ripple, gl-cube): a render draws it with a shader, the preview and check.mjs cannot,
// so each is told what stands in for it. Notes on stderr, after the verdict; --json output is unchanged.
function glNotes(spec) {
  return withDefaults(spec).scenes.flatMap((scene, si) => {
    const { type, direction } = normalizeTransition(scene.transition);
    const fallback = si > 0 ? glFallback(type) : null;
    if (!fallback) return [];
    const stands = direction && fallback === 'push' ? `a ${fallback} (direction "${direction}")` : `a ${fallback}`;
    return [`note: scenes[${si}].transition: ${type} is drawn by WebGL in a render; the preview and check.mjs show ${stands} instead\n`];
  });
}

/** Validates the spec named in `argv`; sets process.exitCode (0 valid, 1 spec errors, 2 usage or I/O) and never exits itself. */
export function main(argv) {
  const json = argv.includes('--json');
  try {
    const { values, positionals } = parseCli(argv, OPTIONS, USAGE);
    if (positionals.length !== 1) throw new UsageError(`expected one spec file; usage: ${USAGE}`);
    const { spec, dir } = loadSpec(positionals[0]);
    const result = validateSpec(spec, { dir });
    printResult(result, { json: values.json === true, label: positionals[0] });
    if (result.ok && !json) for (const note of glNotes(spec)) process.stderr.write(note);
    evalLog(result.ok, result.errors.length);
    process.exitCode = result.ok ? 0 : 1;
  } catch (e) {
    if (!(e instanceof UsageError || e instanceof SpecUsageError)) throw e;
    exitUsage(e, { json });
  }
}

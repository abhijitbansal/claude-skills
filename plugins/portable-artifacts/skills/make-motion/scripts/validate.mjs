#!/usr/bin/env node
// node scripts/validate.mjs <motion.json> [--json]   exit 0 ok, 1 spec errors, 2 usage/IO
import { appendFileSync } from 'node:fs';
import { loadSpec, validateSpec, withDefaults, UsageError } from './lib/spec.mjs';
import { normalizeTransition } from '../template/transitions.mjs';
import { glFallback } from '../template/gl-transitions.mjs';
import { printResult } from '../shared/errors.mjs';

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

const args = process.argv.slice(2);
const json = args.includes('--json');
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  process.stderr.write('usage: node scripts/validate.mjs <motion.json> [--json]\n');
  process.exit(2);
}
try {
  const { spec, dir } = loadSpec(file);
  const result = validateSpec(spec, { dir });
  printResult(result, { json, label: file });
  if (result.ok && !json) for (const note of glNotes(spec)) process.stderr.write(note);
  if (process.env.EVAL_LOG) {
    appendFileSync(process.env.EVAL_LOG, `${JSON.stringify({ ts: new Date().toISOString(), ok: result.ok, errors: result.errors.length })}\n`);
  }
  process.exit(result.ok ? 0 : 1);
} catch (e) {
  if (!(e instanceof UsageError)) throw e;
  process.stderr.write(`${e.message}\n`);
  process.exit(2);
}

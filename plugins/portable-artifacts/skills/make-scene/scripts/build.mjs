#!/usr/bin/env node
// node scripts/build.mjs <scene.json> [--out <file.html|dir>] [--theme <name>] [--world <world>] [--fragment] [--model <m>] [--effort <e>] [--agent <a>] [--allow-outside] [--json]
// Validates, builds the scene graph and writes one offline HTML page, then prints the alternatives table.
// Output: --out file.html, --out dir (-> dir/<slug>.html), else $PA_OUTPUT_DIR, else <git root>/.scratch for a spec inside
// a git repo, else ~/.agent/diagrams. Prints `wrote <path>` and then the file:// URL on its own line.
// --world W switches the world (checked against the data first) and rewrites the world field of scene.json.
// --fragment writes <slug>.fragment.html instead: the scene's css, host, runtime and mount call, to paste into another page.
// Spec warnings (never a failure) go to stderr as `path: warning: message`, or under --json into `warnings`.
// exit 0 ok, 1 spec errors, 2 usage/IO or dependencies not installed (the doctor command is named)
//
// Imports only built-ins and shared/ up here: the heavy modules (ajv, the runtime bundle) load through lib/build-run.mjs
// after preflight has found node_modules, so a missing install is one clear line, not an ERR_MODULE_NOT_FOUND stack.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError, parseCli, exitUsage } from '../shared/cli.mjs';
import { printResult } from '../shared/errors.mjs';
import { fileUrlLine, scratchIgnoreNote } from '../shared/output.mjs';
import { preflight } from '../shared/preflight.mjs';
import { PROVENANCE_OPTIONS } from '../shared/provenance.mjs';
import { exitInternal } from './lib/internal-error.mjs';

export { resolveScenePath } from './lib/scene-path.mjs';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'node scripts/build.mjs <scene.json> [--out <file.html|dir>] [--theme <name>] [--world <world>] [--fragment] [--model <m>] [--effort <e>] [--agent <a>] [--allow-outside] [--json]';
const OPTIONS = {
  out: { type: 'string' },
  theme: { type: 'string' },
  world: { type: 'string' },
  fragment: { type: 'boolean' },
  'allow-outside': { type: 'boolean' },
  json: { type: 'boolean' },
  ...PROVENANCE_OPTIONS,
};

/**
 * Build the page for a spec file. Returns { ok: true, out, bytes, world, alternatives, table, rewroteSpec, warnings } after
 * writing it, else { ok: false, errors }. See lib/build-run.mjs.
 */
export async function build(file, options) {
  const { build: run } = await import('./lib/build-run.mjs');
  return run(file, options);
}

function reportBuilt(result, { json }) {
  const warnings = result.warnings ?? [];
  if (json) {
    const body = { ok: true, out: result.out, bytes: result.bytes, world: result.world, alternatives: result.alternatives, ...(result.fragment ? { fragment: true } : {}) };
    process.stdout.write(`${JSON.stringify(warnings.length > 0 ? { ...body, warnings } : body)}\n`);
    return;
  }
  const note = result.rewroteSpec ? `scene.json: world set to ${result.world}\n` : '';
  process.stdout.write(`${note}wrote ${result.out}\n${fileUrlLine(result.out)}\n${result.table ? `\n${result.table}\n` : ''}`);
  for (const w of warnings) process.stderr.write(`${w.path || '(root)'}: warning: ${w.message}\n`);
  const scratch = scratchIgnoreNote(result.out);
  if (scratch) process.stderr.write(`${scratch}\n`);
}

async function main(argv) {
  let json = argv.includes('--json');
  try {
    const { values, positionals } = parseCli(argv, OPTIONS, USAGE);
    json = values.json === true;
    if (positionals.length !== 1) throw new UsageError(`expected one spec file; usage: ${USAGE}`);
    if (!preflight(SKILL_ROOT, { argv })) return;
    const result = await build(positionals[0], {
      out: values.out, theme: values.theme, world: values.world, model: values.model, effort: values.effort, agent: values.agent, fragment: values.fragment === true, allowOutside: values['allow-outside'],
    });
    if (!result.ok) {
      printResult(result, { json, label: positionals[0] });
      process.exitCode = 1;
      return;
    }
    reportBuilt(result, { json });
  } catch (e) {
    if (e instanceof UsageError) exitUsage(e, { json });
    else exitInternal(e, { json });
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));

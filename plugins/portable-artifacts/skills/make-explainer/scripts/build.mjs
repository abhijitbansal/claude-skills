#!/usr/bin/env node
// node scripts/build.mjs <explainer.json> [--out <file.html|dir>] [--theme <name>] [--strict] [--md] [--image-api <https-endpoint>] [--model <m>] [--effort <e>] [--agent <a>] [--json]
// Validates, renders and writes one offline HTML page (plus <slug>.assets/ when a section needs files).
// --strict turns the section and page length caps into errors (a validate warning otherwise).
// --md also writes the markdown twin of the spec's checklist sections next to the page (<name>.md).
// --image-api <https-endpoint> (optional, off by default): sends the title and subtitle to that endpoint with the key in
// PA_IMAGE_API_KEY and uses the returned picture as the page hero. A failure there fails the build (exit 2).
// Output: --out file.html, --out dir (-> dir/<slug>.html), else $PA_OUTPUT_DIR, else <git root>/.scratch for a spec
// inside a git repo, else ~/.agent/diagrams. Prints `wrote <path>` and then the file:// URL on its own line.
// exit 0 ok, 1 spec errors, 2 usage/IO or dependencies not installed (the doctor command is named)
//
// Imports only built-ins and shared/ up here: the heavy modules (ajv) load through lib/build-run.mjs after preflight
// has found node_modules, so a missing install is one clear line, not an ERR_MODULE_NOT_FOUND stack.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError, parseCli } from '../shared/cli.mjs';
import { PROVENANCE_OPTIONS } from '../shared/provenance.mjs';
import { preflight } from '../shared/preflight.mjs';
import { fileUrlLine, scratchIgnoreNote } from '../shared/output.mjs';
import { exitSpecUsage } from './lib/usage-exit.mjs';
import { ImageHookError } from './lib/image-hook.mjs';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'node scripts/build.mjs <explainer.json> [--out <file.html|dir>] [--theme <name>] [--strict] [--md] [--image-api <https-endpoint>] [--model <m>] [--effort <e>] [--agent <a>] [--json]';
const OPTIONS = { out: { type: 'string' }, theme: { type: 'string' }, strict: { type: 'boolean' }, md: { type: 'boolean' }, 'image-api': { type: 'string' }, json: { type: 'boolean' }, ...PROVENANCE_OPTIONS };

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Build the page for a spec file. Returns { ok: true, out, md, theme, assets, bytes, warnings } after
 * writing it, else { ok: false, errors } (nothing is written).
 */
export async function build(file, options) {
  const { build: run } = await import('./lib/build-run.mjs');
  return run(file, options);
}

function printFailure(result, { json, label }) {
  if (json) {
    process.stdout.write(`${JSON.stringify({ ok: false, errors: result.errors })}\n`);
    return;
  }
  for (const e of result.errors) process.stdout.write(`${e.path || '(root)'}: ${e.message}\n`);
  process.stdout.write(`${label}: ${plural(result.errors.length, 'error')}\n`);
}

function printBuilt(result, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify({ ok: true, out: result.out, ...(result.md ? { md: result.md } : {}), theme: result.theme, assets: result.assets, bytes: result.bytes, warnings: result.warnings })}\n`);
    return;
  }
  for (const w of result.warnings) process.stdout.write(`${w.path || '(root)'}: warning: ${w.message}\n`);
  process.stdout.write(`theme: ${result.theme}\nwrote ${result.out}\n`);
  if (result.md) process.stdout.write(`wrote ${result.md}\n`);
  process.stdout.write(`${fileUrlLine(result.out)}\n`);
  const note = scratchIgnoreNote(result.out);
  if (note) process.stderr.write(`${note}\n`);
}

async function main(argv) {
  let json = argv.includes('--json');
  try {
    const { values, positionals } = parseCli(argv, OPTIONS, USAGE);
    json = values.json === true;
    if (positionals.length !== 1) throw new UsageError(`expected one spec file; usage: ${USAGE}`);
    if (!preflight(SKILL_ROOT, { argv })) return;
    const result = await build(positionals[0], { out: values.out, theme: values.theme, imageApi: values['image-api'], strict: values.strict === true, md: values.md === true, model: values.model, effort: values.effort, agent: values.agent });
    if (!result.ok) {
      printFailure(result, { json, label: positionals[0] });
      process.exitCode = 1;
      return;
    }
    printBuilt(result, json);
  } catch (e) {
    if (!(e instanceof UsageError || e instanceof ImageHookError)) throw e;
    exitSpecUsage(e, { json });
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));

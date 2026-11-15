#!/usr/bin/env node
// node scripts/build.mjs <spec.diagram.json> [--out <file.html|dir>] [--theme <name>] [--format html|svg] [--model <m>] [--effort <e>] [--agent <a>] [--json]
// Validates (layout and geometry lint included), draws and writes one offline HTML page, or with --format svg one
// standalone SVG (the theme's light palette only: an .svg file has one palette).
// Output: --out file.html (file.svg), --out dir (-> dir/<slug>.html), else $PA_OUTPUT_DIR, else <git root>/.scratch for a
// spec inside a git repo, else ~/.agent/diagrams. Prints `wrote <path>` and then the file:// URL on its own line.
// Spec warnings (never a failure) go to stderr as `path: warning: message`, or under --json into `warnings`.
// exit 0 ok, 1 spec errors, 2 usage/IO or dependencies not installed (the doctor command is named)
//
// Imports only built-ins and shared/ up here: the heavy modules (ajv, ELK) load through lib/build-page.mjs after
// preflight has found node_modules, so a missing install is one clear line, not an ERR_MODULE_NOT_FOUND stack.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError, parseCli, exitUsage } from '../shared/cli.mjs';
import { printResult } from '../shared/errors.mjs';
import { PROVENANCE_OPTIONS } from '../shared/provenance.mjs';
import { preflight } from '../shared/preflight.mjs';
import { fileUrlLine, scratchIgnoreNote } from '../shared/output.mjs';
import { exitInternal } from './lib/internal-error.mjs';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FORMATS = ['html', 'svg'];
const USAGE = 'node scripts/build.mjs <spec.diagram.json> [--out <file.html|dir>] [--theme <name>] [--format html|svg] [--model <m>] [--effort <e>] [--agent <a>] [--json]';
const OPTIONS = { out: { type: 'string' }, theme: { type: 'string' }, format: { type: 'string' }, json: { type: 'boolean' }, ...PROVENANCE_OPTIONS };

/** Build the page for a spec file. Returns { ok: true, out, warnings } after writing it, else { ok: false, errors }. */
export async function build(file, options) {
  const { build: run } = await import('./lib/build-page.mjs');
  return run(file, options);
}

function reportBuilt(result, { json }) {
  const warnings = result.warnings ?? [];
  if (json) {
    process.stdout.write(`${JSON.stringify(warnings.length > 0 ? { ok: true, out: result.out, warnings } : { ok: true, out: result.out })}\n`);
    return;
  }
  process.stdout.write(`wrote ${result.out}\n${fileUrlLine(result.out)}\n`);
  for (const w of warnings) process.stderr.write(`${w.path || '(root)'}: warning: ${w.message}\n`);
  const note = scratchIgnoreNote(result.out);
  if (note) process.stderr.write(`${note}\n`);
}

async function main(argv) {
  let json = argv.includes('--json');
  try {
    const { values, positionals } = parseCli(argv, OPTIONS, USAGE);
    json = values.json === true;
    if (positionals.length !== 1) throw new UsageError(`expected one spec file; usage: ${USAGE}`);
    if (values.format !== undefined && !FORMATS.includes(values.format)) throw new UsageError(`--format must be one of: ${FORMATS.join(', ')}; got ${JSON.stringify(values.format)}`);
    if (!preflight(SKILL_ROOT, { argv })) return;
    const result = await build(positionals[0], { out: values.out, theme: values.theme, format: values.format, model: values.model, effort: values.effort, agent: values.agent });
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

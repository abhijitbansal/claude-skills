#!/usr/bin/env node
// node scripts/build.mjs <explainer.json> [--out <file.html|dir>] [--theme <name>] [--json]
// Validates, renders and writes one offline HTML page (plus <slug>.assets/ when a section needs files).
// Output: --out file.html, --out dir (-> dir/<slug>.html), else ${PA_OUTPUT_DIR or ~/.agent/diagrams}/<slug>.html.
// exit 0 ok, 1 spec errors, 2 usage/IO
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadSpec, validateSpec } from './lib/spec.mjs';
import { buildPage, BuildError } from './lib/page.mjs';
import { resolveOutput } from './lib/output.mjs';
import { UsageError, parseCli, exitUsage, evalLog } from '../shared/cli.mjs';

const USAGE = 'node scripts/build.mjs <explainer.json> [--out <file.html|dir>] [--theme <name>] [--json]';
const OPTIONS = { out: { type: 'string' }, theme: { type: 'string' }, json: { type: 'boolean' } };

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const fail = (errors) => ({ ok: false, errors });

/**
 * Build the page for a spec file. Returns { ok: true, out, assets, bytes, warnings } after
 * writing it, else { ok: false, errors } (nothing is written).
 */
export async function build(file, { out, theme, env = process.env } = {}) {
  const { spec: loaded, dir } = loadSpec(file);
  const spec = theme === undefined ? loaded : { ...loaded, theme };
  const checked = await validateSpec(spec, { dir });
  if (!checked.ok) return fail(checked.errors);
  const target = resolveOutput({ out, title: spec.title, env });
  let built;
  try {
    built = await buildPage(spec, { dir, out: target, env });
  } catch (e) {
    if (e instanceof BuildError) return fail(e.errors);
    throw e;
  }
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, built.html);
    for (const asset of built.assets) {
      fs.mkdirSync(path.dirname(asset.to), { recursive: true });
      fs.copyFileSync(asset.from, asset.to);
    }
  } catch (e) {
    throw new UsageError(`cannot write ${target}: ${e.code ?? e.message}`);
  }
  return { ok: true, out: target, assets: built.assets.map((a) => a.to), bytes: Buffer.byteLength(built.html), warnings: checked.warnings };
}

function printFailure(result, { json, label }) {
  if (json) {
    process.stdout.write(`${JSON.stringify({ ok: false, errors: result.errors })}\n`);
    return;
  }
  for (const e of result.errors) process.stdout.write(`${e.path || '(root)'}: ${e.message}\n`);
  process.stdout.write(`${label}: ${plural(result.errors.length, 'error')}\n`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  let json = argv.includes('--json');
  try {
    const { values, positionals } = parseCli(argv, OPTIONS, USAGE);
    json = values.json === true;
    if (positionals.length !== 1) throw new UsageError(`expected one spec file; usage: ${USAGE}`);
    const result = await build(positionals[0], { out: values.out, theme: values.theme });
    evalLog(result.ok, result.ok ? 0 : result.errors.length);
    if (!result.ok) {
      printFailure(result, { json, label: positionals[0] });
      process.exitCode = 1;
    } else if (json) {
      process.stdout.write(`${JSON.stringify({ ok: true, out: result.out, assets: result.assets, bytes: result.bytes, warnings: result.warnings })}\n`);
    } else {
      for (const w of result.warnings) process.stdout.write(`${w.path || '(root)'}: warning: ${w.message}\n`);
      process.stdout.write(`wrote ${result.out}\nopen: ${pathToFileURL(result.out).href}\n`);
    }
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    evalLog(false, 1);
    exitUsage(e, { json });
  }
}

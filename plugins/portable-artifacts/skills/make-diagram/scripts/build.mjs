#!/usr/bin/env node
// node scripts/build.mjs <spec.diagram.json> [--out <file.html|dir>] [--theme <name>] [--model <m>] [--effort <e>] [--agent <a>] [--json]
// Validates (layout and geometry lint included), draws and writes one offline HTML page.
// Output: --out file.html, --out dir (-> dir/<slug>.html), else ${PA_OUTPUT_DIR or ~/.agent/diagrams}/<slug>.html.
// exit 0 ok, 1 spec errors, 2 usage/IO
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadSpec } from './lib/spec.mjs';
import { buildDiagram } from './lib/api.mjs';
import { DiagramError } from './lib/diagram-error.mjs';
import { renderViewer, MAX_PAGE_BYTES } from './lib/viewer.mjs';
import { resolveOutput } from './lib/output.mjs';
import { themeFor } from './lib/theme.mjs';
import { UsageError, parseCli, exitUsage } from '../shared/cli.mjs';
import { printResult } from '../shared/errors.mjs';
import { PROVENANCE_OPTIONS, withGeneratedBy } from '../shared/provenance.mjs';
import { warnIfStaleCopy } from '../shared/stale-copy.mjs';
import { exitInternal } from './lib/internal-error.mjs';

const USAGE = 'node scripts/build.mjs <spec.diagram.json> [--out <file.html|dir>] [--theme <name>] [--model <m>] [--effort <e>] [--agent <a>] [--json]';
const OPTIONS = { out: { type: 'string' }, theme: { type: 'string' }, json: { type: 'boolean' }, ...PROVENANCE_OPTIONS };
const KB = 1024;

/** Build the page for a spec file. Returns { ok: true, out } after writing it, else { ok: false, errors }. */
export async function build(file, { out, theme, model, effort, agent, env = process.env, maxBytes = MAX_PAGE_BYTES } = {}) {
  const { spec: loaded } = loadSpec(file);
  const themed = theme === undefined ? loaded : { ...loaded, theme };
  const spec = withGeneratedBy(themed, { model, effort, agent });
  let built;
  try {
    built = await buildDiagram(spec);
  } catch (e) {
    if (e instanceof DiagramError) return { ok: false, errors: e.errors };
    throw e;
  }
  const html = renderViewer(spec, built, { theme: themeFor(spec), env });
  const bytes = Buffer.byteLength(html);
  if (bytes > maxBytes) {
    const message = `the page is ${Math.round(bytes / KB)} KB; the limit is ${Math.round(maxBytes / KB)} KB - split the diagram`;
    return { ok: false, errors: [{ path: '', message }] };
  }
  const target = resolveOutput({ out, title: spec.title, env });
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, html);
  } catch (e) {
    throw new UsageError(`cannot write ${target}: ${e.code ?? e.message}`);
  }
  return { ok: true, out: target };
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  warnIfStaleCopy();
  const argv = process.argv.slice(2);
  let json = argv.includes('--json');
  try {
    const { values, positionals } = parseCli(argv, OPTIONS, USAGE);
    json = values.json === true;
    if (positionals.length !== 1) throw new UsageError(`expected one spec file; usage: ${USAGE}`);
    const result = await build(positionals[0], { out: values.out, theme: values.theme, model: values.model, effort: values.effort, agent: values.agent });
    if (!result.ok) {
      printResult(result, { json, label: positionals[0] });
      process.exitCode = 1;
    } else if (json) {
      process.stdout.write(`${JSON.stringify({ ok: true, out: result.out })}\n`);
    } else {
      process.stdout.write(`wrote ${result.out}\nopen: ${pathToFileURL(result.out).href}\n`);
    }
  } catch (e) {
    if (e instanceof UsageError) exitUsage(e, { json });
    else exitInternal(e, { json });
  }
}

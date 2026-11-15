// The build itself: spec file -> validated, laid out, drawn and written as one HTML page (or one standalone SVG).
// Everything heavy (ajv, ELK) loads through this file, so the entry script (scripts/build.mjs) can check that
// node_modules exists first and say so in one line.
import fs from 'node:fs';
import path from 'node:path';
import { loadSpec } from './spec.mjs';
import { buildDiagram } from './api.mjs';
import { DiagramError } from './diagram-error.mjs';
import { renderViewer, MAX_PAGE_BYTES } from './viewer.mjs';
import { resolveOutput } from './output.mjs';
import { themeFor } from './theme.mjs';
import { standaloneSvg } from './svg-export.mjs';
import { UsageError } from '../../shared/cli.mjs';
import { withGeneratedBy } from '../../shared/provenance.mjs';

export const FORMATS = ['html', 'svg'];
const KB = 1024;

// html: --out file.html | dir | the default folder. svg: the same with .svg; an --out ending in .html or .htm is
// read as the same name with .svg.
function targetFor({ out, format, title, specPath, env }) {
  if (format === 'html') return resolveOutput({ out, title, specPath, env });
  if (out && /\.svg$/i.test(out)) return path.resolve(out);
  return resolveOutput({ out, title, specPath, env }).replace(/\.html?$/i, '.svg');
}

/**
 * Build the page for a spec file. Returns { ok: true, out, warnings } after writing it, else { ok: false, errors }.
 * `warnings` ({ path, message }) is advice about the spec; it never stops a build.
 */
export async function build(file, { out, theme, format = 'html', model, effort, agent, env = process.env, maxBytes = MAX_PAGE_BYTES } = {}) {
  if (!FORMATS.includes(format)) throw new UsageError(`--format must be one of: ${FORMATS.join(', ')}; got ${JSON.stringify(format)}`);
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
  const resolved = themeFor(spec);
  const target = targetFor({ out, format, title: spec.title, specPath: file, env });
  const specName = path.basename(file);
  const text = format === 'svg'
    ? standaloneSvg(built, resolved, { note: `portable-artifacts make-diagram; spec=${specName}; theme=${resolved.name}; light palette only` })
    : renderViewer(spec, built, { theme: resolved, env, build: { spec: specName, out: path.basename(target), flags: theme === undefined ? [] : [`--theme ${theme}`] } });
  const bytes = Buffer.byteLength(text);
  if (bytes > maxBytes) {
    const message = `the page is ${Math.round(bytes / KB)} KB; the limit is ${Math.round(maxBytes / KB)} KB - split the diagram`;
    return { ok: false, errors: [{ path: '', message }] };
  }
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  } catch (e) {
    throw new UsageError(`cannot write ${target}: ${e.code ?? e.message}`);
  }
  return { ok: true, out: target, warnings: built.warnings };
}

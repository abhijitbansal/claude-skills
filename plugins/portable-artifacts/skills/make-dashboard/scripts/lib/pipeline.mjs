// The whole build as one function, shared by build.mjs and the live server.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSpec, validateSpec } from './spec.mjs';
import { runQueries, checkFields, QueryError } from './data.mjs';
import { renderPage } from './html.mjs';
import { expandCharts } from './views.mjs';
import { checkSource, FILE_TYPES } from './sources.mjs';
import { UsageError } from '../../shared/cli.mjs';
import { didYouMean } from '../../shared/errors.mjs';
import { loadTheme, listThemes, DEFAULT_THEME, ThemeError } from '../../shared/theme.mjs';
import { checkTheme } from '../../shared/contrast.mjs';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const VENDOR_FILES = {
  vega: 'node_modules/vega/build/vega.min.js',
  vegaLite: 'node_modules/vega-lite/build/vega-lite.min.js',
  vegaEmbed: 'node_modules/vega-embed/build/vega-embed.min.js',
};

function readVendor() {
  const out = {};
  for (const [key, rel] of Object.entries(VENDOR_FILES)) {
    try {
      out[key] = fs.readFileSync(path.join(SKILL, rel), 'utf8');
    } catch {
      throw new UsageError(`missing ${rel}; run "npm ci" in ${SKILL}`);
    }
  }
  return out;
}

function writePage(outDir, html) {
  const target = path.join(outDir, 'index.html');
  try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(target, html);
  } catch (e) {
    throw new UsageError(`cannot write ${target}: ${e.code ?? e.message}`);
  }
  return target;
}

// Unknown theme name -> UsageError, with a did-you-mean when one is close.
function resolveTheme(name) {
  try {
    return loadTheme(name);
  } catch (e) {
    if (!(e instanceof ThemeError)) throw e;
    const near = didYouMean(name, listThemes());
    throw new UsageError(near ? `--theme: unknown theme ${JSON.stringify(name)}; did you mean ${JSON.stringify(near)}?` : `--theme: ${e.message}`);
  }
}

export async function buildDashboard(specFile, { out, theme: themeName, allowOutside = false, timeoutMs, now = new Date() } = {}) {
  const { spec, dir } = loadSpec(specFile);
  const valid = await validateSpec(spec, { dir, allowOutside, timeoutMs });
  if (!valid.ok) return { ok: false, errors: valid.errors };
  const vendor = readVendor();
  // Theme is resolved before the full queries run (validate already ran LIMIT 0 binds), so a bad --theme fails fast.
  const theme = resolveTheme(themeName ?? spec.theme ?? DEFAULT_THEME);
  const themeErrors = checkTheme(theme).map((e) => ({ path: `theme ${theme.name}: ${e.path}`, message: e.message }));
  if (themeErrors.length) return { ok: false, errors: themeErrors };
  let results;
  try {
    results = await runQueries(spec, dir, { now, allowOutside, timeoutMs });
  } catch (e) {
    if (e instanceof QueryError) return { ok: false, errors: e.errors };
    throw e;
  }
  const fieldErrors = checkFields(spec, results);
  if (fieldErrors.length) return { ok: false, errors: fieldErrors };
  const expanded = expandCharts(spec, results);
  if (expanded.errors.length) return { ok: false, errors: expanded.errors };
  const outDir = path.resolve(out ?? path.join(dir, 'dist'));
  const target = writePage(outDir, renderPage(spec, results, { vendor, theme, charts: expanded.charts }));
  const sources = Object.entries(spec.sources).map(([name, src]) => [
    name,
    FILE_TYPES.includes(src.type) ? checkSource(src, dir, { allowOutside }).abs : `${src.type} (env ${src.env})`,
  ]);
  const watch = [path.resolve(specFile), ...sources.map(([, abs]) => abs).filter((p) => path.isAbsolute(p))];
  return { ok: true, spec, target, outDir, results, sources, watch };
}

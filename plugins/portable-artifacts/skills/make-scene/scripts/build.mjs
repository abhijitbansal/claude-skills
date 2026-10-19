#!/usr/bin/env node
// node scripts/build.mjs <scene.json> [--out <file.html|dir>] [--theme <name>] [--world <world>] [--model <m>] [--effort <e>] [--agent <a>] [--allow-outside] [--json]
// Validates, builds the scene graph and writes one offline HTML page, then prints the alternatives table.
// Output: --out file.html, --out dir (-> dir/<slug>.html), else ${PA_OUTPUT_DIR or ~/.agent/scenes}/<slug>.html.
// --world W switches the world (checked against the data first) and rewrites the world field of scene.json.
// exit 0 ok, 1 spec errors, 2 usage/IO
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadSpec, validateSpec } from './lib/spec.mjs';
import { buildScene, SceneError } from './lib/api.mjs';
import { MAX_PAGE_BYTES, SKILL_DIR } from './lib/bundle.mjs';
import { costTable } from './lib/cost.mjs';
import { exitInternal } from './lib/internal-error.mjs';
import { renderPage } from './lib/page.mjs';
import { eligibility, recommend, renderWeight } from './lib/recommend.mjs';
import { loadData } from './lib/rows.mjs';
import { themeFor } from './lib/theme.mjs';
import { UsageError, parseCli, exitUsage } from '../shared/cli.mjs';
import { printResult } from '../shared/errors.mjs';
import { resolveOutput } from '../shared/output.mjs';
import { PROVENANCE_OPTIONS, withGeneratedBy } from '../shared/provenance.mjs';

const USAGE = 'node scripts/build.mjs <scene.json> [--out <file.html|dir>] [--theme <name>] [--world <world>] [--model <m>] [--effort <e>] [--agent <a>] [--allow-outside] [--json]';
const OPTIONS = {
  out: { type: 'string' },
  theme: { type: 'string' },
  world: { type: 'string' },
  'allow-outside': { type: 'boolean' },
  json: { type: 'boolean' },
  ...PROVENANCE_OPTIONS,
};
const KB = 1024;
const ID_PREFIX = 'sc';

/** Where the page goes: `out` (a .html file, or a folder), else $PA_OUTPUT_DIR, else ~/.agent/scenes; always <slug-of-title>.html in a folder. */
export function resolveScenePath({ out, title, env = process.env, home = os.homedir() }) {
  // resolveOutput itself reads $PA_OUTPUT_DIR, so the scenes folder is passed only when neither is given.
  const hasDestination = Boolean(out) || Boolean(env.PA_OUTPUT_DIR);
  const folder = hasDestination ? out : path.join(home, '.agent', 'scenes');
  return resolveOutput({ out: folder, title, fallback: 'scene', env, home });
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// One entry per world, best fit first. Sizes of the other worlds are measured by building them:
// this page, minus this world's fragment, plus theirs.
async function alternativesFor({ spec, dir, theme, built, bytes }) {
  const data = loadData(spec, dir);
  const { ranked, reasons } = recommend(data);
  const fit = eligibility(data);
  const rows = [];
  for (const world of ranked) {
    if (!fit[world].ok) {
      rows.push({ world, eligible: false, needs: fit[world].needs, reason: reasons[world], estBytes: 0, weight: '' });
      continue;
    }
    try {
      const other = world === built.world ? built : await buildScene({ ...spec, world }, { dir, theme, idPrefix: ID_PREFIX });
      rows.push({ world, eligible: true, reason: reasons[world], estBytes: bytes - built.bytes + other.bytes, weight: renderWeight(other.graph) });
    } catch (e) {
      // The page is already written: a world that fails to build is a row that says so, never a failed build.
      const why = String(e?.message ?? e).split('\n')[0];
      rows.push({ world, eligible: false, unavailable: why, reason: `not available: ${why}`, estBytes: 0, weight: '' });
    }
  }
  return rows;
}

function writeFile(target, text) {
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  } catch (e) {
    throw new UsageError(`cannot write ${target}: ${e.code ?? e.message}`);
  }
}

/**
 * Build the page for a spec file. Returns { ok: true, out, bytes, world, alternatives, table, rewroteSpec } after
 * writing it, else { ok: false, errors }. `world` switches the world (eligibility is checked first, and the
 * file is only rewritten once the page is written); `maxBytes` is the page cap.
 */
export async function build(file, { out, theme, world, model, effort, agent, env = process.env, maxBytes = MAX_PAGE_BYTES, allowOutside = false } = {}) {
  const { spec: loaded, dir } = loadSpec(file);
  if (!isObject(loaded)) return validateSpec(loaded, { dir, allowOutside });
  const asked = world === undefined ? loaded : { ...loaded, world };
  const spec = withGeneratedBy(theme === undefined ? asked : { ...asked, theme }, { model, effort, agent });
  const checked = await validateSpec(spec, { dir, allowOutside });
  if (!checked.ok) return { ok: false, errors: checked.errors };

  const pageTheme = themeFor(spec);
  let built;
  let html;
  try {
    built = await buildScene(spec, { dir, theme: pageTheme, idPrefix: ID_PREFIX, allowOutside });
    html = renderPage(spec, built, { theme: pageTheme, env });
  } catch (e) {
    if (e instanceof SceneError) return { ok: false, errors: e.errors };
    throw e;
  }
  const bytes = Buffer.byteLength(html);
  if (bytes > maxBytes) {
    const message = `the page is ${Math.round(bytes / KB)} KB; the limit is ${Math.round(maxBytes / KB)} KB - use fewer rows or fewer groups`;
    return { ok: false, errors: [{ path: '', message }] };
  }
  const target = resolveScenePath({ out, title: spec.title, env });
  writeFile(target, html);
  const rewroteSpec = world !== undefined && loaded.world !== world;
  if (rewroteSpec) writeFile(path.resolve(file), `${JSON.stringify({ ...loaded, world }, null, 2)}\n`);

  // A lift is never second-guessed: it has no other worlds to offer.
  const alternatives = spec.lift === undefined ? await alternativesFor({ spec, dir, theme: pageTheme, built, bytes }) : [];
  const table = costTable({
    specText: fs.readFileSync(file, 'utf8'),
    current: built.world,
    pageBytes: bytes,
    skillDir: path.resolve(SKILL_DIR),
    specPath: path.resolve(file),
    flags: { out: out && path.resolve(out), theme, allowOutside },
    alternatives,
  });
  return { ok: true, out: target, bytes, world: built.world, alternatives, table, rewroteSpec };
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  let json = argv.includes('--json');
  try {
    const { values, positionals } = parseCli(argv, OPTIONS, USAGE);
    json = values.json === true;
    if (positionals.length !== 1) throw new UsageError(`expected one spec file; usage: ${USAGE}`);
    const result = await build(positionals[0], {
      out: values.out, theme: values.theme, world: values.world, model: values.model, effort: values.effort, agent: values.agent, allowOutside: values['allow-outside'],
    });
    if (!result.ok) {
      printResult(result, { json, label: positionals[0] });
      process.exitCode = 1;
    } else if (json) {
      process.stdout.write(`${JSON.stringify({ ok: true, out: result.out, bytes: result.bytes, world: result.world, alternatives: result.alternatives })}\n`);
    } else {
      const note = result.rewroteSpec ? `scene.json: world set to ${result.world}\n` : '';
      process.stdout.write(`${note}wrote ${result.out}\nopen: ${pathToFileURL(result.out).href}\n\n${result.table}\n`);
    }
  } catch (e) {
    if (e instanceof UsageError) exitUsage(e, { json });
    else exitInternal(e, { json });
  }
}

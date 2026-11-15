// The build itself: validate, build the scene graph, write one offline HTML page and measure the alternatives.
// Heavy (ajv, three's bundle): scripts/build.mjs loads this only after its preflight found node_modules.
import fs from 'node:fs';
import path from 'node:path';
import { loadSpec, validateSpec } from './spec.mjs';
import { buildScene, SceneError } from './api.mjs';
import { MAX_PAGE_BYTES, SKILL_DIR } from './bundle.mjs';
import { costTable } from './cost.mjs';
import { buildPage, capError, fittingWorlds } from './page-size.mjs';
import { eligibility, recommend, renderWeight } from './recommend.mjs';
import { inlineCode, inlineCss } from './markup.mjs';
import { loadData } from './rows.mjs';
import { resolveScenePath } from './scene-path.mjs';
import { UsageError } from '../../shared/cli.mjs';
import { withGeneratedBy } from '../../shared/provenance.mjs';

const ID_PREFIX = 'sc';
const OVER_CAP = 'over the page limit';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// One entry per world, best fit first. Sizes of the other worlds are measured by building them:
// this page, minus this world's fragment, plus theirs.
async function alternativesFor({ spec, dir, theme, built, bytes, maxBytes }) {
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
      const estBytes = bytes - built.bytes + other.bytes;
      // A world whose page is over the cap cannot be built: listed, with the reason and no command to run.
      if (estBytes > maxBytes) {
        rows.push({ world, eligible: false, unavailable: OVER_CAP, reason: `not available: ${OVER_CAP}`, estBytes, weight: '' });
        continue;
      }
      rows.push({ world, eligible: true, reason: reasons[world], estBytes, weight: renderWeight(other.graph) });
    } catch (e) {
      // The page is already written: a world that fails to build is a row that says so, never a failed build.
      const why = String(e?.message ?? e).split('\n')[0];
      rows.push({ world, eligible: false, unavailable: why, reason: `not available: ${why}`, estBytes: 0, weight: '' });
    }
  }
  return rows;
}

const FRAGMENT_NOTE = '<!-- make-scene fragment: paste it into a page that defines the theme variables (--page, --text, --accent ...) and allows inline scripts and styles. It mounts itself. -->';

// The embeddable scene api.mjs assembles, as one file: its css, the host with its data, the runtime and the one mount
// call (embedded: the host page scrolls, so the wheel passes through until full screen).
function fragmentOf(built) {
  return [
    FRAGMENT_NOTE,
    `<style id="pa-scene-css">${inlineCss(built.css)}</style>`,
    built.html,
    `<script>${inlineCode(built.runtime)}</script>`,
    '<script>if (window.PAScene) PAScene.initAll({ embedded: true });</script>',
    '',
  ].join('\n');
}

// <slug>.fragment.html in the default folder or a --out folder; a --out that names a .html file is that file.
const fragmentPath = (target, out) => (out && /\.html?$/i.test(out) ? target : target.replace(/\.html?$/i, '.fragment.html'));

function writeFile(target, text) {
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  } catch (e) {
    throw new UsageError(`cannot write ${target}: ${e.code ?? e.message}`);
  }
}

/**
 * Build the page for a spec file. Returns { ok: true, out, bytes, world, alternatives, table, rewroteSpec, warnings } after
 * writing it, else { ok: false, errors }. `world` switches the world (eligibility is checked first, and the
 * file is only rewritten once the page is written); `maxBytes` is the page cap. `fragment` writes the embeddable scene
 * (see fragmentOf) in place of the page, with no table. `warnings` ({ path, message }) is advice
 * about the spec and never stops a build.
 */
export async function build(file, { out, theme, world, model, effort, agent, fragment = false, env = process.env, maxBytes = MAX_PAGE_BYTES, allowOutside = false } = {}) {
  const { spec: loaded, dir } = loadSpec(file);
  if (!isObject(loaded)) return validateSpec(loaded, { dir, allowOutside });
  const asked = world === undefined ? loaded : { ...loaded, world };
  const spec = withGeneratedBy(theme === undefined ? asked : { ...asked, theme }, { model, effort, agent });
  const checked = await validateSpec(spec, { dir, allowOutside });
  if (!checked.ok) return { ok: false, errors: checked.errors };

  let page;
  try {
    page = await buildPage(spec, { dir, allowOutside, env });
  } catch (e) {
    if (e instanceof SceneError) return { ok: false, errors: e.errors };
    throw e;
  }
  const { built, html, bytes, theme: pageTheme } = page;
  if (capError(bytes, maxBytes)) {
    const fits = await fittingWorlds(spec, { dir, allowOutside, env, maxBytes });
    return { ok: false, errors: [capError(bytes, maxBytes, { fits })] };
  }
  const target = resolveScenePath({ out, title: spec.title, specPath: path.resolve(file), env });
  if (fragment) {
    // A fragment has no alternatives table and never changes the spec: it is one more output of the same build.
    const written = fragmentPath(target, out);
    writeFile(written, fragmentOf(built));
    return { ok: true, out: written, bytes: bytes, world: built.world, alternatives: [], table: '', rewroteSpec: false, warnings: checked.warnings ?? [], fragment: true };
  }
  writeFile(target, html);
  const rewroteSpec = world !== undefined && loaded.world !== world;
  if (rewroteSpec) writeFile(path.resolve(file), `${JSON.stringify({ ...loaded, world }, null, 2)}\n`);

  // A lift is never second-guessed: it has no other worlds to offer.
  const alternatives = spec.lift === undefined ? await alternativesFor({ spec, dir, theme: pageTheme, built, bytes, maxBytes }) : [];
  const table = costTable({
    specText: fs.readFileSync(file, 'utf8'),
    current: built.world,
    pageBytes: bytes,
    skillDir: path.resolve(SKILL_DIR),
    specPath: path.resolve(file),
    flags: { out: out && path.resolve(out), theme, allowOutside },
    alternatives,
  });
  return { ok: true, out: target, bytes, world: built.world, alternatives, table, rewroteSpec, warnings: checked.warnings ?? [] };
}

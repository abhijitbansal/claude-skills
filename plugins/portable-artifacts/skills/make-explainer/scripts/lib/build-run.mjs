// The build itself: validate, render, write. scripts/build.mjs loads this after its dependency preflight, so a
// missing install is one line naming the doctor command instead of an ERR_MODULE_NOT_FOUND stack.
import fs from 'node:fs';
import path from 'node:path';
import { loadSpec, validateSpec } from './spec.mjs';
import { buildPage, BuildError } from './page.mjs';
import { resolveOutput, assetsFolder } from './output.mjs';
import { syncAssets, assetConflicts, specInputs, WriteError } from './assets.mjs';
import { SiblingError } from './siblings.mjs';
import { isSlides } from './slides.mjs';
import { flavorFor, CLASSIC } from './flavor.mjs';
import { specTheme } from './default-theme.mjs';
import { fetchHeroImage, heroPrompt, parseEndpoint, requireKey, ImageHookError, KEY_ENV } from './image-hook.mjs';
import { checklistMarkdown, hasChecklist } from './checklist-md.mjs';
import { withGeneratedBy } from '../../shared/provenance.mjs';

const fail = (errors) => ({ ok: false, errors });
const MD_NEEDS_CHECKLIST = '--md writes the markdown twin of a checklist, and this spec has no checklist section; add one or drop --md';

/** The markdown twin sits next to the page: <name>.md for <name>.html. */
export const mdPath = (target) => target.replace(/\.html?$/i, '.md');

/**
 * Build the page for a spec file. Returns { ok: true, out, md, theme, assets, bytes, warnings } after
 * writing it (`theme` is the one drawn: --theme, else spec.theme, else the default; `md` is the twin's path when
 * `md` was asked for, else null), else { ok: false, errors } (nothing is written). `strict` makes the section and page
 * length caps errors.
 */
export async function build(file, { out, theme, model, effort, agent, imageApi, fetchImpl, strict = false, md = false, env = process.env } = {}) {
  const { spec: loaded, dir } = loadSpec(file);
  const themed = theme === undefined ? loaded : { ...loaded, theme };
  const spec = withGeneratedBy(themed, { model, effort, agent });
  const checked = await validateSpec(spec, { dir, strict });
  if (!checked.ok) return fail(checked.errors);
  if (md && !hasChecklist(spec)) return fail([{ path: 'sections', message: MD_NEEDS_CHECKLIST }]);
  const target = resolveOutput({ out, title: spec.title, specPath: file, env });
  if (imageApi !== undefined) checkImageApi(spec, imageApi, env);
  const assetsDir = assetsFolder(target);
  let conflicts = [];
  // The request is the last thing that can fail after local work: buildPage calls this once everything else
  // rendered, and a clash with files this build did not write stops it before anything is sent.
  const heroImage = imageApi === undefined ? undefined : async ({ assets }) => {
    conflicts = assetConflicts(assetsDir, assets);
    if (conflicts.length > 0) return undefined;
    return requestHeroImage(spec, imageApi, { fetchImpl, env });
  };
  let built;
  try {
    built = await buildPage(spec, { dir, out: target, env, heroImage });
  } catch (e) {
    if (e instanceof BuildError) return fail(e.errors);
    if (e instanceof SiblingError) return fail([{ path: 'sections', message: e.message }]);
    throw e;
  }
  // Before anything is written: a file in the folder that no build wrote is never overwritten.
  conflicts = assetConflicts(assetsDir, built.assets);
  if (conflicts.length > 0) return fail(conflicts);
  // Assets and their manifest first, then the page (atomically), then the tidy-up of files this build no longer
  // writes (see assets.mjs): a failure anywhere names its path and leaves the previous page and files in place.
  syncAssets(assetsDir, built.assets, { protect: specInputs(spec, dir), publish: () => writePage(target, built.html) });
  const twin = md ? mdPath(target) : null;
  if (twin) writeFile(twin, checklistMarkdown(spec));
  return { ok: true, out: target, md: twin, theme: specTheme(spec), assets: built.assets.map((a) => a.to), bytes: Buffer.byteLength(built.html), warnings: checked.warnings };
}

// Refusals that need no network: a deck, a classic theme, a bad endpoint or a missing key. Throws ImageHookError.
function checkImageApi(spec, imageApi, env) {
  if (isSlides(spec)) throw new ImageHookError('--image-api only applies to explainer pages, not slide decks; drop the flag or build a page');
  const theme = specTheme(spec);
  if (flavorFor(theme) === CLASSIC) throw new ImageHookError(`--image-api needs a dusk, press or poster page (got ${theme}); pass --theme dusk or drop the flag`);
  parseEndpoint(imageApi);
  requireKey(env[KEY_ENV]);
}

// The one network call, announced on stderr before anything leaves the machine. Throws ImageHookError.
async function requestHeroImage(spec, imageApi, { fetchImpl, env }) {
  const host = parseEndpoint(imageApi).host;
  const key = requireKey(env[KEY_ENV]);
  process.stderr.write(`image-api: sending the title and subtitle to ${host} (leaves this machine)\n`);
  return fetchHeroImage({ prompt: heroPrompt(spec), endpoint: imageApi, key, fetchImpl });
}

function writeFile(target, text) {
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  } catch (e) {
    throw new WriteError(target, e);
  }
}

// Temp file + rename, so an interrupted build leaves the old page or the new one. A symlinked page is written through.
function writePage(target, html) {
  const folder = path.dirname(target);
  try {
    fs.mkdirSync(folder, { recursive: true });
  } catch (e) {
    throw new WriteError(folder, e);
  }
  let dest = target;
  try {
    dest = fs.realpathSync(target);
  } catch {
    // no page yet
  }
  const tmp = `${dest}.tmp`;
  try {
    fs.writeFileSync(tmp, html);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw new WriteError(tmp, e);
  }
  try {
    fs.renameSync(tmp, dest);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw new WriteError(dest, e);
  }
}

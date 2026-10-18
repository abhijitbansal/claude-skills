#!/usr/bin/env node
// node scripts/build.mjs <explainer.json> [--out <file.html|dir>] [--theme <name>] [--image-api <https-endpoint>] [--model <m>] [--effort <e>] [--agent <a>] [--json]
// Validates, renders and writes one offline HTML page (plus <slug>.assets/ when a section needs files).
// --image-api <https-endpoint> (optional, off by default): sends the title and subtitle to that endpoint with the key in
// PA_IMAGE_API_KEY and uses the returned picture as the page hero. A failure there fails the build (exit 2).
// Output: --out file.html, --out dir (-> dir/<slug>.html), else ${PA_OUTPUT_DIR or ~/.agent/diagrams}/<slug>.html.
// exit 0 ok, 1 spec errors, 2 usage/IO
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadSpec, validateSpec, exitSpecUsage } from './lib/spec.mjs';
import { buildPage, BuildError } from './lib/page.mjs';
import { resolveOutput, assetsFolder } from './lib/output.mjs';
import { syncAssets, assetConflicts, specInputs, WriteError } from './lib/assets.mjs';
import { SiblingError } from './lib/siblings.mjs';
import { fetchHeroImage, heroPrompt, parseEndpoint, requireKey, ImageHookError, KEY_ENV } from './lib/image-hook.mjs';
import { UsageError, parseCli } from '../shared/cli.mjs';
import { PROVENANCE_OPTIONS, withGeneratedBy } from '../shared/provenance.mjs';

const USAGE = 'node scripts/build.mjs <explainer.json> [--out <file.html|dir>] [--theme <name>] [--image-api <https-endpoint>] [--model <m>] [--effort <e>] [--agent <a>] [--json]';
const OPTIONS = { out: { type: 'string' }, theme: { type: 'string' }, 'image-api': { type: 'string' }, json: { type: 'boolean' }, ...PROVENANCE_OPTIONS };

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const fail = (errors) => ({ ok: false, errors });

/**
 * Build the page for a spec file. Returns { ok: true, out, assets, bytes, warnings } after
 * writing it, else { ok: false, errors } (nothing is written).
 */
export async function build(file, { out, theme, model, effort, agent, imageApi, fetchImpl, env = process.env } = {}) {
  const { spec: loaded, dir } = loadSpec(file);
  const themed = theme === undefined ? loaded : { ...loaded, theme };
  const spec = withGeneratedBy(themed, { model, effort, agent });
  const checked = await validateSpec(spec, { dir });
  if (!checked.ok) return fail(checked.errors);
  const target = resolveOutput({ out, title: spec.title, env });
  const heroImage = imageApi === undefined ? undefined : await requestHeroImage(spec, imageApi, { fetchImpl, env });
  let built;
  try {
    built = await buildPage(spec, { dir, out: target, env, heroImage });
  } catch (e) {
    if (e instanceof BuildError) return fail(e.errors);
    if (e instanceof SiblingError) return fail([{ path: 'sections', message: e.message }]);
    throw e;
  }
  const assetsDir = assetsFolder(target);
  // Before anything is written: a file in the folder that no build wrote is never overwritten.
  const conflicts = assetConflicts(assetsDir, built.assets);
  if (conflicts.length > 0) return fail(conflicts);
  // Assets and their manifest first, then the page (atomically), then the tidy-up of files this build no longer
  // writes (see assets.mjs): a failure anywhere names its path and leaves the previous page and files in place.
  syncAssets(assetsDir, built.assets, { protect: specInputs(spec, dir), publish: () => writePage(target, built.html) });
  return { ok: true, out: target, assets: built.assets.map((a) => a.to), bytes: Buffer.byteLength(built.html), warnings: checked.warnings };
}

// The one network call, announced on stderr before anything leaves the machine. Throws ImageHookError.
async function requestHeroImage(spec, imageApi, { fetchImpl, env }) {
  const host = parseEndpoint(imageApi).host;
  const key = requireKey(env[KEY_ENV]);
  process.stderr.write(`image-api: sending the title and subtitle to ${host} (leaves this machine)\n`);
  return fetchHeroImage({ prompt: heroPrompt(spec), endpoint: imageApi, key, fetchImpl });
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
    const result = await build(positionals[0], { out: values.out, theme: values.theme, imageApi: values['image-api'], model: values.model, effort: values.effort, agent: values.agent });
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
    if (!(e instanceof UsageError || e instanceof ImageHookError)) throw e;
    exitSpecUsage(e, { json });
  }
}

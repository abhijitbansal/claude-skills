// scene.json: loading and the layered validation (schema, then structure,
// data sources, rows, world eligibility, tour focus). Lift specs are checked
// for shape and paths here; siblings add their own checks with registerLiftCheck.
import fs from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import { formatAjvErrors } from '../../shared/errors.mjs';
import { UsageError } from '../../shared/cli.mjs';
import { listThemes } from '../../shared/theme.mjs';
import { SCHEMA, ROWS_SCHEMA, LINKS_SCHEMA, LIMITS } from './schema.mjs';
import { q, suggestion, checkLength } from './checks.mjs';
import { checkRows, checkLinks, checkWorld } from './row-checks.mjs';
import { readSource, resolveLocal, focusKeys, DataError } from './rows.mjs';

export { UsageError };

const ajv = new Ajv({ allErrors: true, strict: true, verbose: true, allowUnionTypes: true });
const validateSchema = ajv.compile(SCHEMA);
const validateRows = ajv.compile(ROWS_SCHEMA);
const validateLinks = ajv.compile(LINKS_SCHEMA);

export function loadSpec(file) {
  const abs = path.resolve(file);
  let text;
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch (e) {
    throw new UsageError(`cannot read ${file}: ${e.code ?? e.message}`);
  }
  try {
    return { spec: JSON.parse(text), dir: path.dirname(abs) };
  } catch (e) {
    throw new UsageError(`${file} is not valid JSON: ${e.message}`);
  }
}

// ---- lift hooks ---------------------------------------------------------

const LIFT_KINDS = ['diagram', 'dashboard'];
const liftChecks = new Map();

/**
 * Register the sibling check for a lift kind ('diagram' | 'dashboard'):
 * async (spec, { dir, allowOutside }) => [{ path, message }]. Throws a
 * TypeError for any other kind or a non-function.
 */
export function registerLiftCheck(kind, fn) {
  if (!LIFT_KINDS.includes(kind)) throw new TypeError(`registerLiftCheck: kind must be ${LIFT_KINDS.map(q).join(' or ')}, got ${q(kind)}`);
  if (typeof fn !== 'function') throw new TypeError(`registerLiftCheck: the ${q(kind)} check must be a function`);
  liftChecks.set(kind, fn);
}

// ---- helpers ------------------------------------------------------------

// Ajv errors for a loaded array, re-rooted under `base` ("data.file.rows").
function rootedErrors(validate, value, base) {
  if (validate(value)) return [];
  return formatAjvErrors(validate.errors).map((e) => ({ ...e, path: `${base}${e.path}` }));
}

function checkPath(errors, ref, at, dir, allowOutside) {
  const { error } = resolveLocal(ref, dir, { allowOutside });
  if (error) errors.push({ path: at, message: error });
  return error === undefined;
}

function checkTheme(errors, spec) {
  if (spec.theme === undefined) return;
  const themes = listThemes();
  if (!themes.includes(spec.theme)) errors.push({ path: 'theme', message: `unknown theme ${q(spec.theme)}; ${suggestion(spec.theme, themes)}` });
}

// ---- lift ---------------------------------------------------------------

function checkLiftShape(errors, spec, dir, allowOutside) {
  const { lift } = spec;
  const kinds = ['diagram', 'dashboard'].filter((k) => lift[k] !== undefined);
  if (kinds.length !== 1) {
    errors.push({ path: 'lift', message: 'exactly one of diagram or dashboard; give a diagram path or object, or a dashboard path with a chart id' });
    return;
  }
  if (spec.world !== undefined) errors.push({ path: 'world', message: 'world only applies to data scenes; remove it when lifting a diagram or chart' });
  if (spec.links !== undefined) errors.push({ path: 'links', message: 'links only apply to data scenes; remove them when lifting a diagram or chart' });
  if (kinds[0] === 'diagram') {
    if (lift.chart !== undefined) errors.push({ path: 'lift.chart', message: 'chart is allowed only with lift.dashboard' });
    if (typeof lift.diagram === 'string') checkPath(errors, lift.diagram, 'lift.diagram', dir, allowOutside);
    return;
  }
  if (lift.chart === undefined) errors.push({ path: 'lift.chart', message: 'required with lift.dashboard; name the chart id to lift' });
  checkPath(errors, lift.dashboard, 'lift.dashboard', dir, allowOutside);
}

// ---- data ---------------------------------------------------------------

const SOURCES = [['rows', 'data.rows'], ['file', 'data.file'], ['csv', 'data.csv']];

// -> { rows, links, base } for the one source, or null after recording why not.
function loadSource(errors, spec, dir, allowOutside) {
  const { data } = spec;
  const given = SOURCES.filter(([k]) => data[k] !== undefined);
  if (given.length !== 1) {
    errors.push({ path: 'data', message: `exactly one data source; give one of rows, file or csv (found ${given.length})` });
    return null;
  }
  if (data.columns !== undefined && given[0][0] !== 'csv') {
    errors.push({ path: 'data.columns', message: 'columns apply only to data.csv; remove it' });
  }
  const [kind, at] = given[0];
  if (kind !== 'rows' && !checkPath(errors, data[kind], at, dir, allowOutside)) return null;
  let source;
  try {
    source = readSource(spec, dir);
  } catch (e) {
    if (!(e instanceof DataError)) throw e;
    errors.push(...e.errors);
    return null;
  }
  if (kind === 'rows') return { ...source, base: 'data.rows', linksBase: null };
  const base = `${at}.rows`;
  const loadedErrors = [...rootedErrors(validateRows, source.rows, base)];
  if (kind === 'file') loadedErrors.push(...rootedErrors(validateLinks, source.links, `${at}.links`));
  errors.push(...loadedErrors);
  return loadedErrors.length ? null : { ...source, base, linksBase: `${at}.links` };
}

function checkTour(errors, spec, keys) {
  const tour = spec.tour ?? [];
  if (tour.length > LIMITS.beats) errors.push({ path: 'tour', message: `${tour.length} beats; the limit is ${LIMITS.beats}; merge or drop beats` });
  const candidates = keys ? [...keys] : [];
  tour.forEach((beat, i) => {
    const p = `tour[${i}]`;
    checkLength(errors, beat, 'title', p, LIMITS.beatTitle);
    checkLength(errors, beat, 'caption', p, LIMITS.caption);
    if (!keys) return; // a lift's focus names diagram nodes, checked by the sibling; a failed load has nothing to resolve against
    beat.focus.forEach((f, j) => {
      if (!keys.has(f.toLowerCase())) errors.push({ path: `${p}.focus[${j}]`, message: `${q(f)} is not a group or label; ${suggestion(f.toLowerCase(), candidates)}` });
    });
  });
}

function checkDataScene(errors, spec, dir, allowOutside) {
  const source = loadSource(errors, spec, dir, allowOutside);
  if (!source) return null;
  const groups = checkRows(errors, source.rows, source.base);
  checkLinks(errors, spec.links ?? [], 'links', groups);
  if (source.linksBase) checkLinks(errors, source.links, source.linksBase, groups);
  const data = { rows: source.rows, links: [...source.links, ...(spec.links ?? [])] };
  checkWorld(errors, spec.world, data);
  return data;
}

/**
 * Validate a parsed scene spec. `dir` is the spec's folder (default: the
 * working directory); data and lift paths must stay inside it unless
 * `allowOutside`. Resolves to { ok, errors: [{ path, message }] }.
 */
export async function validateSpec(spec, { dir = process.cwd(), allowOutside = false } = {}) {
  if (!validateSchema(spec)) return { ok: false, errors: formatAjvErrors(validateSchema.errors) };
  const errors = [];
  checkTheme(errors, spec);
  checkLength(errors, spec, 'title', '', LIMITS.title);
  checkLength(errors, spec, 'subtitle', '', LIMITS.subtitle);
  let keys = null; // what tour focus may name; null when the data did not load or the scene is a lift
  if ((spec.data === undefined) === (spec.lift === undefined)) {
    errors.push({ path: spec.data === undefined ? 'data' : 'lift', message: 'exactly one of data or lift; remove one, or add the missing one' });
  } else if (spec.data !== undefined) {
    const loaded = checkDataScene(errors, spec, dir, allowOutside);
    if (loaded) keys = focusKeys(loaded.rows);
  } else {
    const before = errors.length;
    checkLiftShape(errors, spec, dir, allowOutside);
    const kind = spec.lift.diagram !== undefined ? 'diagram' : 'dashboard';
    if (errors.length === before && liftChecks.has(kind)) errors.push(...await liftChecks.get(kind)(spec, { dir, allowOutside }));
  }
  checkTour(errors, spec, keys);
  return { ok: errors.length === 0, errors };
}

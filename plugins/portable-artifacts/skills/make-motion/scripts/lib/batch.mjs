// render --batch: the rows file, the --out template, and the manifest written next to the outputs.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { didYouMean } from '../../shared/errors.mjs';
import { UsageError } from './spec.mjs';
import { declaresVars } from '../../template/vars.mjs';
import { collisionKey, inputClashes } from './paths.mjs';
import { normalizedPath } from './loudness.mjs';

// inputClashes and collisionKey live in paths.mjs (beats.mjs uses them without loading the validator); re-exported here.
export { collisionKey, inputClashes };

export const MANIFEST = 'manifest.json';
export const NEEDS_TEMPLATE = '--batch needs an --out template with {index} or a {var}, so outputs do not collide';
const PLACEHOLDER = /\{([^{}]*)\}/g;
const MAX_SEGMENT = 80; // characters a substituted value may put in a file name
const NAME_MAX_BYTES = 255; // the longest file name (UTF-8 bytes) common file systems take
const BATCH_EXTENSION = '.mp4';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const kindOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'an array' : typeof v === 'object' ? 'an object' : `a ${typeof v}`);

/**
 * The rows of `file`, read as untrusted: a non-empty JSON array of plain objects (each key a var name, each value that
 * var's value; checked against the spec by validateSpec). Anything else is a usage error (exit 2) naming the fix.
 * JSON.parse makes a `__proto__` key an own property, which is how the rest of the batch reads it: as data.
 */
export function readRows(file) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (e) {
    throw new UsageError(`--batch: cannot read ${file}: ${e.code ?? e.message}`);
  }
  let rows;
  try {
    rows = JSON.parse(raw);
  } catch (e) {
    throw new UsageError(`--batch: ${file} is not valid JSON: ${e.message}`);
  }
  if (!Array.isArray(rows)) throw new UsageError(`--batch: ${file} must be a JSON array of rows like [{ "name": "Ada" }] (got ${kindOf(rows)})`);
  if (rows.length === 0) throw new UsageError(`--batch: ${file} has no rows; give at least one object of var values`);
  const bad = rows.findIndex((row) => !isPlainObject(row));
  if (bad >= 0) throw new UsageError(`--batch: row ${bad} must be an object of var values like { "name": "Ada" } (got ${kindOf(rows[bad])})`);
  return rows;
}

const placeholders = (text) => Array.from(text.matchAll(PLACEHOLDER), (m) => m[1]);

/**
 * The --out template of a batch: `{index}` (the row's place, from 0) or `{<var>}` (a declared var's value), in the file
 * name only, so every output lands in one folder, the manifest's; the file name ends in .mp4. `declared`: the spec's var
 * names. Usage errors (exit 2) for a template without a placeholder, with the spec's `{{name}}` form, with one in the
 * folder part as written (the working folder's own name may hold braces), another extension, or an unknown name.
 */
export function outTemplate(out, declared) {
  if (typeof out !== 'string' || placeholders(out).length === 0) throw new UsageError(NEEDS_TEMPLATE);
  if (out.includes('{{')) throw new UsageError(`--out: write placeholders with single braces, like {name}; {{name}} is the spec's syntax (got ${out})`);
  const base = path.basename(out);
  if (placeholders(path.dirname(out)).length || placeholders(base).length === 0) {
    throw new UsageError(`--out: put the {…} placeholders in the file name, not the folder (like renders/{index}.mp4); got ${out}`);
  }
  const ext = path.extname(base).toLowerCase();
  if (ext !== BATCH_EXTENSION) throw new UsageError(`--out: a batch writes MP4 files; end the template with ${BATCH_EXTENSION} (got ${JSON.stringify(ext)})`);
  const accepted = ['index', ...declared];
  for (const name of placeholders(base)) {
    if (accepted.includes(name)) continue;
    const near = didYouMean(name, accepted);
    throw new UsageError(`--out: unknown placeholder {${name}}${near ? `; did you mean {${near}}?` : ''} (accepted: ${accepted.map((n) => `{${n}}`).join(', ')})`);
  }
  return { dir: path.dirname(path.resolve(out)), base };
}

/**
 * `value` as part of a file name: every run of characters other than letters, digits, `_`, `.` and `-` becomes one `-`,
 * dots and dashes at either end go, and it keeps at most MAX_SEGMENT characters. So no value can name a folder (`/`,
 * `\`), climb out of one (`..`), hide a file (a leading dot) or carry a NUL. '' when nothing usable is left.
 */
export function safeSegment(value) {
  const edges = /^[.-]+|[.-]+$/g;
  return Array.from(String(value).normalize('NFC').replace(/[^\p{L}\p{N}_.-]+/gu, '-').replace(edges, ''))
    .slice(0, MAX_SEGMENT).join('').replace(edges, '');
}

/**
 * Where row `index` encodes before its file is complete: a hidden name with the row's index, beside `out`
 * (`.x.3.partial.mp4` for `x.mp4`). A value never starts a file name with a dot (safeSegment), and planBatch refuses
 * an output that equals any row's temp file, so a temp file is never another row's output.
 */
export function batchTempPath(out, index) {
  const p = path.parse(out);
  return path.join(p.dir, `.${p.name}.${index}.partial${p.ext}`);
}

/**
 * Every planned job (`{ index, out, partial }`) whose output equals another row's temp file (compared as collisionKey),
 * as `{ index, path: '--out', message }`: such a row would encode over, or be renamed onto, a finished MP4. Values never
 * start a file name with a dot, so a template's outputs stay one dot short of its temps; this is the guard all the same.
 */
export function tempClashes(jobs) {
  const temps = new Map(jobs.map((job) => [collisionKey(job.partial), job.index]));
  return jobs.flatMap((job) => {
    const owner = temps.get(collisionKey(job.out));
    return owner === undefined ? [] : [{ index: job.index, path: '--out', message: `${path.basename(job.out)} is row ${owner}'s temporary file name; change the value or the --out template` }];
  });
}

/**
 * The output file of row `index` with var values `values` (a null-prototype object, varValues): `{ out }`, an absolute
 * path inside the template's folder, or `{ error }` when a value leaves no file name, the name is the manifest's, or the
 * name (as its temp file, the longer of the two) is over NAME_MAX_BYTES. `normalised`: the row is loudness-normalised, so
 * its second temp (normalizedPath of the first) must fit too.
 */
export function outputFor(template, index, values, { normalised = false } = {}) {
  const empty = [];
  const name = template.base.replace(PLACEHOLDER, (_, key) => {
    const segment = key === 'index' ? String(index) : safeSegment(Object.hasOwn(values, key) ? values[key] : '');
    if (!segment) empty.push(key);
    return segment;
  });
  if (empty.length) {
    const key = empty[0];
    return { error: `{${key}} is ${JSON.stringify(String(values[key] ?? ''))}, which leaves no file name; give ${key} letters or digits, or use {index}` };
  }
  if (collisionKey(name) === MANIFEST) return { error: `${name} is the batch manifest's name; change the --out template` };
  const out = path.join(template.dir, name);
  if (path.dirname(out) !== template.dir) return { error: `${name} is not a file name inside ${template.dir}` }; // never: safeSegment drops / and \
  const temp = batchTempPath(out, index);
  const bytes = Buffer.byteLength(path.basename(normalised ? normalizedPath(temp) : temp));
  if (bytes > NAME_MAX_BYTES) {
    const copy = normalised ? ' (the longer one, the ".loudnorm" copy a normalised render writes)' : '';
    return { error: `${name}: the file name is ${bytes} bytes with its temporary prefix and suffix${copy}; at most ${NAME_MAX_BYTES}, so shorten the values or the --out template` };
  }
  return { out };
}

/**
 * One warning per key of `row` that is no declared var of `spec`: data files often carry extra columns, so such a key is
 * ignored (it never reaches the spec) rather than refused, and the warning still catches a typo:
 * `unknown column "cty" ignored; declared: city, name (did you mean "city"?)`. Own-property lookups only.
 */
export function columnWarnings(spec, row) {
  const vars = declaresVars(spec) && isPlainObject(spec.vars) ? spec.vars : {};
  const declared = Object.keys(vars);
  return Object.keys(row).filter((key) => !Object.hasOwn(vars, key)).map((key) => {
    const near = didYouMean(key, declared);
    return `unknown column ${JSON.stringify(key)} ignored; declared: ${declared.join(', ') || 'none'}${near ? ` (did you mean ${JSON.stringify(near)}?)` : ''}`;
  });
}

export const sha256File = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/**
 * Manifest rows (`out` relative to `folder`) with every `ok` row checked again once the batch is done: its file must
 * still exist and still hash to its sha256, or the row becomes `failed`. A manifest never vouches for a file a later
 * row replaced or removed.
 */
export function recheckRows(folder, rows) {
  return rows.map((row) => {
    if (row.status !== 'ok') return row;
    const file = path.join(folder, row.out);
    const problem = !existsSync(file) ? 'is missing' : sha256File(file) !== row.sha256 ? 'changed' : null;
    return problem ? { ...row, status: 'failed', sha256: null, error: `${row.out} ${problem} after it was rendered` } : row;
  });
}

const MANIFEST_STATUSES = ['ok', 'failed'];
const isManifestRow = (row) => isPlainObject(row) && Number.isInteger(row.index) && MANIFEST_STATUSES.includes(row.status);

/**
 * Refuses (exit 2) a batch whose folder already holds a manifest.json that is not a batch manifest (an object with a
 * `rows` array whose every row has an integer `index` and an ok/failed `status`): a web app's, an extension's or another
 * tool's manifest must never be overwritten. An earlier batch's is replaced.
 */
export function checkManifestSlot(folder) {
  const file = path.join(folder, MANIFEST);
  if (!existsSync(file)) return;
  let body;
  try { body = JSON.parse(readFileSync(file, 'utf8')); } catch { body = null; }
  if (isPlainObject(body) && Array.isArray(body.rows) && body.rows.every(isManifestRow)) return;
  throw new UsageError(`--out: ${file} exists and is not a batch manifest; choose another --out folder (a batch writes ${MANIFEST} beside its MP4s)`);
}

/**
 * Writes `{ rows }` to manifest.json in `dir`, atomically: a temp file in the same folder, then a rename, so a reader
 * never sees half a manifest. Returns the manifest's path.
 */
export function writeManifest(dir, rows) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, MANIFEST);
  const temp = path.join(dir, `.${MANIFEST}.${process.pid}.tmp`);
  rmSync(temp, { force: true }); // a stale temp, or a symlink planted at its name: the link goes, never what it points to
  writeFileSync(temp, `${JSON.stringify({ rows }, null, 2)}\n`, { flag: 'wx' }); // created here, so never written through a link
  renameSync(temp, file);
  return file;
}

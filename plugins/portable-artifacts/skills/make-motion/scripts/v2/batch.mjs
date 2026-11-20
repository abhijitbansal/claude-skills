// make.mjs <film> --batch <rows.json> --out "<folder>/{name}.mp4": one video per row of values for the film's vars.
// Every row is substituted, validated and given its file name before anything renders; then the rows render in turn
// in one browser (one page each), and manifest.json in the template's folder lists each row's values, status, file,
// SHA-256 and findings. A row that fails while rendering is marked failed and the rest still render. Row values are
// data: a value used in a file name holds no path separator, no "..", no control character, no leading dot and no
// Windows device name, and the files stay inside the template's folder.
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { launchRunBrowser } from './session.mjs';
import { loadFilm, readFilmFile } from './pipeline.mjs';
import { SpecError } from './spec-common.mjs';

export const BATCH_MAX_ROWS = 500;
const ROWS_MAX_BYTES = 1024 * 1024;
const PLACEHOLDER_RE = /\{([^{}]*)\}/g;
const RESERVED_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i; // Windows device names, with or without an extension
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const EXIT_OK = 0;
const EXIT_NOT_OK = 1;
const EXIT_USAGE = 2;

/** A batch the rows or the template make impossible; its message names the row or the flag. */
export class BatchError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BatchError';
  }
}

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The rows of a rows file: a JSON array of at most BATCH_MAX_ROWS objects. Throws a BatchError saying what is wrong. */
export function readRows(file) {
  let text;
  try {
    if (statSync(file).size > ROWS_MAX_BYTES) throw new BatchError(`${file} is over ${ROWS_MAX_BYTES} bytes; a rows file is a list of small objects`);
    text = readFileSync(file, 'utf8');
  } catch (err) {
    if (err instanceof BatchError) throw err;
    throw new BatchError(`cannot read the rows file ${file}: ${err.code ?? err.message}`);
  }
  let rows;
  try {
    rows = JSON.parse(text);
  } catch (err) {
    throw new BatchError(`${file} is not valid JSON: ${err.message}`);
  }
  if (!Array.isArray(rows)) throw new BatchError(`${file} must be a JSON array of rows, like [{ "name": "Ada" }]`);
  if (rows.length > BATCH_MAX_ROWS) throw new BatchError(`${file} has ${rows.length} rows; at most ${BATCH_MAX_ROWS}`);
  const bad = rows.findIndex((row) => !isPlain(row));
  if (bad >= 0) throw new BatchError(`row ${bad + 1}: must be an object of var values, like { "name": "Ada" }`);
  return rows;
}

// Why `text` cannot be part of a file name, or null.
function nameProblem(text) {
  if (text === '') return 'is empty';
  if (text.includes('/') || text.includes('\\')) return 'holds a path separator';
  if (text.includes('..')) return 'holds ".."';
  if (CONTROL_RE.test(text)) return 'holds a control character';
  if (text.startsWith('.')) return 'starts with a dot';
  if (RESERVED_RE.test(text)) return 'is a name Windows keeps for a device';
  return null;
}

/**
 * The file of row `index` (from 1): the template with {index} and each {var} filled from `row` (else the var's default).
 * Throws a BatchError naming the row for a value that cannot be in a file name, or naming the flag for a placeholder
 * that is not {index} or a var.
 */
export function outPathFor(template, row, index, vars = {}) {
  const name = path.basename(template).replace(PLACEHOLDER_RE, (match, key) => {
    if (key === 'index') return String(index);
    if (!Object.hasOwn(vars, key)) throw new BatchError(`--out: {${key}} is not a var of the film; use {index} or one of: ${Object.keys(vars).join(', ') || '(the film has no vars)'}`);
    const text = String(Object.hasOwn(row, key) ? row[key] : vars[key].default);
    const problem = nameProblem(text);
    if (problem) throw new BatchError(`row ${index}: the value of "${key}" (${JSON.stringify(text)}) ${problem}, so it cannot be a file name`);
    return text;
  });
  if (nameProblem(name) !== null) throw new BatchError(`row ${index}: the file name ${JSON.stringify(name)} ${nameProblem(name)}`);
  return path.join(path.dirname(template), name);
}

// The template's folder may not be a symbolic link (the files would land elsewhere).
function folderProblem(template) {
  const folder = path.dirname(path.resolve(template));
  try {
    if (lstatSync(folder).isSymbolicLink()) return `--out: the folder ${folder} is a symbolic link; name a real folder for the videos`;
  } catch {
    return null; // not there yet: it is made inside its parent
  }
  return null;
}

// Each row's values (only the film's vars), with one warning per unknown column.
function rowValues(rows, vars, log) {
  const unknown = [...new Set(rows.flatMap((row) => Object.keys(row).filter((k) => !Object.hasOwn(vars, k))))];
  for (const column of unknown) log(`make: batch: column "${column}" is not a var of the film; it is ignored`);
  return rows.map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => Object.hasOwn(vars, k))));
}

// The file of each row, with an error for each refused value and each pair of rows that give one file.
function rowFiles(template, values, vars, errors) {
  const seen = new Map();
  return values.map((row, i) => {
    try {
      const file = outPathFor(template, row, i + 1, vars);
      const key = path.resolve(file).normalize('NFC').toUpperCase().toLowerCase();
      if (seen.has(key)) errors.push(`rows ${seen.get(key)} and ${i + 1} both write ${file}; give each row its own file name`);
      else seen.set(key, i + 1);
      return file;
    } catch (err) {
      if (!(err instanceof BatchError)) throw err;
      errors.push(err.message);
      return null;
    }
  });
}

// Each row's film, validated with its values: a problem is `row N: <path>: <message>`.
function rowFilmErrors(specPath, values) {
  return values.flatMap((row, i) => {
    try {
      loadFilm(specPath, { values: row });
      return [];
    } catch (err) {
      if (!(err instanceof SpecError)) throw err;
      return err.errors.map((e) => `row ${i + 1}: ${e.path}: ${e.message}`);
    }
  });
}

/** Every row checked: { rows: [{ index, values, file }], errors: string[] }. Nothing renders here. */
export function planBatch({ specPath, batch, out }, log = () => {}) {
  const film = readFilmFile(specPath);
  const vars = isPlain(film?.vars) ? film.vars : {};
  const rows = readRows(batch);
  const values = rowValues(rows, vars, log);
  const errors = [folderProblem(out)].filter(Boolean);
  const files = rowFiles(out, values, vars, errors);
  errors.push(...rowFilmErrors(specPath, values));
  return { rows: values.map((v, i) => ({ index: i + 1, values: v, file: files[i] })), errors };
}

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

// One row rendered through `runRow` (run.mjs runMake's signature) in the shared browser: its manifest entry.
async function renderRow(row, { options, io, browser }) {
  try {
    const { report, exitCode } = await io.runRow({ ...options, batch: null, out: row.file, values: row.values }, { signal: io.signal, log: io.log, browser });
    const written = report.output ?? (exitCode !== 2 ? row.file : null);
    const status = report.error ? 'failed' : report.ok ? 'ok' : 'findings';
    return { ...row, status, sha256: status === 'failed' || written === null ? null : sha256(row.file), findings: report.findings ?? [], ...(report.error ? { error: report.error.message } : {}) };
  } catch (err) {
    if (io.signal?.aborted) throw err;
    return { ...row, status: 'failed', sha256: null, findings: [], error: String(err?.message ?? err).split('\n')[0] };
  }
}

function writeManifest(file, entries) {
  mkdirSync(path.dirname(file), { recursive: true });
  const partial = `${file}.partial-${process.pid}`;
  try {
    writeFileSync(partial, `${JSON.stringify({ rows: entries }, null, 2)}\n`, { flag: 'wx' });
    renameSync(partial, file);
  } finally {
    rmSync(partial, { force: true });
  }
}

/**
 * The batch: { report: { ok, manifest, rows, errors }, exitCode } (0 every row ok, 1 a row refused before rendering or
 * not ok after, 2 a rows file that cannot be read). `io`: log, signal, and seams launch (session.mjs launchRunBrowser) and runRow
 * (run.mjs runMake).
 */
export async function runBatch(options, io) {
  let plan;
  try {
    plan = planBatch(options, io.log);
  } catch (err) {
    if (!(err instanceof BatchError)) throw err;
    return { report: { ok: false, manifest: null, rows: [], errors: [err.message] }, exitCode: EXIT_USAGE };
  }
  if (plan.errors.length > 0) return { report: { ok: false, manifest: null, rows: [], errors: plan.errors }, exitCode: EXIT_NOT_OK };
  const browser = await (io.launch ?? launchRunBrowser)({ ownSignals: true });
  const entries = [];
  try {
    for (const row of plan.rows) entries.push(await renderRow(row, { options, io, browser }));
  } finally {
    await browser.close();
  }
  const manifest = path.join(path.dirname(path.resolve(options.out)), 'manifest.json');
  writeManifest(manifest, entries);
  const ok = entries.every((e) => e.status === 'ok');
  return { report: { ok, manifest, rows: entries.map(({ index, status, file, sha256: hash }) => ({ index, status, file, sha256: hash })), errors: [] }, exitCode: ok ? EXIT_OK : EXIT_NOT_OK };
}

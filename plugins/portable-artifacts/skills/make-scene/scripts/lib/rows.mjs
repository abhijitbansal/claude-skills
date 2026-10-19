// Data sources: local path rules and loading rows (and links) from the spec,
// a JSON file, or a CSV. The validator calls these; so does the build.
import fs from 'node:fs';
import path from 'node:path';
import { didYouMean } from '../../shared/errors.mjs';
import { parseCsv } from './csv.mjs';
import { COLUMN_FIELDS } from './schema.mjs';

const q = (v) => JSON.stringify(v);
const URL_LIKE = /^([a-z][a-z0-9+.-]*:\/\/|(data|file|javascript):)/i;
const OPTIONAL_FIELDS = ['t', 'label', 'parent'];
const FILE_KEYS = ['rows', 'links'];
const MAX_LISTED = 12;

/** Problems found while reading a source: [{ path, message }]. */
export class DataError extends Error {
  constructor(errors) {
    super(errors[0].message);
    this.name = 'DataError';
    this.errors = errors;
  }
}

// -> { abs } or { error }. The same rule for data.file, data.csv and lift.*:
// a local file inside the spec folder (symlinks followed), unless allowed out.
export function resolveLocal(ref, dir, { allowOutside = false } = {}) {
  if (URL_LIKE.test(ref)) return { error: `${q(ref)} is not a local file; no URLs, download it next to the spec first` };
  if (!allowOutside) {
    if (path.isAbsolute(ref)) return { error: `absolute paths are not allowed (${q(ref)}); use a path inside the spec folder or pass --allow-outside` };
    if (path.normalize(ref).split(path.sep)[0] === '..') {
      return { error: `${q(ref)} is outside the spec folder; move the file next to the spec or pass --allow-outside` };
    }
  }
  const wanted = path.resolve(dir, ref);
  let real;
  try {
    real = fs.realpathSync(wanted);
  } catch {
    return { error: `file not found: ${q(ref)} (looked for ${wanted})` };
  }
  if (!allowOutside) {
    const rel = path.relative(fs.realpathSync(dir), real);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
      return { error: `${q(ref)} resolves outside the spec folder (${real}); move the file next to the spec or pass --allow-outside` };
    }
  }
  if (!fs.statSync(real).isFile()) return { error: `not a regular file: ${real}` };
  return { abs: real };
}

function readText(ref, dir, at) {
  // loadData is also called after validation; the path rules were checked there.
  const abs = path.resolve(dir, ref);
  try {
    return fs.readFileSync(abs, 'utf8');
  } catch (e) {
    throw new DataError([{ path: at, message: `cannot read ${q(ref)}: ${e.code ?? e.message}` }]);
  }
}

function readJsonFile(ref, dir) {
  let parsed;
  try {
    parsed = JSON.parse(readText(ref, dir, 'data.file'));
  } catch (e) {
    if (e instanceof DataError) throw e;
    throw new DataError([{ path: 'data.file', message: `${q(ref)} is not valid JSON: ${e.message}` }]);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.rows)) {
    throw new DataError([{ path: 'data.file', message: `${q(ref)} must be { "rows": [...], "links": [...] } with a rows array` }]);
  }
  const unknown = Object.keys(parsed).filter((k) => !FILE_KEYS.includes(k));
  if (unknown.length) {
    throw new DataError(unknown.map((k) => {
      const hint = didYouMean(k, FILE_KEYS);
      return { path: `data.file.${k}`, message: `unknown property; ${hint ? `did you mean ${q(hint)}?` : `allowed: ${FILE_KEYS.join(', ')}`}` };
    }));
  }
  return { rows: parsed.rows, links: parsed.links ?? [] };
}

function headerErrors(header, wanted) {
  return wanted.flatMap(({ field, column, required }) => {
    if (header.includes(column)) return [];
    if (!required && column === undefined) return [];
    const hint = didYouMean(column, header);
    const message = `csv has no column ${q(column)}; ${hint ? `did you mean ${q(hint)}?` : `available: ${header.slice(0, MAX_LISTED).join(', ')}`}`;
    return [{ path: `data.columns.${field}`, message }];
  });
}

// Map CSV headers to row fields. A field missing from `columns` falls back to
// the header of the same name (required fields must exist; optional ones may not).
function csvColumns(header, columns = {}) {
  const wanted = COLUMN_FIELDS.map((field) => {
    const explicit = columns[field];
    const required = field === 'group' || field === 'value' || explicit !== undefined;
    const column = explicit ?? (required || header.includes(field) ? field : undefined);
    return { field, column, required };
  });
  const errors = headerErrors(header, wanted);
  if (errors.length) throw new DataError(errors);
  return wanted.filter((w) => w.column !== undefined);
}

const NUMERIC = /^-?\d+(\.\d+)?$/;

function readCsv(ref, dir, columns) {
  let table;
  try {
    table = parseCsv(readText(ref, dir, 'data.csv'));
  } catch (e) {
    if (e instanceof DataError) throw e;
    throw new DataError([{ path: 'data.csv', message: `${q(ref)}: ${e.message}` }]);
  }
  if (table.length === 0) throw new DataError([{ path: 'data.csv', message: `${q(ref)} is empty; the first line must be the column headers` }]);
  const [header, ...lines] = table.map((r, i) => (i === 0 ? r.map((c) => c.trim()) : r));
  const map = csvColumns(header, columns);
  const rows = lines.map((cells) => {
    const row = {};
    for (const { field, column } of map) {
      const cell = (cells[header.indexOf(column)] ?? '').trim();
      if (field === 'value') row.value = cell === '' ? Number.NaN : Number(cell);
      else if (cell !== '') row[field] = cell;
    }
    return row;
  });
  // A time column that is all numbers sorts as numbers, not as text.
  const ts = rows.filter((r) => r.t !== undefined);
  if (ts.length > 0 && ts.every((r) => NUMERIC.test(r.t))) for (const r of ts) r.t = Number(r.t);
  return { rows, links: [] };
}

/**
 * Read the rows and links one data source supplies, without validating them.
 * Throws DataError for unreadable or malformed files and missing CSV columns.
 */
export function readSource(spec, dir) {
  const data = spec.data ?? {};
  if (data.rows !== undefined) return { rows: data.rows, links: [] };
  if (data.file !== undefined) return readJsonFile(data.file, dir);
  if (data.csv !== undefined) return readCsv(data.csv, dir, data.columns);
  return { rows: [], links: [] };
}

/** { rows, links } of a data scene, from whichever source it names. */
export function loadData(spec, dir) {
  const { rows, links } = readSource(spec, dir);
  return { rows, links: [...links, ...(spec.links ?? [])] };
}

/** Lowercased groups and labels: what a tour beat's focus may name. */
export function focusKeys(rows) {
  const keys = new Set();
  for (const r of rows) {
    keys.add(r.group.toLowerCase());
    if (typeof r.label === 'string' && r.label !== '') keys.add(r.label.toLowerCase());
  }
  return keys;
}

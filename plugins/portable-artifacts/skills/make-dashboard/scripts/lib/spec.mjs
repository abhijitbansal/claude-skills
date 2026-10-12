// dashboard.json: JSON Schema, loading, and the layered validation
// (schema -> cross-references -> SQL -> Vega-Lite compile).
import fs from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import { compile } from 'vega-lite';
import { formatAjvErrors, didYouMean, pathJoin } from '../../shared/errors.mjs';
import {
  openDb, openLockedDb, checkSelect, describeQuery, errMessage, DEFAULT_TIMEOUT_MS,
} from './sql.mjs';
import {
  checkSource, envUrl, sourceShapeErrors, policyFor, RESERVED_SOURCE_NAMES, FILE_TYPES, SOURCE_TYPES, URL_TYPES,
} from './sources.mjs';
import { UsageError } from '../../shared/cli.mjs';
import { listThemes } from '../../shared/theme.mjs';
import { KIND_NAMES, roleErrors } from './kinds.mjs';
import { checkFields } from './data.mjs';

const NAME = '^[a-z][a-z0-9_]*$';
const ID = '^[A-Za-z][A-Za-z0-9_-]*$';

export const FORMATS = ['number', 'currency', 'percent', 'compact'];
export const WIDTHS = ['full', 'half'];
export const MAX_ROWS_DEFAULT = 5000;
export { UsageError, SOURCE_TYPES };

export const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'sources', 'queries'],
  properties: {
    title: { type: 'string', minLength: 1 },
    description: { type: 'string' },
    maxRows: { type: 'integer', minimum: 1, maximum: 100000 },
    theme: { type: 'string', minLength: 1 },
    sources: {
      type: 'object',
      propertyNames: { pattern: NAME },
      additionalProperties: {
        type: 'object',
        additionalProperties: false,
        required: ['type'],
        properties: {
          type: { enum: SOURCE_TYPES },
          path: { type: 'string', minLength: 1 },
          env: { type: 'string', pattern: '^[A-Z_][A-Z0-9_]*$' },
        },
      },
    },
    queries: {
      type: 'object',
      propertyNames: { pattern: NAME },
      additionalProperties: { type: 'string', minLength: 1 },
    },
    kpis: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'query', 'field'],
        properties: {
          id: { type: 'string', pattern: ID },
          title: { type: 'string', minLength: 1 },
          query: { type: 'string' },
          field: { type: 'string', minLength: 1 },
          format: { enum: FORMATS },
        },
      },
    },
    charts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'query'],
        properties: {
          id: { type: 'string', pattern: ID },
          title: { type: 'string', minLength: 1 },
          query: { type: 'string' },
          width: { enum: WIDTHS },
          vegaLite: { type: 'object' },
          kind: { enum: KIND_NAMES },
          x: { type: 'string', minLength: 1 },
          y: { type: 'string', minLength: 1 },
          color: { type: 'string', minLength: 1 },
          size: { type: 'string', minLength: 1 },
          value: { type: 'string', minLength: 1 },
          format: { enum: FORMATS },
          views: { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true, maxItems: 6 },
          pair: { type: 'boolean' },
        },
      },
    },
  },
};

const ajv = new Ajv({ allErrors: true, strict: true, verbose: true });
const validateSchema = ajv.compile(SCHEMA);

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

// [item, path] for every KPI and chart, for the shared checks below.
function items(spec) {
  return [
    ...(spec.kpis ?? []).map((k, i) => [k, pathJoin('kpis', i)]),
    ...(spec.charts ?? []).map((c, i) => [c, pathJoin('charts', i)]),
  ];
}

// Chart keys only a kind chart reads; on a raw vegaLite chart they would be ignored silently.
const KIND_ONLY_KEYS = ['x', 'y', 'color', 'size', 'value', 'views', 'format', 'pair'];

function crossRefs(spec, dir, { allowOutside }) {
  const errors = [];
  const queryNames = Object.keys(spec.queries ?? {});
  const seen = new Set();
  for (const [item, p] of items(spec)) {
    if (seen.has(item.id)) errors.push({ path: pathJoin(p, 'id'), message: `duplicate id ${JSON.stringify(item.id)}` });
    seen.add(item.id);
    if (!queryNames.includes(item.query)) {
      const hint = didYouMean(item.query, queryNames);
      errors.push({
        path: pathJoin(p, 'query'),
        message: `${JSON.stringify(item.query)} not found; ${hint ? `did you mean ${JSON.stringify(hint)}?` : `available: ${queryNames.join(', ')}`}`,
      });
    }
  }
  for (const [name, src] of Object.entries(spec.sources ?? {})) {
    if (RESERVED_SOURCE_NAMES.includes(name)) {
      errors.push({ path: `sources.${name}`, message: `${JSON.stringify(name)} is reserved by DuckDB; choose another source name` });
      continue;
    }
    const shape = sourceShapeErrors(name, src);
    errors.push(...shape);
    if (shape.length) continue;
    if (FILE_TYPES.includes(src.type)) {
      const { error } = checkSource(src, dir, { allowOutside });
      if (error) errors.push({ path: `sources.${name}.path`, message: error });
    } else if (URL_TYPES.includes(src.type)) {
      const { error } = envUrl(src);
      if (error) errors.push({ path: `sources.${name}.env`, message: error });
    }
  }
  (spec.charts ?? []).forEach((c, i) => {
    const p = pathJoin('charts', i);
    if (c.kind && c.vegaLite) errors.push({ path: p, message: 'use either kind or vegaLite, not both' });
    else if (!c.kind && !c.vegaLite) errors.push({ path: p, message: `add kind (one of ${KIND_NAMES.join(', ')}) or vegaLite` });
    else if (!c.kind) {
      for (const key of KIND_ONLY_KEYS) {
        if (c[key] !== undefined) errors.push({ path: pathJoin(p, key), message: `${key} needs kind (raw vegaLite charts ignore it)` });
      }
    }
  });
  if (spec.theme !== undefined && !listThemes().includes(spec.theme)) {
    const themes = listThemes();
    const hint = didYouMean(spec.theme, themes);
    errors.push({ path: 'theme', message: `unknown theme ${JSON.stringify(spec.theme)}; ${hint ? `did you mean ${JSON.stringify(hint)}?` : `available: ${themes.join(', ')}`}` });
  }
  return errors;
}

async function sqlErrors(spec) {
  const errors = [];
  const policy = policyFor(spec);
  const db = await openDb();
  try {
    for (const [name, sql] of Object.entries(spec.queries ?? {})) {
      const msg = await checkSelect(db.conn, sql, policy);
      if (msg) errors.push({ path: `queries.${name}`, message: msg });
    }
  } finally {
    db.close();
  }
  return errors;
}

const MARKS = [
  'arc', 'area', 'bar', 'boxplot', 'circle', 'errorband', 'errorbar', 'geoshape', 'image',
  'line', 'point', 'rect', 'rule', 'square', 'text', 'tick', 'trail',
];

const FORBIDDEN_KEYS = {
  url: 'not allowed — external URLs are never fetched',
  usermeta: 'not allowed — page options are fixed',
  data: 'not allowed — vegaLite may not define or load data (use a SQL query)',
};

// Model-written specs must never make the page fetch anything or change the
// embed options, wherever the key hides (lookup.from.data, image url, ...).
function forbiddenKeys(node, p, errors) {
  if (Array.isArray(node)) {
    node.forEach((n, i) => forbiddenKeys(n, pathJoin(p, i), errors));
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if (key in FORBIDDEN_KEYS) {
      const top = key === 'data' && p.endsWith('.vegaLite');
      errors.push({ path: pathJoin(p, key), message: top ? 'remove — data is injected from the query' : FORBIDDEN_KEYS[key] });
    } else {
      forbiddenKeys(value, pathJoin(p, key), errors);
    }
  }
}

function inspectMarks(vl, p, errors) {
  if (!vl || typeof vl !== 'object') return;
  const mark = typeof vl.mark === 'string' ? vl.mark : vl.mark?.type;
  if (typeof mark === 'string' && !MARKS.includes(mark)) {
    const hint = didYouMean(mark, MARKS);
    errors.push({
      path: pathJoin(p, 'mark'),
      message: `unknown mark ${JSON.stringify(mark)}; ${hint ? `did you mean ${JSON.stringify(hint)}?` : `allowed: ${MARKS.join(', ')}`}`,
    });
  }
  for (const key of ['layer', 'hconcat', 'vconcat', 'concat']) {
    if (Array.isArray(vl[key])) vl[key].forEach((sub, i) => inspectMarks(sub, pathJoin(pathJoin(p, key), i), errors));
  }
  if (vl.spec) inspectMarks(vl.spec, pathJoin(p, 'spec'), errors);
}

function vegaLiteErrors(spec) {
  const errors = [];
  (spec.charts ?? []).forEach((chart, i) => {
    if (!chart.vegaLite) return;
    const p = `${pathJoin('charts', i)}.vegaLite`;
    const found = [];
    forbiddenKeys(chart.vegaLite, p, found);
    inspectMarks(chart.vegaLite, p, found);
    errors.push(...found);
    if (found.length) return;
    try {
      compile({ ...chart.vegaLite, data: { values: [] } });
    } catch (e) {
      errors.push({ path: p, message: `Vega-Lite compile error: ${e.message}` });
    }
  });
  return errors;
}

// Describe each query (LIMIT 0) on the locked db, so "valid" means buildable
// and field/role checks see real column names and types.
async function bindQueries(spec, dir, { allowOutside, timeoutMs }) {
  let db;
  try {
    db = await openLockedDb(spec, dir, { allowOutside });
  } catch (e) {
    return { errors: e.errors ?? [{ path: 'sources', message: errMessage(e) }], described: {} };
  }
  const errors = [];
  const described = {};
  try {
    for (const [name, sql] of Object.entries(spec.queries)) {
      try {
        described[name] = await describeQuery(db.conn, sql, timeoutMs);
      } catch (e) {
        errors.push({ path: `queries.${name}`, message: errMessage(e, 3, db.scrub) });
      }
    }
  } finally {
    db.close();
  }
  return { errors, described };
}

export async function validateSpec(spec, { dir, allowOutside = false, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (!validateSchema(spec)) {
    return { ok: false, errors: formatAjvErrors(validateSchema.errors ?? []) };
  }
  const refs = crossRefs(spec, dir, { allowOutside });
  const sql = await sqlErrors(spec);
  const errors = [...refs, ...sql, ...vegaLiteErrors(spec)];
  if (!refs.length && !sql.length) {
    const bound = await bindQueries(spec, dir, { allowOutside, timeoutMs });
    errors.push(...bound.errors);
    if (!bound.errors.length && !errors.length) {
      errors.push(...checkFields(spec, bound.described), ...roleErrors(spec, bound.described));
    }
  }
  return { ok: errors.length === 0, errors };
}

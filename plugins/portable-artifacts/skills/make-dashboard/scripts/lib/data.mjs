// Run the spec's queries against locked-down in-memory DuckDB and make the
// results JSON-safe. Also: the post-query field check for charts and KPIs.
import { didYouMean, pathJoin } from '../../shared/errors.mjs';
import {
  openLockedDb, runTimed, describeQuery, wrapLimit, quoteId, errMessage, DEFAULT_TIMEOUT_MS,
} from './sql.mjs';
import { MAX_ROWS_DEFAULT } from './spec.mjs';

export class QueryError extends Error {
  constructor(errors) {
    super(errors.map((e) => `${e.path}: ${e.message}`).join('\n'));
    this.name = 'QueryError';
    this.errors = errors;
  }
}

// BigInt -> Number when exact, else string; Date -> ISO; NaN/Infinity -> null.
export function toJsonSafe(value) {
  if (value === null || value === undefined) return null;
  switch (typeof value) {
    case 'bigint':
      return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(value)
        : value.toString();
    case 'number':
      return Number.isFinite(value) ? value : null;
    case 'string':
    case 'boolean':
      return value;
    case 'object':
      if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
      if (ArrayBuffer.isView(value)) return `<blob ${value.byteLength} bytes>`;
      if (Array.isArray(value)) return value.map(toJsonSafe);
      if (Object.getPrototypeOf(value) === Object.prototype) {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toJsonSafe(v)]));
      }
      return String(value);
    default:
      return String(value);
  }
}

// How each DuckDB type reaches JSON. Types JS cannot convert safely (infinite
// or out-of-range dates, intervals, blobs, wide decimals, nested values) are
// converted in SQL first, then normalised here.
function classify(type) {
  if (type === 'DATE' || type === 'TIME' || type === 'TIME WITH TIME ZONE' || type === 'INTERVAL') return 'text';
  if (type.startsWith('TIMESTAMP')) return 'timestamp';
  if (type === 'BLOB') return 'blob';
  if (type === 'BIT') return 'bit';
  const dec = /^DECIMAL\((\d+),\d+\)$/.exec(type);
  if (dec && Number(dec[1]) > 15) return 'decimal';
  if (/\[\d*\]$/.test(type) || /^(STRUCT|MAP|UNION)\(/.test(type)) return 'nested';
  return 'plain';
}

function selectItem(kind, q) {
  switch (kind) {
    case 'text': case 'timestamp': case 'decimal': return `CAST(${q} AS VARCHAR) AS ${q}`;
    case 'blob': return `'<blob ' || octet_length(${q}) || ' bytes>' AS ${q}`;
    case 'bit': return `'<bit ' || bit_length(${q}) || ' bits>' AS ${q}`;
    case 'nested': return `CAST(to_json(${q}) AS VARCHAR) AS ${q}`;
    default: return q;
  }
}

const TS = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)(\.\d+)?(Z|[+-]\d\d(?::?\d\d)?)?$/;

// '2024-01-02 03:04:05' -> ISO with ms and Z; 'infinity' / out-of-range stay strings.
function timestampToJson(text) {
  const m = TS.exec(text);
  if (!m) return text;
  const [, y, mo, d, h, mi, se, frac = '', tz] = m;
  const ms = (frac || '.000').slice(0, 4).padEnd(4, '0');
  if (!tz) return `${y}-${mo}-${d}T${h}:${mi}:${se}${ms}Z`;
  const zone = tz === 'Z' ? 'Z' : tz.length === 3 ? `${tz}:00` : tz.includes(':') ? tz : `${tz.slice(0, 3)}:${tz.slice(3)}`;
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${se}${ms}${zone}`);
  return Number.isNaN(date.getTime()) ? text : date.toISOString();
}

// A number when it has at most 15 significant digits, else the exact string.
function decimalToJson(text) {
  const digits = text.replace(/^-/, '').replace('.', '').replace(/^0+/, '');
  return digits.length <= 15 ? Number(text) : text;
}

// Integers JSON.parse would round come back as their exact digit strings.
function parseNested(text) {
  return JSON.parse(text, (_key, value, context) => (
    typeof value === 'number' && !Number.isSafeInteger(value) && /^-?\d+$/.test(context?.source ?? '')
      ? context.source
      : value));
}

function scrubValue(value, scrub) {
  if (typeof value === 'string') return scrub(value);
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, scrub));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [scrub(k), scrubValue(v, scrub)]));
  return value;
}

const CONVERT = {
  timestamp: (v) => timestampToJson(v),
  decimal: (v) => decimalToJson(v),
  nested: (v) => parseNested(v),
};

// Run one query (already validated as a SELECT). -> { rows, columns, types, truncated }
// Every string cell goes through `scrubCell` (defence in depth: a secret that
// reached a result row must not reach the page).
export async function fetchQuery(conn, sql, maxRows, timeoutMs = DEFAULT_TIMEOUT_MS, scrubCell = (t) => t) {
  const { columns, types } = await describeQuery(conn, sql, timeoutMs);
  const kinds = types.map(classify);
  const select = kinds.some((k) => k !== 'plain')
    ? columns.map((c, i) => selectItem(kinds[i], quoteId(c))).join(', ')
    : '*';
  const reader = await runTimed(conn, wrapLimit(sql, maxRows + 1, select), timeoutMs);
  const all = reader.getRowObjectsJS().map((row) => Object.fromEntries(columns.map((c, i) => {
    const v = toJsonSafe(row[c]);
    return [c, v === null ? null : scrubValue(CONVERT[kinds[i]]?.(v) ?? v, scrubCell)];
  })));
  const truncated = all.length > maxRows;
  return { rows: truncated ? all.slice(0, maxRows) : all, columns, types, truncated };
}

export async function runQueries(spec, dir, { now = new Date(), allowOutside = false, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const maxRows = spec.maxRows ?? MAX_ROWS_DEFAULT;
  const refreshedAt = now.toISOString();
  const results = {};
  const errors = [];
  let db;
  try {
    db = await openLockedDb(spec, dir, { allowOutside });
  } catch (e) {
    throw new QueryError(e.errors ?? [{ path: 'sources', message: errMessage(e) }]);
  }
  try {
    for (const [name, sql] of Object.entries(spec.queries)) {
      try {
        const { rows, columns, truncated } = await fetchQuery(db.conn, sql, maxRows, timeoutMs, db.scrubData);
        results[name] = { rows, columns, rowCount: rows.length, truncated, sql, refreshedAt };
      } catch (e) {
        errors.push({ path: `queries.${name}`, message: errMessage(e, 3, db.scrub) });
      }
    }
  } finally {
    db.close();
  }
  if (errors.length) throw new QueryError(errors);
  return results;
}

// ---- field check ----------------------------------------------------------

// Fields created by Vega-Lite transforms (`as`, fold) are not query columns.
function derivedFields(node, out, state) {
  if (Array.isArray(node)) { node.forEach((n) => derivedFields(n, out, state)); return; }
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node.transform)) {
    for (const t of node.transform) {
      collectAs(t, out);
      if (t.fold) { out.add('key'); out.add('value'); }
      const unpredictable = ['pivot', 'stack', 'density', 'loess', 'regression', 'quantile'];
      if (unpredictable.some((k) => k in t) && !t.as) state.lax = true;
    }
  }
  for (const [k, v] of Object.entries(node)) if (k !== 'data' && k !== 'transform') derivedFields(v, out, state);
}

function collectAs(node, out) {
  if (Array.isArray(node)) { node.forEach((n) => collectAs(n, out)); return; }
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'as') [].concat(v).forEach((n) => typeof n === 'string' && out.add(n));
    else collectAs(v, out);
  }
}

function channelDefs(def) {
  if (Array.isArray(def)) return def.flatMap(channelDefs);
  if (!def || typeof def !== 'object') return [];
  return [def, ...channelDefs(def.condition)];
}

function* encodingFields(node, p) {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) yield* encodingFields(node[i], pathJoin(p, i));
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'data' || k === 'transform') continue;
    if (k === 'encoding' && v && typeof v === 'object') {
      for (const [channel, def] of Object.entries(v)) {
        const base = pathJoin(pathJoin(p, 'encoding'), channel);
        const single = !Array.isArray(def) && !def?.condition;
        for (const d of channelDefs(def)) {
          if (typeof d.field === 'string') yield { field: d.field, path: single ? pathJoin(base, 'field') : base };
          if (typeof d.sort?.field === 'string') yield { field: d.sort.field, path: pathJoin(pathJoin(base, 'sort'), 'field') };
        }
      }
    } else if (k === 'facet' && v && typeof v === 'object') {
      const base = pathJoin(p, 'facet');
      if (typeof v.field === 'string') yield { field: v.field, path: pathJoin(base, 'field') };
      for (const dim of ['row', 'column']) {
        if (typeof v[dim]?.field === 'string') yield { field: v[dim].field, path: pathJoin(pathJoin(base, dim), 'field') };
      }
      yield* encodingFields(v, base);
    } else {
      yield* encodingFields(v, pathJoin(p, k));
    }
  }
}

function fieldError(field, query, columns) {
  const hint = didYouMean(field, columns);
  return `${JSON.stringify(field)} is not a column of query ${JSON.stringify(query)} (columns: ${columns.join(', ')})${hint ? `; did you mean ${JSON.stringify(hint)}?` : ''}`;
}

export function checkFields(spec, results) {
  const errors = [];
  (spec.kpis ?? []).forEach((k, i) => {
    const columns = results[k.query]?.columns;
    if (columns && !columns.includes(k.field)) {
      errors.push({ path: `${pathJoin('kpis', i)}.field`, message: fieldError(k.field, k.query, columns) });
    }
  });
  (spec.charts ?? []).forEach((chart, i) => {
    const columns = results[chart.query]?.columns;
    if (!columns) return;
    const derived = new Set();
    const state = { lax: false };
    derivedFields(chart.vegaLite, derived, state);
    if (state.lax) return;
    for (const { field, path } of encodingFields(chart.vegaLite, `${pathJoin('charts', i)}.vegaLite`)) {
      const root = field.split(/[.[]/)[0];
      if (columns.includes(field) || columns.includes(root) || derived.has(field) || derived.has(root)) continue;
      errors.push({ path, message: fieldError(field, chart.query, columns) });
    }
  });
  return errors;
}

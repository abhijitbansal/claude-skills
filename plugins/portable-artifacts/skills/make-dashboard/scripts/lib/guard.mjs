// Allowlist guard for model-written SQL, applied to the json_serialize_sql
// AST (a tree, so no query text, string constant or nesting can hide a table
// or function reference). What is allowed:
//   tables     declared source views, <attached>.<table>, <attached>.<schema>.<table>,
//              and CTEs defined in the same query
//   table fns  range, generate_series, unnest only (everything that reads
//              files, networks, settings or runs nested SQL is a table function)
//   scalars    everything except readers of config, environment and files
// The walker visits every object and array, so a new node type cannot hide a
// reference. CTE scoping follows DuckDB's binder: a CTE body sees only the CTEs
// defined before it (a self or forward reference binds to the *catalog*, which
// is how `WITH duckdb_databases AS (SELECT * FROM duckdb_databases)` would read
// a system view), plus itself in the recursive branch of a real recursive CTE.
// CTE names that shadow system objects are rejected outright as a second layer.
// Returns a message for the first violation, or null.

import { didYouMean } from './errors.mjs';

const ALLOWED_TABLE_FUNCTIONS = ['range', 'generate_series', 'unnest'];
const SYSTEM_NAMES = ['system', 'temp', 'pg_catalog', 'information_schema'];
const DENIED_SCALAR = /^(duckdb_|pg_|sqlite_|postgres_|mysql_|query|read_|pragma_|glob$|current_setting$|getenv$|which_secret$|nextval$|currval$)/i;

export function tableName({ catalog_name: catalog = '', schema_name: schema = '', table_name: table = '' }) {
  return [catalog, schema, table].filter(Boolean).join('.');
}

// policy: { views: Set of source view names, attached: Set of attached source names }
function tableAllowed(ref, policy, ctes) {
  const { catalog_name: c = '', schema_name: s = '', table_name: t = '' } = ref;
  if (SYSTEM_NAMES.includes(c.toLowerCase()) || SYSTEM_NAMES.includes(s.toLowerCase())) return false;
  if (!c && !s) return policy.views.has(t) || ctes.has(t);
  if (!c) return policy.attached.has(s) || (s === 'main' && policy.views.has(t));
  return policy.attached.has(c) || (c === 'memory' && s === 'main' && policy.views.has(t));
}

function tableMessage(ref, policy) {
  const attached = [...policy.attached].map((n) => `${n}.<table>`);
  const readable = [...policy.views, ...attached].join(', ') || 'none';
  const hint = ref.catalog_name || ref.schema_name ? null : didYouMean(ref.table_name, [...policy.views]);
  return `table ${JSON.stringify(tableName(ref))} is not allowed; queries may read only the declared sources (${readable}) and their own CTEs${hint ? `; did you mean ${JSON.stringify(hint)}?` : ''}`;
}

function functionMessage(name) {
  return `function ${name.toLowerCase()}() is not allowed (it can expose local settings and paths or reach outside the declared sources)`;
}

// A function call expression (scalar, aggregate or window).
function checkFunction(node) {
  const catalog = node.catalog ?? '';
  const schema = node.schema ?? '';
  if (catalog || (schema && schema !== 'main')) return `qualified function ${JSON.stringify(`${catalog ? `${catalog}.` : ''}${schema}.${node.function_name}`)} is not allowed`;
  return DENIED_SCALAR.test(node.function_name) ? functionMessage(node.function_name) : null;
}

// `isSystemName(lowercased name)` says whether a CTE name collides with a system object.
export function checkAst(root, policy, isSystemName = () => false) {
  let violation = null;
  const fail = (message) => { violation ??= message; };

  function children(node, ctes, skip) {
    for (const [key, value] of Object.entries(node)) if (key !== skip) visit(value, ctes);
  }

  function visitCtes(node, ctes) {
    const names = [];
    for (const entry of node.cte_map.map) {
      if (isSystemName(String(entry.key).toLowerCase())) fail(`CTE name ${JSON.stringify(entry.key)} shadows a system object; rename it`);
      visit(entry.value, new Set([...ctes, ...names])); // earlier CTEs only
      names.push(entry.key);
    }
    return new Set([...ctes, ...names]); // the main query sees all of them
  }

  function visit(node, ctes) {
    if (violation || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach((n) => visit(n, ctes)); return; }
    let scope = ctes;
    if (node.cte_map?.map?.length) {
      scope = visitCtes(node, ctes);
      children(node, scope, 'cte_map');
      return;
    }

    if (node.type === 'RECURSIVE_CTE_NODE') {
      // only the recursive branch may refer to the CTE itself
      for (const [key, value] of Object.entries(node)) visit(value, key === 'right' ? new Set([...scope, node.cte_name]) : scope);
      return;
    }
    if (node.type === 'BASE_TABLE') {
      if (!tableAllowed(node, policy, scope)) fail(tableMessage(node, policy));
    } else if (node.type === 'SHOW_REF') {
      // DESCRIBE/SUMMARIZE of a query is fine (the query is walked below);
      // SHOW TABLES / DATABASES and friends are not.
      if (!node.query && !tableAllowed(node, policy, scope)) fail(tableMessage(node, policy));
    } else if (node.type === 'TABLE_FUNCTION') {
      const fn = node.function ?? {};
      if (!ALLOWED_TABLE_FUNCTIONS.includes(String(fn.function_name).toLowerCase()) || fn.catalog || (fn.schema && fn.schema !== 'main')) {
        fail(`table function ${String(fn.function_name).toLowerCase()}() is not allowed; allowed: ${ALLOWED_TABLE_FUNCTIONS.join(', ')}`);
      }
      children(node, scope, 'function');
      if (node.function) children(node.function, scope);
      return;
    } else if (typeof node.function_name === 'string') {
      const message = checkFunction(node);
      if (message) fail(message);
    }
    children(node, scope);
  }

  visit(root, new Set());
  return violation;
}

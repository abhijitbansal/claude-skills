// Shared validator error helpers for every portable-artifacts skill.
// Source of truth: plugins/portable-artifacts/shared/. Each skill carries a
// generated copy in <skill>/shared/ (node bin/sync-shared.mjs).

// Edit distance where an adjacent transposition ("bra" -> "bar") costs 1
// (optimal string alignment), so swapped letters rank as the closest typo.
export function levenshtein(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

// Closest candidate, or null when nothing is close enough to be a typo.
export function didYouMean(word, candidates) {
  const w = String(word).toLowerCase();
  let best = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = levenshtein(w, String(c).toLowerCase());
    if (d < bestDist) { best = c; bestDist = d; }
  }
  if (best === null) return null;
  const limit = Math.max(2, Math.floor(w.length / 3));
  if (bestDist <= limit) return best;
  const prefix = candidates.find((c) => {
    const lc = String(c).toLowerCase();
    return w.length >= 3 && (lc.startsWith(w) || w.startsWith(lc));
  });
  return prefix ?? null;
}

export function pathJoin(base, key) {
  if (typeof key === 'number') return `${base}[${key}]`;
  return base ? `${base}.${key}` : String(key);
}

// Ajv instancePath ("/charts/0/query") -> "charts[0].query".
function toPath(instancePath) {
  return instancePath
    .split('/')
    .slice(1)
    .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce((acc, p) => pathJoin(acc, /^\d+$/.test(p) ? Number(p) : p), '');
}

const quote = (v) => JSON.stringify(v);
const NOISE = new Set(['anyOf', 'oneOf', 'if', 'discriminator']);
const BLANK_PATTERN = '\\S'; // as engine/kinds/shared.mjs NOT_BLANK

function formatOne(e) {
  const path = toPath(e.instancePath);
  switch (e.keyword) {
    case 'additionalProperties': {
      const prop = e.params.additionalProperty;
      const allowed = Object.keys(e.parentSchema?.properties ?? {});
      const hint = didYouMean(prop, allowed);
      const message = hint
        ? `unknown property; did you mean ${quote(hint)}?`
        : `unknown property; allowed: ${allowed.join(', ')}`;
      return { path: pathJoin(path, prop), message, renamedTo: hint && pathJoin(path, hint) };
    }
    case 'required':
      return { path: pathJoin(path, e.params.missingProperty), message: 'required' };
    case 'enum': {
      const allowed = e.params.allowedValues;
      const hint = typeof e.data === 'string' ? didYouMean(e.data, allowed.map(String)) : null;
      const list = allowed.map(quote).join(', ');
      return { path, message: `must be one of ${list}${hint ? `; did you mean ${quote(hint)}?` : ''}` };
    }
    case 'const':
      return { path, message: `must be ${quote(e.params.allowedValue)}` };
    case 'type':
      return { path, message: `must be ${e.params.type}` };
    case 'pattern':
      // the kinds' not-blank pattern (engine/kinds/shared.mjs NOT_BLANK): say what is wrong, not the regular expression
      if (e.params.pattern === BLANK_PATTERN) return { path, message: 'must not be blank: write the text, or leave the field out' };
      return { path, message: e.message ?? e.keyword };
    default:
      return { path, message: e.message ?? e.keyword };
  }
}

// The anyOf branch (its index) an error belongs to, or -1: under the anyOf's schemaPath and at or inside its instancePath.
function branchOf(e, anyOf) {
  if (typeof e.schemaPath !== 'string' || typeof e.instancePath !== 'string') return -1;
  const prefix = `${anyOf.schemaPath}/`;
  const inside = e.instancePath === anyOf.instancePath || e.instancePath.startsWith(`${anyOf.instancePath}/`);
  return e.schemaPath.startsWith(prefix) && inside ? Number(e.schemaPath.slice(prefix.length).split('/')[0]) : -1;
}

// How far a branch's errors put it from the value: first whether it failed on the value's own type (a series object
// where an array was given), then how many errors it has.
const distance = (list, anyOf) => [list.some((e) => e.keyword === 'type' && e.instancePath === anyOf.instancePath) ? 1 : 0, list.length];
const closer = (a, b) => a[0] - b[0] || a[1] - b[1];

// For each failed anyOf (outermost first), only the errors of its closest branch (distance; ties to the first), so a
// misspelled key in one shape is not answered by every other shape's errors too.
function closestBranches(errors) {
  let kept = errors;
  const anyOfs = errors.filter((e) => e.keyword === 'anyOf' && typeof e.schemaPath === 'string').sort((a, b) => a.schemaPath.length - b.schemaPath.length);
  for (const anyOf of anyOfs) {
    if (!kept.includes(anyOf)) continue;
    const branches = new Map();
    for (const e of kept) {
      const n = branchOf(e, anyOf);
      if (n >= 0) branches.set(n, [...(branches.get(n) ?? []), e]);
    }
    if (branches.size < 2) continue;
    const [best] = [...branches].sort(([na, a], [nb, b]) => closer(distance(a, anyOf), distance(b, anyOf)) || na - nb)[0];
    kept = kept.filter((e) => [-1, best].includes(branchOf(e, anyOf)));
  }
  return kept;
}

// Turn raw Ajv errors (compile with { allErrors: true, verbose: true }) into
// [{ path, message }] lines that name the field and the fix.
export function formatAjvErrors(errors) {
  const specific = closestBranches(errors).filter((e) => !NOISE.has(e.keyword));
  const source = specific.length ? specific : errors;
  const formatted = source.map(formatOne);
  // "titel: did you mean title" already explains "title: required".
  const renamed = new Set(formatted.map((f) => f.renamedTo).filter(Boolean));
  const seen = new Set();
  const out = [];
  for (const { path, message } of formatted) {
    if (message === 'required' && renamed.has(path)) continue;
    const key = `${path}\u0000${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ path, message });
  }
  return out;
}

export function printResult({ ok, errors }, { json = false, label = 'spec' } = {}) {
  if (json) {
    process.stdout.write(`${JSON.stringify({ ok, errors })}\n`);
    return;
  }
  for (const e of errors) process.stdout.write(`${e.path || '(root)'}: ${e.message}\n`);
  const n = errors.length;
  process.stdout.write(ok ? `${label}: valid\n` : `${label}: ${n} error${n === 1 ? '' : 's'}\n`);
}

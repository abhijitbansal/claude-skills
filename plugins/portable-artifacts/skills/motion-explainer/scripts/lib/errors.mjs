// Shared validator error helpers. This file is copied byte-identically into
// every portable-artifacts skill (CI checks it) so each skill folder stays
// self-contained. Edit one copy, then copy it to the others.

export function levenshtein(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
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
    default:
      return { path, message: e.message ?? e.keyword };
  }
}

// Turn raw Ajv errors (compile with { allErrors: true, verbose: true }) into
// [{ path, message }] lines that name the field and the fix.
export function formatAjvErrors(errors) {
  const specific = errors.filter((e) => !NOISE.has(e.keyword));
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

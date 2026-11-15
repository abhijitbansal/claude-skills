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

// Keys agents reach for that no schema here uses, mapped to the key that means it. Consulted before the
// edit-distance guess, and only when the target is an allowed key at that spot.
const KEY_SYNONYMS = { source: 'from', summary: 'note', host: 'agent' };
const MAX_ENUM_SHOWN = 6;

// "string", "array of string", "integer or null", 'one of "a", "b"'; null when the schema says nothing usable.
// A long closed set (the section types) is not listed here: the wrong-value error lists it when it matters.
function expectedType(schema) {
  if (!schema || typeof schema !== 'object') return null;
  if (Array.isArray(schema.enum) && schema.enum.length <= MAX_ENUM_SHOWN) return `one of ${schema.enum.map(quote).join(', ')}`;
  const types = [schema.type].flat().filter((t) => typeof t === 'string');
  if (types.length === 0) return null;
  const items = types.length === 1 && types[0] === 'array' && typeof schema.items?.type === 'string' ? schema.items.type : null;
  return items ? `array of ${items}` : types.join(' or ');
}

// A whole-string pattern (^...$) lists the characters a value may hold, so the schema's description of such a
// field is a character set. An unanchored pattern (such as '\\S') is only a presence test, and its description
// says what the field is for.
const isWholeStringPattern = (p) => typeof p === 'string' && p.startsWith('^') && p.endsWith('$');

// "required" stays the leading word; the type and the schema's own description say what to put there.
function requiredMessage(schema) {
  const type = expectedType(schema);
  const description = typeof schema?.description === 'string' ? schema.description.trim() : '';
  if (description && isWholeStringPattern(schema?.pattern)) return `required (${type ?? 'value'} containing only ${description})`;
  return `required${type ? ` (${type})` : ''}${description ? `: ${description}` : ''}`;
}

// Item-level "simple" wording belongs on the section as simple.items[n].
function itemSimpleHint(path, prop) {
  if (prop !== 'simple') return null;
  const m = /^(?:(.*)\.)?items\[(\d+)\]$/.exec(path);
  if (!m) return null;
  const target = `${m[1] ? `${m[1]}.` : ''}simple.items[${m[2]}]`;
  return `unknown property; put the simple wording on the section, not the item: ${target}`;
}

function formatOne(e) {
  const path = toPath(e.instancePath);
  switch (e.keyword) {
    case 'additionalProperties': {
      const prop = e.params.additionalProperty;
      const allowed = Object.keys(e.parentSchema?.properties ?? {});
      const itemHint = itemSimpleHint(path, prop);
      if (itemHint) return { path: pathJoin(path, prop), message: itemHint };
      const synonym = KEY_SYNONYMS[prop];
      const hint = synonym && allowed.includes(synonym) ? synonym : didYouMean(prop, allowed);
      const message = hint
        ? `unknown property; did you mean ${quote(hint)}?`
        : `unknown property; allowed: ${allowed.join(', ')}`;
      return { path: pathJoin(path, prop), message, renamedTo: hint && pathJoin(path, hint) };
    }
    case 'required':
      return { path: pathJoin(path, e.params.missingProperty), message: requiredMessage(e.parentSchema?.properties?.[e.params.missingProperty]), isRequired: true };
    case 'pattern': {
      const description = e.parentSchema?.description;
      const isCharacterSet = typeof description === 'string' && description && isWholeStringPattern(e.params?.pattern ?? e.parentSchema?.pattern);
      return { path, message: isCharacterSet ? `must contain only ${description}` : (e.message ?? 'must match pattern') };
    }
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
  for (const { path, message, isRequired } of formatted) {
    if (isRequired && renamed.has(path)) continue;
    const key = `${path}\u0000${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ path, message });
  }
  return out;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// { ok, errors } plus warnings when there are any. Warnings are advice, never a failure: ok follows the errors alone,
// and an empty list is left out so a validator's JSON stays as it was until it has something to warn about.
export function makeResult(errors, warnings = []) {
  const result = { ok: errors.length === 0, errors };
  return warnings.length > 0 ? { ...result, warnings } : result;
}

export function printResult({ ok, errors, warnings = [] }, { json = false, label = 'spec' } = {}) {
  if (json) {
    process.stdout.write(`${JSON.stringify(warnings.length > 0 ? { ok, errors, warnings } : { ok, errors })}\n`);
    return;
  }
  for (const e of errors) process.stdout.write(`${e.path || '(root)'}: ${e.message}\n`);
  for (const w of warnings) process.stdout.write(`${w.path || '(root)'}: warning: ${w.message}\n`);
  const tail = warnings.length > 0 ? plural(warnings.length, 'warning') : '';
  if (ok) process.stdout.write(`${label}: valid${tail ? ` (${tail})` : ''}\n`);
  else process.stdout.write(`${label}: ${plural(errors.length, 'error')}${tail ? `, ${tail}` : ''}\n`);
}

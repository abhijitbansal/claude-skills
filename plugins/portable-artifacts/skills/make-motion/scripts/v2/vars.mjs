// A film's `vars` (root: { [name]: { type: 'string' | 'number', default } }) and substitute(), which puts values into
// the parsed film before it is validated: {{name}} in any string value becomes the value, a string that is exactly
// "{{n}}" for a number var becomes the number, and {{{{ is a literal {{. A value is data: in a `say` its narration marks
// are escaped (a row cannot add emphasis or an aside), and a value that would add a pause or a pronunciation hint, which
// have no escape, is refused. Keys are never substituted, and a file path (a src, a recording, a beats file) takes no
// var. Errors keep the film's paths. Pure: a new film is returned.
import { didYouMean, pathJoin } from '../../shared/errors.mjs';
import { SpecError } from './spec-common.mjs';

export const VARS_MAX = 30;
const NAME_RE = /^[a-zA-Z][a-zA-Z0-9]*$/;
const TYPES = Object.freeze(['string', 'number']);
const TOKEN_RE = /\{\{\{\{|\{\{([^{}]*)\}\}/g;
const WHOLE_RE = /^\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}$/;
const FILE_KEYS = new Set(['src', 'srcs', 'words', 'beats']); // keys whose strings are file paths
const SAY_ESCAPABLE_RE = /[\\*_]/g; // engine/script/say.mjs escapes these with a backslash
const SAY_UNESCAPABLE_RE = /\.\.\.|…|\(\s*\d*\.\d+\s*\)|\]\(\//; // a pause, or a pronunciation hint's "](/"

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The problems with a film's `vars`, as { path, message }: [] when it is absent or good. */
export function varsErrors(spec) {
  const { vars } = spec;
  if (vars === undefined) return [];
  if (!isPlain(vars)) return [{ path: 'vars', message: 'must be an object like { "name": { "type": "string", "default": "Ada" } }' }];
  const names = Object.keys(vars);
  if (names.length > VARS_MAX) return [{ path: 'vars', message: `has ${names.length} vars; at most ${VARS_MAX}` }];
  return names.flatMap((name) => varProblem(name, vars[name]));
}

function varProblem(name, def) {
  const at = pathJoin('vars', name);
  if (!NAME_RE.test(name)) return [{ path: at, message: 'a var name is letters and digits, starting with a letter, such as city or firstName' }];
  if (!isPlain(def) || Object.keys(def).some((k) => k !== 'type' && k !== 'default')) return [{ path: at, message: 'must be { "type": "string" | "number", "default": <a value of that type> }' }];
  if (!TYPES.includes(def.type)) return [{ path: pathJoin(at, 'type'), message: `must be "string" or "number", got ${JSON.stringify(def.type)}` }];
  if (!Object.hasOwn(def, 'default')) return [{ path: at, message: 'needs a default, used when no value is given' }];
  return typeMatches(def.type, def.default) ? [] : [{ path: pathJoin(at, 'default'), message: `must be a ${def.type}, got ${JSON.stringify(def.default)}` }];
}

const typeMatches = (type, value) => (type === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === 'string');

/** Each var's default value. */
export const defaultValues = (vars = {}) => Object.fromEntries(Object.entries(vars).map(([name, def]) => [name, def.default]));

// The values to put in: the defaults, overridden by `values` (each checked against its var's type).
function resolvedValues(vars, values, errors) {
  const out = defaultValues(vars);
  for (const [name, value] of Object.entries(values ?? {})) {
    if (!Object.hasOwn(vars, name)) continue; // a column the film has no var for: the batch warns about it
    if (typeMatches(vars[name].type, value)) out[name] = value;
    else errors.push({ path: pathJoin('vars', name), message: `the value of "${name}" must be a ${vars[name].type}, got ${JSON.stringify(value)}` });
  }
  return out;
}

// A value as it goes into a string at `ctx.path`: in a say, its marks escaped (or refused when they cannot be).
function inserted(name, value, ctx) {
  const text = String(value);
  if (!ctx.isSay) return text;
  if (SAY_UNESCAPABLE_RE.test(text)) {
    ctx.errors.push({ path: ctx.path, message: `the value of "${name}" holds narration markup that has no escape (a pause like ... or (0.4), or a pronunciation hint); write it without` });
    return text;
  }
  return text.replace(SAY_ESCAPABLE_RE, '\\$&');
}

// One string value with its vars put in.
function substituteString(text, ctx) {
  if (!text.includes('{{')) return text;
  const whole = WHOLE_RE.exec(text);
  if (whole && ctx.vars[whole[1]]?.type === 'number') return ctx.values[whole[1]];
  if (ctx.isFile && text.replace(/\{\{\{\{/g, '').includes('{{')) {
    ctx.errors.push({ path: ctx.path, message: 'a file path takes no var: name the file itself' });
    return text;
  }
  return text.replace(TOKEN_RE, (match, name) => {
    if (match === '{{{{') return '{{';
    if (Object.hasOwn(ctx.values, name)) return inserted(name, ctx.values[name], ctx);
    const near = didYouMean(name, Object.keys(ctx.vars));
    ctx.errors.push({ path: ctx.path, message: `unknown var "${name}"${near ? `; did you mean "${near}"?` : ''}` });
    return match;
  });
}

// The value at `path` with its vars put in, as a new value.
function walk(value, path, key, ctx) {
  if (typeof value === 'string') return substituteString(value, { ...ctx, path, isSay: key === 'say', isFile: FILE_KEYS.has(key) || ctx.inFiles });
  if (Array.isArray(value)) return value.map((item, i) => walk(item, pathJoin(path, i), key, { ...ctx, inFiles: FILE_KEYS.has(key) }));
  if (!isPlain(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, path === '' ? k : pathJoin(path, k), k, { ...ctx, inFiles: false })]));
}

/**
 * `film` (parsed JSON) with `values` (name -> value; a var left out takes its default) put in, as a new object. The
 * `vars` field itself is kept as written. Throws a SpecError: the vars' own problems, a value of the wrong type, an
 * unknown var, a var in a file path, a value with unescapable narration markup in a say. A film with no `vars` and
 * no {{ is returned unchanged.
 */
export function substitute(film, values = {}) {
  const shape = varsErrors(film);
  if (shape.length > 0) throw new SpecError(shape);
  const vars = film.vars ?? {};
  const errors = [];
  const resolved = resolvedValues(vars, values, errors);
  const { vars: kept, ...rest } = film;
  const out = walk(rest, '', null, { vars, values: resolved, errors, inFiles: false });
  if (errors.length > 0) throw new SpecError(errors);
  return kept === undefined ? out : { vars: kept, ...out };
}

// Browser-safe (no imports): typed spec variables. A root `vars` declares names; `{{name}}` in any string value of the
// spec becomes that name's value (a number as String(value), or the number itself when the string is exactly `{{n}}`).
// Pipeline step 1 (template/defaults.mjs expandSpec): it runs
// before viral mode and block expansion, so a block param, `mode` or an asset path may hold a reference.
//
// Only a spec that declares `vars` is touched: one without it comes back as the very same object, so `{{` in code, text
// or a block param (Vue, Handlebars, Jinja snippets) means nothing there. In a spec that declares `vars`, `{{{{` writes
// a literal `{{`. A reference is exactly `{{name}}` with a name of the var pattern; `{{ name }}` (with spaces) and
// `{{Name}}` stay as written.

export const VAR_NAME = /^[a-z][a-zA-Z0-9_]*$/;
export const MAX_VARS = 30;
export const VAR_TYPES = Object.freeze(['string', 'number']);
export const VAR_ESCAPE = '{{{{'; // writes a literal "{{" in a spec that declares vars

// The escape first, so `{{{{` is never read as the start of a reference.
const TOKEN = /\{\{\{\{|\{\{([a-z][a-zA-Z0-9_]*)\}\}/g;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (obj, key) => isPlainObject(obj) && Object.hasOwn(obj, key);

/** Whether `spec` declares `vars` (an own `vars` key on a plain-object spec). */
export const declaresVars = (spec) => own(spec, 'vars');

// The same path format as the validator's errors: `scenes[0].elements[1].text`.
const join = (base, key) => (typeof key === 'number' ? `${base}[${key}]` : base ? `${base}.${key}` : String(key));

// Every string in `node` with its path, depth first, in key order.
function walkStrings(node, at, visit) {
  if (typeof node === 'string') visit(node, at);
  else if (Array.isArray(node)) node.forEach((child, i) => walkStrings(child, join(at, i), visit));
  else if (isPlainObject(node)) for (const [key, child] of Object.entries(node)) walkStrings(child, join(at, key), visit);
}

// The spec's own keys but `vars`, as [key, value] pairs.
const bodyEntries = (spec) => Object.entries(spec).filter(([key]) => key !== 'vars');

/**
 * Every `{{name}}` reference in a spec that declares vars, as [{ path, name }] in spec order (the `vars` block itself is
 * not searched). [] for a spec that declares none.
 */
export function findVarRefs(spec) {
  if (!declaresVars(spec)) return [];
  const refs = [];
  for (const [key, value] of bodyEntries(spec)) {
    walkStrings(value, key, (text, at) => {
      for (const m of text.matchAll(TOKEN)) if (m[1] !== undefined) refs.push({ path: at, name: m[1] });
    });
  }
  return refs;
}

/**
 * The value of every declared var: the row's own value when `values` has one, else the var's `default`; a var with
 * neither is left out. A null-prototype object, read with own-property lookups only, so a row key such as `__proto__`
 * or `constructor` is data and never reaches a prototype.
 */
export function varValues(spec, values = {}) {
  const out = Object.create(null);
  const vars = declaresVars(spec) && isPlainObject(spec.vars) ? spec.vars : {};
  for (const name of Object.keys(vars)) {
    if (own(values, name)) out[name] = values[name];
    else if (own(vars[name], 'default')) out[name] = vars[name].default;
  }
  return out;
}

const WHOLE = /^\{\{([a-z][a-zA-Z0-9_]*)\}\}$/; // a string that is one reference and nothing else

// `text` substituted. A string that is exactly `{{n}}` of a number var becomes the number itself, so `"to": "{{count}}"`
// is a number where the spec needs one; any other string takes each value as String(value).
function substituteText(text, known, numbers) {
  const whole = WHOLE.exec(text);
  if (whole && numbers.has(whole[1]) && typeof known[whole[1]] === 'number') return known[whole[1]];
  return text.replace(TOKEN, (token, name) => {
    if (name === undefined) return '{{'; // the escape
    return Object.hasOwn(known, name) ? String(known[name]) : token; // unknown: left for the validator to name
  });
}

// A copy of `node` with every string substituted. Objects are rebuilt with Object.fromEntries, which defines each key as
// an own data property, so a `__proto__` key in the spec stays a key and never sets the copy's prototype.
function substituteNode(node, known, numbers) {
  if (typeof node === 'string') return substituteText(node, known, numbers);
  if (Array.isArray(node)) return node.map((child) => substituteNode(child, known, numbers));
  if (isPlainObject(node)) return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, substituteNode(child, known, numbers)]));
  return node;
}

// The names of the declared vars whose type is number.
const numberVars = (spec) => new Set(isPlainObject(spec.vars) ? Object.keys(spec.vars).filter((name) => own(spec.vars[name], 'type') && spec.vars[name].type === 'number') : []);

/**
 * Pipeline step 1. A spec without `vars` comes back unchanged (the same object). Otherwise a pure copy without `vars`, in
 * which every `{{name}}` is its value (`values` over the declared defaults, varValues) and every `{{{{` is `{{`; a string
 * that is exactly `{{n}}` of a number var becomes that number (so it can fill a numeric field such as a counter's `to`).
 * Values are inserted once and never searched again, so a value holding `{{x}}` stays as it is. A reference with no value
 * (an undeclared name, or a var with no default and no row value) is left as written: the validator reports it first.
 * Removing `vars` makes a second pass (the page's withDefaults on a substituted spec) change nothing.
 */
export function substituteVars(spec, values = {}) {
  if (!declaresVars(spec)) return spec;
  const known = varValues(spec, values);
  const numbers = numberVars(spec);
  return Object.fromEntries(bodyEntries(spec).map(([key, value]) => [key, substituteNode(value, known, numbers)]));
}

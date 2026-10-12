// Icon lookup over the committed catalogs (icons/lucide.json, icons/brands.json).
// Refs are "lucide:<name>" or "brand:<slug>". Pure data access: no network, no
// dev dependencies.
import fs from 'node:fs';
import { didYouMean, levenshtein } from '../../shared/errors.mjs';

const VIEW_BOX = '0 0 24 24';
const PREFIXES = ['lucide', 'brand'];
const DEFAULT_SEARCH_LIMIT = 12;

export class IconError extends Error {
  constructor(message, suggestion = null) {
    super(message);
    this.name = 'IconError';
    this.suggestion = suggestion;
  }
}

// Default icon per node kind, across every diagram type (kind names are shared
// between types: `service`, `database`, `queue`, `external` mean the same thing
// in architecture and sequence; `start`/`end` in flow and state). null = the
// kind is drawn as a pure shape and carries no icon.
export const DEFAULT_ICON = Object.freeze({
  // architecture (and sequence participants)
  service: 'lucide:server',
  client: 'lucide:monitor',
  user: 'lucide:user',
  database: 'lucide:database',
  storage: 'lucide:hard-drive',
  queue: 'lucide:layers',
  cache: 'lucide:zap',
  function: 'lucide:square-function',
  gateway: 'lucide:door-open',
  external: 'lucide:cloud',
  other: 'lucide:box',
  actor: 'lucide:user',
  // flow
  step: null,
  start: null,
  end: null,
  decision: null,
  io: 'lucide:arrow-right-left',
  subprocess: 'lucide:workflow',
  wait: 'lucide:clock',
  // state
  state: null,
  choice: null,
});

let catalogs = null;
function load() {
  if (catalogs) return catalogs;
  const read = (name) => JSON.parse(fs.readFileSync(new URL(`../../icons/${name}.json`, import.meta.url), 'utf8'));
  catalogs = { lucide: read('lucide').icons, brand: read('brands').icons };
  return catalogs;
}

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function split(ref) {
  const i = typeof ref === 'string' ? ref.indexOf(':') : -1;
  return i < 0 ? [null, ref] : [ref.slice(0, i), ref.slice(i + 1)];
}

function suggestRef(prefix, name) {
  const cat = load()[prefix];
  const hit = didYouMean(name, Object.keys(cat));
  return hit === null ? null : `${prefix}:${hit}`;
}

// Resolve a ref to drawable markup. `lucide` icons are stroked outlines, `brand`
// icons are a single filled path; the renderer picks stroke vs fill by `kind`.
export function iconSvg(ref) {
  const data = load();
  if (typeof ref !== 'string' || ref === '') {
    throw new IconError(`icon must be a string like "lucide:<name>" or "brand:<slug>", got ${JSON.stringify(ref)}`);
  }
  const [prefix, name] = split(ref);
  if (prefix === null) {
    const hit = suggestRef('lucide', name) ?? suggestRef('brand', name);
    const hint = hit ? `; did you mean ${JSON.stringify(hit)}?` : '';
    throw new IconError(`icon ${JSON.stringify(ref)} needs a "lucide:" or "brand:" prefix${hint}`, hit);
  }
  if (!PREFIXES.includes(prefix)) {
    const fixed = didYouMean(prefix, PREFIXES);
    const hit = fixed && has(data[fixed], name) ? `${fixed}:${name}` : null;
    const hint = hit ? `; did you mean ${JSON.stringify(hit)}?` : '';
    throw new IconError(`unknown icon set ${JSON.stringify(prefix)}; use lucide:<name> or brand:<slug>${hint}`, hit);
  }
  const entry = has(data[prefix], name) ? data[prefix][name] : undefined;
  if (entry === undefined) {
    const hit = suggestRef(prefix, name);
    const hint = hit ? `; did you mean ${JSON.stringify(hit)}?` : '; try: node scripts/icons.mjs search <word>';
    throw new IconError(`unknown icon ${JSON.stringify(ref)}${hint}`, hit);
  }
  if (prefix === 'lucide') return { kind: 'lucide', markup: entry, viewBox: VIEW_BOX };
  return { kind: 'brand', markup: `<path d="${entry.path}"/>`, viewBox: VIEW_BOX };
}

export function hasIcon(ref) {
  const [prefix, name] = split(ref);
  const data = load();
  return PREFIXES.includes(prefix) && typeof name === 'string' && has(data[prefix], name);
}

// Every ref in one catalog, or both when `set` is omitted. Sorted by catalog order.
export function listIcons(set) {
  const data = load();
  const sets = set ? [set] : PREFIXES;
  return sets.flatMap((p) => Object.keys(data[p]).map((n) => `${p}:${n}`));
}

// Refs matching `word`, best first: exact, prefix, substring (name or brand
// title), then near-miss typos. Stable: lucide before brand, then alphabetical.
export function searchIcons(word, limit = DEFAULT_SEARCH_LIMIT) {
  const w = String(word).trim().toLowerCase();
  if (w === '') return [];
  const data = load();
  const entries = PREFIXES.flatMap((p) => Object.keys(data[p]).map((name) => ({
    ref: `${p}:${name}`,
    name,
    title: p === 'brand' ? data[p][name].title.toLowerCase() : '',
  })));
  const exact = [];
  const prefix = [];
  const substring = [];
  const rest = [];
  for (const e of entries) {
    if (e.name === w || e.title === w) exact.push(e.ref);
    else if (e.name.startsWith(w) || e.title.startsWith(w)) prefix.push(e.ref);
    else if (e.name.includes(w) || e.title.includes(w)) substring.push(e.ref);
    else rest.push(e);
  }
  const maxDistance = Math.max(2, Math.floor(w.length / 3));
  const near = rest
    .map((e) => ({ ref: e.ref, d: levenshtein(w, e.name) }))
    .filter((e) => e.d <= maxDistance)
    .sort((a, b) => a.d - b.d)
    .map((e) => e.ref);
  return [...new Set([...exact, ...prefix, ...substring, ...near])].slice(0, limit);
}

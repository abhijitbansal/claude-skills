// Icon lookup over the committed catalogs (icons/lucide.json, icons/brands.json,
// icons/cloud.json) and the cloud icons the user imported (icon-import.mjs). Refs are
// "lucide:<name>", "brand:<slug>" or "cloud:<name>". Pure data access: no network, no
// dev dependencies.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { didYouMean, levenshtein } from '../../shared/errors.mjs';
import { roundTrip } from './svg-safe.mjs';

export { scopeIds } from './svg-safe.mjs';

const VIEW_BOX = '0 0 24 24';
const PREFIXES = ['lucide', 'brand', 'cloud'];
const DEFAULT_SEARCH_LIMIT = 12;
// What the importer can write: a provider prefix and a lower-case slug.
const CLOUD_NAME = /^(?:aws|google)-[a-z0-9][a-z0-9-]{0,56}$/;
const MAX_CATALOG_BYTES = 64 * 1024 * 1024;

/** Whether `name` is one a stored (imported) cloud icon may have. */
export const isCloudName = (name) => typeof name === 'string' && CLOUD_NAME.test(name);
const IMPORTED_FILE = /^imported-[a-z]+\.json$/;
// Where a bare name like "lambda" might live in the cloud catalog.
const CLOUD_GUESSES = ['aws-', 'google-cloud-', 'google-'];

export const IMPORT_COMMAND = 'node scripts/icons.mjs import <aws|gcp> <folder>';

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
  catalogs = { lucide: read('lucide').icons, brand: read('brands').icons, cloud: read('cloud').icons };
  return catalogs;
}

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// ---- imported cloud icons ----------------------------------------------------------------

/** The folder imported cloud icons live in: $MAKE_DIAGRAM_ICON_DIR, else ~/.cache/portable-artifacts/make-diagram. */
export function iconDir() {
  const override = process.env.MAKE_DIAGRAM_ICON_DIR;
  if (override === undefined || override === '') return path.join(homeDir(), '.cache', 'portable-artifacts', 'make-diagram');
  const expanded = override === '~' || override.startsWith('~/') ? path.join(homeDir(), override.slice(1)) : override;
  if (!path.isAbsolute(expanded)) throw new IconError(`MAKE_DIAGRAM_ICON_DIR must be an absolute path, got ${JSON.stringify(override.slice(0, 40))}`);
  return path.resolve(expanded);
}

// The home folder, or an error that says how to avoid needing it: an empty HOME must never turn into a folder under the working directory.
function homeDir() {
  let home = '';
  try {
    home = os.homedir();
  } catch {
    home = '';
  }
  if (!home || !path.isAbsolute(home)) throw new IconError('cannot find your home folder to keep imported icons in; set MAKE_DIAGRAM_ICON_DIR to an absolute folder');
  return home;
}

const importedCache = new Map();

/** Forget what was read from `dir`; the importer calls it after writing there. */
export function forgetImported(dir = iconDir()) {
  importedCache.delete(dir);
}

// One stored entry passes only if its name is one the importer writes and the allow-list returns it unchanged
// (svg-safe.mjs roundTrip): the folder is outside the repo, so every load checks it again.
const trustedEntry = (name, entry) => (CLOUD_NAME.test(name) ? roundTrip(entry) : null);

function readImportedFile(file) {
  const damaged = (why) => new IconError(`cannot read imported cloud icons from ${file} (${why}); delete the file and import again with: ${IMPORT_COMMAND}`);
  let parsed;
  try {
    if (fs.statSync(file).size > MAX_CATALOG_BYTES) throw new Error('the file is over 64 MiB, far more than an import writes');
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw damaged(String(e.message).slice(0, 80));
  }
  const stored = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed.icons : undefined;
  const out = {};
  if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) return out;
  for (const [name, entry] of Object.entries(stored)) {
    const ok = trustedEntry(name, entry);
    if (ok) out[name] = ok;
  }
  return out;
}

/** Every imported cloud icon in `dir` as { name: { viewBox, markup } }. A missing folder holds none. */
export function importedIcons(dir = iconDir()) {
  if (importedCache.has(dir)) return importedCache.get(dir);
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => IMPORTED_FILE.test(f)).sort();
  } catch (e) {
    if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw new IconError(`cannot read the imported cloud icon folder ${dir} (${e.message})`);
  }
  const merged = {};
  for (const file of files) Object.assign(merged, readImportedFile(path.join(dir, file)));
  importedCache.set(dir, merged);
  return merged;
}

/** Names of the icons shipped in icons/cloud.json. */
export const bundledCloudNames = () => Object.keys(load().cloud);

const warned = new Set();

// The imported icons for a listing or a search: a damaged file is a warning on stderr (once), and the bundled icons carry on.
function importedOrWarn() {
  try {
    return importedIcons();
  } catch (e) {
    if (!(e instanceof IconError)) throw e;
    if (!warned.has(e.message)) {
      warned.add(e.message);
      process.stderr.write(`warning: ${e.message}; carrying on with the bundled icons\n`);
    }
    return {};
  }
}

// Bundled wins over imported for the same name, so a spec draws the same on every machine.
function catalog(prefix) {
  const data = load();
  return prefix === 'cloud' ? { ...importedOrWarn(), ...data.cloud } : data[prefix];
}

// One cloud icon: the bundled catalog first. The imported file is read only on a miss, so a damaged one never touches a bundled icon.
function cloudEntry(name) {
  const bundled = load().cloud;
  if (has(bundled, name)) return bundled[name];
  const imported = importedIcons();
  return has(imported, name) ? imported[name] : undefined;
}

function split(ref) {
  const i = typeof ref === 'string' ? ref.indexOf(':') : -1;
  return i < 0 ? [null, ref] : [ref.slice(0, i), ref.slice(i + 1)];
}

// The closest name by edit distance alone. Cloud names share long prefixes ("aws-", "google-cloud-"),
// so didYouMean's prefix rule would offer "aws" for any unknown "aws-..." name.
function nearestName(name, names) {
  const w = name.toLowerCase();
  const limit = Math.max(2, Math.floor(w.length / 3));
  const scored = names.map((n) => ({ n, d: levenshtein(w, n) })).filter((e) => e.d <= limit).sort((a, b) => a.d - b.d);
  return scored.length ? scored[0].n : null;
}

function suggestRef(prefix, name) {
  const cat = catalog(prefix);
  const names = Object.keys(cat);
  const guess = prefix === 'cloud' ? CLOUD_GUESSES.map((g) => `${g}${name}`).find((n) => has(cat, n)) : undefined;
  const hit = guess ?? (prefix === 'cloud' ? nearestName(name, names) : didYouMean(name, names));
  return hit === null || hit === undefined ? null : `${prefix}:${hit}`;
}

const unknownHint = (prefix, hit) => {
  if (hit) return `; did you mean ${JSON.stringify(hit)}?`;
  return prefix === 'cloud'
    ? `; try: node scripts/icons.mjs search <word>. A service the pack lacks can be imported from the vendor's icon download: ${IMPORT_COMMAND}`
    : '; try: node scripts/icons.mjs search <word>';
};

// Resolve a ref to drawable markup. `lucide` icons are stroked outlines, `brand`
// icons are a single filled path, `cloud` icons carry their own colours; the
// renderer picks stroke vs fill vs neither by `kind`.
export function iconSvg(ref) {
  if (typeof ref !== 'string' || ref === '') {
    throw new IconError(`icon must be a string like "lucide:<name>", "brand:<slug>" or "cloud:<name>", got ${JSON.stringify(ref)}`);
  }
  const [prefix, name] = split(ref);
  if (prefix === null) {
    const hit = suggestRef('lucide', name) ?? suggestRef('brand', name) ?? suggestRef('cloud', name);
    const hint = hit ? `; did you mean ${JSON.stringify(hit)}?` : '';
    throw new IconError(`icon ${JSON.stringify(ref)} needs a "lucide:" or "brand:" prefix (or "cloud:" for AWS and Google Cloud services)${hint}`, hit);
  }
  if (!PREFIXES.includes(prefix)) {
    const fixed = didYouMean(prefix, PREFIXES);
    const hit = fixed && hasIcon(`${fixed}:${name}`) ? `${fixed}:${name}` : null;
    const hint = hit ? `; did you mean ${JSON.stringify(hit)}?` : '';
    throw new IconError(`unknown icon set ${JSON.stringify(prefix)}; use lucide:<name> or brand:<slug>; or cloud:<name> for AWS and Google Cloud services${hint}`, hit);
  }
  const entry = prefix === 'cloud' ? cloudEntry(name) : (has(load()[prefix], name) ? load()[prefix][name] : undefined);
  if (entry === undefined) {
    const hit = suggestRef(prefix, name);
    throw new IconError(`unknown icon ${JSON.stringify(ref)}${unknownHint(prefix, hit)}`, hit);
  }
  if (prefix === 'lucide') return { kind: 'lucide', markup: entry, viewBox: VIEW_BOX };
  if (prefix === 'cloud') return { kind: 'cloud', markup: entry.markup, viewBox: entry.viewBox };
  return { kind: 'brand', markup: `<path d="${entry.path}"/>`, viewBox: VIEW_BOX };
}

// A predicate: never throws. A damaged imported file makes an imported-only name a "no" (iconSvg says why).
export function hasIcon(ref) {
  const [prefix, name] = split(ref);
  if (!PREFIXES.includes(prefix) || typeof name !== 'string') return false;
  if (prefix !== 'cloud') return has(load()[prefix], name);
  try {
    return cloudEntry(name) !== undefined;
  } catch (e) {
    if (e instanceof IconError) return false;
    throw e;
  }
}

// Every ref in one catalog, or all when `set` is omitted. Sorted by catalog order.
export function listIcons(set) {
  const sets = set ? [set] : PREFIXES;
  return sets.flatMap((p) => Object.keys(catalog(p)).map((n) => `${p}:${n}`));
}

// What a name is also called: a brand's title, a cloud icon's name in words ("google cloud run"), plus the provider's short name.
function titleOf(prefix, name, entry) {
  if (prefix === 'brand') return entry.title.toLowerCase();
  if (prefix !== 'cloud') return '';
  return `${name.replace(/-/g, ' ')}${name.startsWith('google') ? ' gcp' : ''}`;
}

// Refs matching `word`, best first: exact, prefix, substring (name or title),
// then near-miss typos. Stable: lucide, then brand, then cloud, alphabetical within each.
export function searchIcons(word, limit = DEFAULT_SEARCH_LIMIT) {
  const w = String(word).trim().toLowerCase();
  if (w === '') return [];
  const entries = PREFIXES.flatMap((p) => {
    const cat = catalog(p);
    return Object.keys(cat).map((name) => ({ ref: `${p}:${name}`, name, title: titleOf(p, name, cat[name]) }));
  });
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

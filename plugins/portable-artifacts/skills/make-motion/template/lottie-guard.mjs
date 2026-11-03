// Browser-safe (no imports): what a `lottie` element's file may hold, and which of its frames the page draws. The
// validator (scripts/lib/lottie-check.mjs) and the page (template/lottie-view.mjs) both run lottieProblems on the parsed
// file, so a file that names anything to fetch, or carries an expression, never reaches lottie-web. The page also imports
// only lottie-web's light SVG build, which has no expression engine: two lines of defence, kept both.
//
// The file is untrusted. It is read with own-property lookups only, walked with an explicit stack (no recursion, so a
// deeply nested file cannot overflow the call stack), and capped in bytes, nesting depth and asset count; what it asks
// lottie-web to build is capped too (lottie-budget.mjs), because a tiny file can block the page's main thread.
//
// What lottie-web 5.13 would fetch or run, and the rule that stops each:
//   assets[i].u + assets[i].p   an image, audio or data asset's path ("u" a folder, "p" a file or a data URL): "u" must be
//                               empty and "p" a data URL of a raster image (png, jpeg or webp; svg+xml can carry markup).
//                               Every asset is checked: one with `layers` (a precomp) must hold an array there and name
//                               no file at all, since an image layer whose refId names it would load its u + p
//   assets[i].t === 3           a data (footage) asset, loaded with XMLHttpRequest from "p"
//   slots.<id>.p.{p,u}          an image slot, copied over an asset's "p" and "u" at runtime: the asset rules again
//   fonts.list[i].fPath/fOrigin/origin   a web font: a <link>, a <style> @font-face url() or a Typekit sheet
//   segments                    extra segment files fetched beside the animation
//   any { k, x: "<code>" }      an expression (lottie-web's full build evaluates any string x on a property, with or
//                               without `a`, and on a text document t.d); so is a string x a slot merges into a property
//
// What reaches the page's DOM as written: a solid layer's `sc` as its rect's fill (a url() there is a paint server: a
// fetch, or a reference to a page id), its `sw`/`sh` and a layer's `w`/`h` as attributes and path data, an image
// asset's `pr` as preserveAspectRatio, and a font's names as font-family and font-style. Each must be a plain value: a
// #rgb or #rrggbb colour, a number, a preserveAspectRatio keyword, a plain font name. Colours everywhere else are
// numbers lottie-web formats itself. And lottie-web writes a layer's or shape's `ln` as an element id and its `cl` (and
// a font's fClass) as a class. A file could reuse an id the page uses (a grade filter's) or a class check.mjs selects, so
// stripDomNames removes them from the parsed copy before lottie-web sees it.

import { budgetProblems, countProblems } from './lottie-budget.mjs';

export const MAX_LOTTIE_BYTES = 4 * 1024 * 1024; // 4 MiB: room for a few embedded images, far beyond a vector animation
export const MAX_LOTTIE_DEPTH = 128; // exporters nest groups a few dozen levels at most
export const MAX_LOTTIE_ASSETS = 200;
export const LOTTIE_SPEED = Object.freeze([0.25, 4]); // the `speed` range the schema allows
const FRAME_DECIMALS = 1e6; // a frame is rounded to a millionth, so float noise never reaches the page

const REQUIRED_KEYS = ['v', 'fr', 'ip', 'op', 'layers', 'w', 'h'];
const REMOTE_ASSET = 'remote assets are not allowed; embed the image as a data URL';
const NOT_RASTER = 'only PNG, JPEG or WebP images can be embedded (data:image/png, data:image/jpeg or data:image/webp)';
const REMOTE_FONT = 'remote fonts are not allowed; use a system font (fOrigin "n", no fPath) or embed the glyphs (chars)';
const RASTER_DATA_URL = /^data:image\/(?:png|jpeg|webp)[;,]/i;
const SYSTEM_FONT_ORIGIN = 'n';
const SYSTEM_FONT_ORIGIN_CODE = 0;
const FOOTAGE_ASSET = 3;

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (obj, key) => Object.hasOwn(obj, key);
const ownValue = (obj, key) => (own(obj, key) ? obj[key] : undefined);
const join = (at, key) => (typeof key === 'number' ? `${at}[${key}]` : at ? `${at}.${key}` : key);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const SOLID_LAYER = 1;
const COUNTED = new Set(['rp', 'zz', 'sr', 'gf', 'gs']); // the shape items countProblems caps (a text document is found by its string t)
const HEX_COLOUR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const ASPECT = /^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max)(?: (?:meet|slice))?)$/;
const FONT_NAMES = ['fName', 'fFamily', 'fStyle', 'fWeight'];
const FONT_NAME = /^[\p{L}\p{N} _.,'-]{1,128}$/u;
const PLAIN_FONT = 'must be a plain font name (letters, digits, spaces and . , \' - _)';
const isEmpty = (v) => v === undefined || v === null || v === '';
const positive = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

// The root keys every Lottie file has, with sane values. Returns the problems (the first missing key, or every bad value).
function structureProblems(json) {
  if (!isPlain(json)) return [{ path: '(root)', message: 'not a Lottie file (not a JSON object)' }];
  const missing = REQUIRED_KEYS.find((key) => !own(json, key));
  if (missing) return [{ path: '(root)', message: `not a Lottie file (missing ${missing})` }];
  const problems = [];
  const bad = (path, message) => problems.push({ path, message });
  for (const key of ['fr', 'w', 'h']) if (!positive(json[key])) bad(key, 'must be a number above 0');
  if (typeof json.ip !== 'number' || !Number.isFinite(json.ip)) bad('ip', 'must be a number');
  else if (typeof json.op !== 'number' || !Number.isFinite(json.op) || json.op <= json.ip) bad('op', `must be a number above ip (${json.ip})`);
  if (!Array.isArray(json.layers)) bad('layers', 'must be an array');
  if (own(json, 'assets') && !Array.isArray(json.assets)) bad('assets', 'must be an array');
  return problems;
}

// An image source (an asset, or an image slot's value): no folder, and an embedded raster data URL.
function imageSourceProblems(source, at, problems) {
  if (!isEmpty(ownValue(source, 'u'))) problems.push({ path: join(at, 'u'), message: REMOTE_ASSET });
  const p = ownValue(source, 'p');
  if (typeof p !== 'string' || !p.startsWith('data:')) problems.push({ path: join(at, 'p'), message: REMOTE_ASSET });
  else if (!RASTER_DATA_URL.test(p)) problems.push({ path: join(at, 'p'), message: NOT_RASTER });
}

function assetProblems(assets, problems) {
  assets.forEach((asset, i) => {
    const at = `assets[${i}]`;
    if (!isPlain(asset)) return problems.push({ path: at, message: 'must be an object' });
    if (own(asset, 'layers') && !Array.isArray(asset.layers)) return problems.push({ path: join(at, 'layers'), message: 'must be an array' });
    if (ownValue(asset, 't') === FOOTAGE_ASSET) return problems.push({ path: join(at, 't'), message: 'data assets (t 3) are not supported; keep the data in the layers' });
    for (const key of ['w', 'h']) if (own(asset, key) && !finite(asset[key])) problems.push({ path: join(at, key), message: 'must be a number' });
    if (own(asset, 'pr') && !(typeof asset.pr === 'string' && ASPECT.test(asset.pr))) problems.push({ path: join(at, 'pr'), message: 'must be an SVG preserveAspectRatio value such as "xMidYMid meet"' });
    if (!own(asset, 'layers')) return imageSourceProblems(asset, at, problems);
    for (const key of ['u', 'p']) { // a precomp: its layers are walked like the root's, and it names no file
      if (!isEmpty(ownValue(asset, key))) problems.push({ path: join(at, key), message: `a precomp names no file; remove ${key}` });
    }
    return undefined;
  });
}

function slotProblems(slots, problems) {
  if (!isPlain(slots)) return;
  for (const id of Object.keys(slots)) {
    const value = isPlain(slots[id]) ? ownValue(slots[id], 'p') : undefined;
    if (isPlain(value) && (own(value, 'p') || own(value, 'u'))) imageSourceProblems(value, join(join('slots', id), 'p'), problems);
  }
}

function fontProblems(fonts, problems) {
  if (!isPlain(fonts)) return problems.push({ path: 'fonts', message: 'must be an object' });
  const list = ownValue(fonts, 'list');
  if (list === undefined) return undefined;
  if (!Array.isArray(list)) return problems.push({ path: 'fonts.list', message: 'must be an array' });
  list.forEach((font, i) => {
    const at = `fonts.list[${i}]`;
    if (!isPlain(font)) return problems.push({ path: at, message: 'must be an object' });
    if (!isEmpty(ownValue(font, 'fPath'))) problems.push({ path: join(at, 'fPath'), message: REMOTE_FONT });
    if (own(font, 'fOrigin') && font.fOrigin !== SYSTEM_FONT_ORIGIN) problems.push({ path: join(at, 'fOrigin'), message: REMOTE_FONT });
    if (own(font, 'origin') && font.origin !== SYSTEM_FONT_ORIGIN_CODE) problems.push({ path: join(at, 'origin'), message: REMOTE_FONT });
    for (const key of FONT_NAMES) {
      const v = ownValue(font, key);
      if (v !== undefined && !(typeof v === 'string' ? FONT_NAME.test(v) : key === 'fWeight' && finite(v))) problems.push({ path: join(at, key), message: PLAIN_FONT });
    }
    return undefined;
  });
  return undefined;
}

// The path of a walk entry, built only when a problem is reported (entries link to their parent).
function pathOf(entry) {
  const keys = [];
  for (let e = entry; e.parent; e = e.parent) keys.push(e.key);
  return keys.reverse().reduce((at, key) => join(at, key), '');
}

// A layer of a `layers` list (the root's or a precomp's): its plain values (a solid's colour and size, any w and h).
const isLayer = (entry) => entry.parent !== null && entry.parent.key === 'layers' && Array.isArray(entry.parent.value);
function layerValues(layer, at, problems) {
  if (ownValue(layer, 'ty') === SOLID_LAYER && own(layer, 'sc') && !(typeof layer.sc === 'string' && HEX_COLOUR.test(layer.sc))) {
    problems.push({ path: join(at, 'sc'), message: 'must be a colour like #ff0000 (a solid layer\'s fill)' });
  }
  for (const key of ['sw', 'sh', 'w', 'h']) if (own(layer, key) && !finite(layer[key])) problems.push({ path: join(at, key), message: 'must be a number' });
}

// A slot's value (`slots.<id>.p`): merged into a property at runtime, so a string x on it is an expression even without k.
const isSlotValue = (entry) => entry.key === 'p' && entry.parent?.parent?.key === 'slots' && entry.parent.parent.parent?.parent === null;

// Every object and array in `json`, in document order, with an explicit stack. A non-empty string `x` on an object with
// an own `k` (a property, keyed or not, or a text document) or on a slot's value is an expression (lottie-web ignores an
// empty one); an own `__proto__` key is refused and not entered; a layer's plain values and every count cap
// (lottie-budget.mjs countProblems) are checked where they stand. Stops at the first container nested deeper than
// MAX_LOTTIE_DEPTH. -> { complete: false } when it stopped, and whether a count cap fired.
function walkProblems(json, problems) {
  const slots = ownValue(json, 'slots');
  let capped = false;
  const stack = [{ value: json, parent: null, key: null, depth: 0 }];
  while (stack.length) {
    const entry = stack.pop();
    const { value, depth } = entry;
    if (depth > MAX_LOTTIE_DEPTH) {
      problems.push({ path: pathOf(entry), message: `nested more than ${MAX_LOTTIE_DEPTH} levels deep; this is not a Lottie file an exporter writes` });
      return { complete: false, capped };
    }
    const keys = Array.isArray(value) ? value.map((_, i) => i) : Object.keys(value);
    if (!Array.isArray(value)) {
      const x = ownValue(value, 'x');
      if ((own(value, 'k') || isSlotValue(entry)) && typeof x === 'string' && x !== '') problems.push({ path: join(pathOf(entry), 'x'), message: 'expressions are not supported' });
      if (own(value, '__proto__')) problems.push({ path: join(pathOf(entry), '__proto__'), message: 'the key "__proto__" is not allowed' });
      if (isLayer(entry)) layerValues(value, pathOf(entry), problems);
      if ((COUNTED.has(ownValue(value, 'ty')) || typeof ownValue(value, 't') === 'string') && countProblems(value, pathOf(entry), slots, problems)) capped = true;
    }
    for (let i = keys.length - 1; i >= 0; i--) { // reversed onto the stack, so they come off in document order
      const key = keys[i];
      const child = value[key];
      if (key === '__proto__' || child === null || typeof child !== 'object') continue;
      stack.push({ value: child, parent: entry, key, depth: depth + 1 });
    }
  }
  return { complete: true, capped };
}

/**
 * The problems of a parsed Lottie file, as [{ path, message }] with paths inside the file (`assets[2].p`,
 * `layers[0].ks.p.x`, `(root)`); [] for a file lottie-web may play offline with no expression.
 */
export function lottieProblems(json) {
  const structure = structureProblems(json);
  if (structure.length) return structure;
  const assets = ownValue(json, 'assets') ?? [];
  if (assets.length > MAX_LOTTIE_ASSETS) return [{ path: 'assets', message: `${assets.length} assets; at most ${MAX_LOTTIE_ASSETS}` }];
  const problems = [];
  assetProblems(assets, problems);
  if (own(json, 'fonts')) fontProblems(json.fonts, problems);
  const segments = ownValue(json, 'segments');
  if (segments !== undefined && !(Array.isArray(segments) && segments.length === 0)) {
    problems.push({ path: 'segments', message: 'external segment files are not allowed; export the animation as one file' });
  }
  if (own(json, 'slots')) slotProblems(json.slots, problems);
  const walk = walkProblems(json, problems);
  if (walk.complete) budgetProblems(json, problems, walk.capped); // within the depth cap: a file nested deeper is refused already
  return problems;
}

const NAMED_LISTS = new Set(['layers', 'shapes', 'it']); // the lists whose items lottie-web gives the file's ln and cl

/**
 * Removes from `json` (a freshly parsed file that passed lottieProblems; changed in place, and returned) every `ln` and
 * `cl` of a layer or shape item, at any depth (precomps and glyphs too), and every font's `fClass`: lottie-web would write
 * them into the page as ids and classes. A mask's `cl` (whether its path is closed) is not a name and stays.
 */
export function stripDomNames(json) {
  const stack = [{ value: json, key: null }];
  while (stack.length) {
    const { value, key } = stack.pop();
    if (Array.isArray(value) && NAMED_LISTS.has(key)) {
      for (const item of value) {
        if (!isPlain(item)) continue;
        delete item.ln; // own properties only: delete never reaches a prototype
        delete item.cl;
      }
    }
    const keys = Array.isArray(value) ? value.map((_, i) => i) : Object.keys(value);
    for (const k of keys) {
      const child = value[k];
      if (child !== null && typeof child === 'object') stack.push({ value: child, key: Array.isArray(value) ? key : k });
    }
  }
  for (const font of ownValue(ownValue(json, 'fonts') ?? {}, 'list') ?? []) if (isPlain(font)) delete font.fClass;
  return json;
}

/**
 * The frame to pass to goToAndStop(frame, true) at scene time `sec`: (sec - offset) x speed x fr frames from the file's
 * in point (goToAndStop counts from ip), held at the in point before the offset and at the last frame lottie-web plays
 * (floor(op - ip) - 1; at op itself the layers that end there are gone) after the end. Sub-frames are kept: lottie-web
 * interpolates them, the same way every time. `el`: { offset, speed }; `timing`: the file's { fr, ip, op }.
 */
export function lottieFrame(sec, { offset = 0, speed = 1 }, { fr, ip, op }) {
  const last = Math.max(0, Math.floor(op - ip) - 1);
  const frame = Math.min(last, Math.max(0, (sec - offset) * speed * fr));
  return Math.round(frame * FRAME_DECIMALS) / FRAME_DECIMALS;
}

// Looks for the v2 engine. Importing this file registers `desk`, `pop` and `cosmos` in registries.looks
// (once: a second evaluation of this file leaves the registry as it is). Looks are frozen plain data plus pure functions;
// the grid helpers and applyAccent live here. Pure and DOM-free. The fields a look names (`paper`, `halftone`, `cosmos`)
// are registered by engine/fields/index.mjs, which whoever draws the look imports.
import { createRegistry, registries } from '../registry.mjs';
import { unitOf } from '../units.mjs';
// A look must name a sound for every registered cut and device, so they are registered before any look is.
import '../cuts/index.mjs';
import '../devices/index.mjs';
// ...and a look must name a caption style, so the styles are registered before any look is.
import '../captions/index.mjs';
// ...and give values (or null) for every named move, so the moves are registered before any look is.
import '../moves/index.mjs';
import { desk } from './desk.mjs';
import { pop } from './pop.mjs';
import { cosmos } from './cosmos.mjs';

/**
 * A move in a look's motion grammar. `dur` is seconds; `dist` is a travel in units; `step` (fps) makes a hand
 * move advance in frames of 1/step s; `scale` is the starting scale of `enter` and the peak scale of `emphasize`.
 * @typedef {{ ease: string, dur: number, dist?: number, step?: number, overshoot?: number, scale?: number }} Move
 *
 * A typeface without a size. `width` is always a CSS font-stretch keyword (canvas reaches Archivo's width axis in
 * keyword steps only), `weight` a CSS weight. Fraunces carries no optical size: canvas picks it from the pixel size.
 * `wordSpace` (em), when given, is the space between words in place of the face's measured space.
 * @typedef {{ family: string, weight: number, width: string, wordSpace?: number }} Font
 *
 * @typedef {'display' | 'text' | 'label'} TrackingRole
 *
 * A complete art direction. Everything is in units (1 unit = short side / 1080 px) unless it says em, seconds or fps.
 * @typedef {object} Look
 * @property {string} name
 * @property {boolean} [experimental]  true: registered, so a film can name it, but left out of every listing (the
 *   registry's names(), --list looks, unknown-look hints, the looks a kind error names) until it is finished
 * @property {string[]} modes  the modes this look serves
 * @property {{ display: Font, text: Font, label: Font }} fonts
 * @property {{ paper: string, ink: string, ink2: string, accent: string, accent2: string, rule: string }} palette  #rrggbb
 * @property {[number, number, number, number, number]} scale  type sizes, small to large; scale[4] / scale[1] >= 3, scale[0] >= 28
 * @property {{ columns: 12, margin: number, gutter: number }} grid
 * @property {(sizeUnits: number, role?: TrackingRole) => number} tracking  letter spacing in em; role defaults to 'display'
 * @property {{ display: boolean, label: boolean }} caps  set in capitals
 * @property {{ display: number, text: number }} lineHeight  multiples of the font size
 * @property {{ display: number, text: number }} maxLines
 * @property {{ text: number }} wordsPerLine
 * @property {{ field: string, params: object }} field  a name in registries.fields and its params
 * @property {'editorial' | 'centred' | 'stack'} composition  how shots lay out: flush left on grid columns, centred, or
 *   a stack of short lines each set at its own size to fill the width, flush left
 * @property {'highlight' | 'recolor-scale' | 'recolor'} emphasis  a highlighter band, a recolour with a pulse, or a
 *   recolour alone
 * @property {{ enter: Move, exit: Move, emphasize: Move, draw: Move, count: Move } & Record<string, Move | null>} moves  the
 *   five the first kinds use, and an entry for every move in registries.moves (engine/moves: rise, wipe, slam, pop, draw,
 *   count, settle), a Move or null where the look does not use it (checked by validateLook as the look registers)
 * @property {Record<string, { experimental?: boolean, experimentalTypes?: string[] }>} [kinds]  see below; a kind entry
 *   with `experimental: true` parks the kind in this look (isParkedKind), `chart.experimentalTypes` parks chart types
 * @property {number} wordStagger  seconds between words that have no spoken time; 0 means words follow their spoken times
 * @property {{ drift: number, style: 'desk' | 'locked' }} camera  drift is a travel in units
 * @property {string[]} cuts  a subset of cut, match, slide, punch
 * @property {boolean} [smear]  true: slide and punch draw a motion smear (cuts/index.mjs) while they run; absent, they
 *   draw each shot once, crisp (neither shipped look sets it)
 * @property {number} keyline  width of a cut-out's keyline
 * @property {{ dx: number, dy: number, blur: number, alpha: number, color: string }} shadow  offset and blur in units, color #rrggbb
 * @property {Record<string, object>} devices  styling per device name; colours are palette keys or #rrggbb
 * @property {{ grain: number, halftone: number, bloom: number }} post  strengths from 0 to 1 of the post pass (engine/page/post.mjs), which
 *   runs over the WHOLE frame, pictures and clippings included: a halftone or a bloom above 0 dots or glows a screenshot
 *   as it does the paper, and without WebGL2 only the grain is applied (the review says so). Use halftone only for a look
 *   whose pictures should carry it; a look with a halftone field (pop) keeps it 0
 * @property {{ cut: Record<string, string | null>, device: Record<string, string | null>, emphasis: string | null,
 *   land: string | null }} sounds  the cue each event makes, or null for none: one entry per registered cut and device
 *   (checked by validateLook as the look registers); which names a synth knows is scripts/v2/sound's to check
 * @property {string} captions  the caption style, a name in registries.captions (engine/captions): how the spoken words
 *   of a narrated shot that does not show its own words are drawn (checked by validateLook as the look registers)
 * @property {Record<string, object>} [kinds]  composition data per shot kind, for the kinds that read it (end, list, quote, compare, chart):
 *   a look without an entry for such a kind does not support it, and a film asking for it is invalid (kindSupportProblems)
 */

export { unitOf as unit };

const ACCENT_RE = /^#[0-9a-f]{6}$/i;
const RIGHT_EDGE = 13; // gridX's column for the right margin edge
const sameColour = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

// Freezes every object and array reachable from `value`; functions are left as they are.
function deepFreeze(value) {
  if (value !== null && typeof value === 'object') Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

const columnWidth = (look, u, w) => (w - 2 * look.grid.margin * u - (look.grid.columns - 1) * look.grid.gutter * u) / look.grid.columns;

/** Left edge in pixels of 1-based `column` (1 to 12); 13 is the right margin edge. */
export function gridX(look, canvas, column) {
  if (!Number.isInteger(column) || column < 1 || column > RIGHT_EDGE) {
    throw new Error(`gridX: column must be an integer from 1 to ${RIGHT_EDGE}, got ${JSON.stringify(column)}`);
  }
  const u = unitOf(canvas);
  if (column === RIGHT_EDGE) return canvas.w - look.grid.margin * u;
  return look.grid.margin * u + (column - 1) * (columnWidth(look, u, canvas.w) + look.grid.gutter * u);
}

/** Columns `from` through `to` inclusive (1 to 12) as { x, w } in pixels: the left edge and the width. */
export function gridSpan(look, canvas, from, to) {
  const { columns } = look.grid;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to > columns || from > to) {
    throw new Error(`gridSpan: columns must run from 1 to ${columns} with from <= to, got ${JSON.stringify(from)} to ${JSON.stringify(to)}`);
  }
  const x = gridX(look, canvas, from);
  const right = gridX(look, canvas, to) + columnWidth(look, unitOf(canvas), canvas.w);
  return { x, w: right - x };
}

/** A frozen copy of `look` whose palette.accent is `accent` (#rrggbb), and whose shadow colour follows when it was the accent. */
export function applyAccent(look, accent) {
  if (typeof accent !== 'string' || !ACCENT_RE.test(accent)) {
    throw new Error(`accent must be #rrggbb, for example "#ff6600", got ${JSON.stringify(accent)}`);
  }
  const shadow = sameColour(look.shadow.color, look.palette.accent) ? { ...look.shadow, color: accent } : look.shadow;
  return Object.freeze({
    ...look,
    palette: Object.freeze({ ...look.palette, accent }),
    shadow: Object.isFrozen(shadow) ? shadow : Object.freeze(shadow),
  });
}

const isCueOrNull = (value) => value === null || (typeof value === 'string' && value !== '');

// The errors of one sounds table (`cut` or `device`): an entry for each of `names`, a cue name or null.
function tableErrors(name, table, part, names) {
  if (table === null || typeof table !== 'object') return [`look "${name}": sounds.${part} must be an object, got ${String(table)}`];
  return names.filter((key) => !isCueOrNull(table[key]))
    .map((key) => `look "${name}": sounds.${part}.${key} must be a cue name or null, got ${String(table[key])}`);
}

// The error of a look's `captions` (a name in `captions`, the caption styles registry), or null.
function captionsError(name, style, captions) {
  if (typeof style !== 'string' || style === '') return `look "${name}": captions must name a caption style (have: ${captions.names().join(', ')}), got ${String(style)}`;
  if (captions.has(style)) return null;
  try {
    captions.get(style); // throws for a name it does not have
  } catch (err) {
    return `look "${name}": ${err.message}`; // the registry's own message: the unknown name and the close one
  }
  return null;
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// The errors of a look's `kinds` (absent, or an object of kind names to objects of composition data).
function kindsErrors(name, kinds) {
  if (kinds === undefined) return [];
  if (!isPlainObject(kinds)) return [`look "${name}": kinds must be an object of kind names to their data, got ${String(kinds)}`];
  return Object.entries(kinds).filter(([, data]) => !isPlainObject(data))
    .map(([kind, data]) => `look "${name}": kinds.${kind} must be an object, got ${String(data)}`);
}

// A look's entry for a named move: a Move ({ ease, dur >= 0, ... }) or null (the look does not use it).
const isMoveOrNull = (move) => move === null
  || (isPlainObject(move) && typeof move.ease === 'string' && move.ease !== '' && Number.isFinite(move.dur) && move.dur >= 0);

// The errors of a look's moves: an entry, a Move or null, for each registered move in `names`.
function movesErrors(name, moves, names) {
  if (!isPlainObject(moves)) return [`look "${name}": moves must be an object of move names to { ease, dur }, got ${String(moves)}`];
  return names.filter((key) => !isMoveOrNull(moves[key]))
    .map((key) => `look "${name}": moves.${key} must be a move { ease, dur } or null, got ${JSON.stringify(moves[key]) ?? 'undefined'}`);
}

/** Does `look` carry composition data for `kind` (look.kinds[kind])? */
export const supportsKind = (look, kind) => isPlainObject(look?.kinds) && isPlainObject(look.kinds[kind]);

/** Is `kind` parked in `look` (look.kinds[kind].experimental): it validates and renders there, but the look does not ship it. */
export const isParkedKind = (look, kind) => supportsKind(look, kind) && look.kinds[kind].experimental === true;

/** Is chart type `type` parked in `look` (look.kinds.chart.experimentalTypes)? */
export const isParkedChartType = (look, type) => supportsKind(look, 'chart') && Array.isArray(look.kinds.chart.experimentalTypes)
  && look.kinds.chart.experimentalTypes.includes(type);

// The listed looks that ship `kind` unparked.
const lookNamesFor = (kind, looks) => looks.names().filter((name) => supportsKind(looks.get(name), kind) && !isParkedKind(looks.get(name), kind));

/** The listed looks that ship `kind`: that have data for it and do not park it. */
export const kindLooks = (kind, looks = registries.looks) => lookNamesFor(kind, looks);

// Is `kind` gated by look data (a look ships it only with a kinds.<kind> entry)? The kind says so (`lookData: true`: end,
// list, quote, compare, chart, media, screen). It cannot be read off the looks: cosmos carries composition data for
// statement, clipping and number, kinds every look draws.
const readsLookData = (kind, kinds) => kinds.has(kind) && kinds.get(kind).lookData === true;

/**
 * The kinds a listing shows (--list kinds, the unknown-kind and missing-show hints): a kind that reads no look data
 * (statement, number, clipping, free), or one that at least one listed look ships unparked. registries.kinds.names()
 * stays complete: the sound plan walks every kind, parked ones included.
 */
export const listedKinds = (kinds = registries.kinds, looks = registries.looks) => kinds.names()
  .filter((kind) => !readsLookData(kind, kinds) || lookNamesFor(kind, looks).length > 0);

/** The listed looks a kind's listing entry names: every listed look for a kind that reads no look data, else kindLooks. */
export const listedLooksOf = (kind, looks = registries.looks, kinds = registries.kinds) => (readsLookData(kind, kinds) ? lookNamesFor(kind, looks) : looks.names());

/**
 * A kind's validate rule for the look a film uses: when `look` has no data for `kind`, one problem at the shot's `show`
 * naming the looks (in `looks`, default the shared registry) that have it; none for a look that does, or no look at all
 * (an unknown look has its own error).
 * @returns {{ path: string, message: string }[]}
 */
export function kindSupportProblems(kind, look, looks = registries.looks) {
  if (!look || supportsKind(look, kind)) return [];
  const have = lookNamesFor(kind, looks);
  return [{ path: 'show', message: `kind "${kind}" is not supported by look "${look.name}"; the looks that support it: ${have.join(', ') || 'none'}` }];
}

/** look.kinds[kind], or throws naming the look, the kind and the looks that have data for it. */
export function kindData(look, kind, looks = registries.looks) {
  if (supportsKind(look, kind)) return look.kinds[kind];
  throw new Error(`look "${look.name}" has no data for kind "${kind}"; the looks that support it: ${lookNamesFor(kind, looks).join(', ') || 'none'}`);
}

/**
 * Throws a RangeError naming the look and the field when its `sounds` is missing, or does not name a cue (or null) for
 * every cut in `cuts` and every device in `devices` (registries; default the shared ones), and for emphasis and land; or
 * when its `captions` does not name a style in `captions` (default the shared caption styles registry); or when its
 * `kinds`, given, is not an object of objects. Returns the look, so it can be used inline.
 */
export function validateLook(look, { cuts = registries.cuts, devices = registries.devices, captions = registries.captions, moves = registries.moves } = {}) {
  const caption = captionsError(look.name, look.captions, captions);
  if (caption !== null) throw new RangeError(caption);
  const kinds = kindsErrors(look.name, look.kinds);
  if (kinds.length > 0) throw new RangeError(kinds.join('\n'));
  const moveErrors = movesErrors(look.name, look.moves, moves.names());
  if (moveErrors.length > 0) throw new RangeError(moveErrors.join('\n'));
  const { name, sounds } = look;
  if (sounds === null || typeof sounds !== 'object') {
    throw new RangeError(`look "${name}": sounds must be { cut, device, emphasis, land }, got ${String(sounds)}`);
  }
  const errors = [
    ...tableErrors(name, sounds.cut, 'cut', cuts.names()),
    ...tableErrors(name, sounds.device, 'device', devices.names()),
    ...['emphasis', 'land'].filter((key) => !isCueOrNull(sounds[key]))
      .map((key) => `look "${name}": sounds.${key} must be a cue name or null, got ${String(sounds[key])}`),
  ];
  if (errors.length > 0) throw new RangeError(errors.join('\n'));
  return look;
}

// Every look added to the shared registry is checked as it is added, as modes are (engine/modes/index.mjs): the
// registry's `add` for looks is wrapped here, once (a second evaluation of this file keeps the first wrapper).
const addLook = registries.looks.add;
if (!addLook.validatesLooks) {
  const checkedAdd = (name, look) => {
    validateLook({ ...look, name });
    addLook(name, look);
  };
  checkedAdd.validatesLooks = true;
  registries.looks.add = checkedAdd;
}

// An experimental look (look.experimental) resolves by name like any other (has, get) but is left out of every listing:
// the registry's names() and the unknown-name message of get() show only the finished looks. Wrapped here, once, as
// `add` is above.
const looks = registries.looks;
if (!looks.names.hidesExperimental) {
  const allNames = looks.names;
  const getAny = looks.get;
  const listedNames = () => allNames().filter((name) => getAny(name).experimental !== true);
  listedNames.hidesExperimental = true;
  listedNames.all = allNames;
  looks.names = listedNames;
  looks.get = (name) => {
    if (looks.has(name)) return getAny(name);
    const listed = createRegistry('look');
    for (const shown of listedNames()) listed.add(shown, null);
    return listed.get(name); // throws the registry's own message, naming only the listed looks
  };
}

/** Every registered look's name, the experimental ones included (--list looks --all). */
export const allLookNames = () => registries.looks.names.all();

for (const definition of [desk, pop, cosmos]) {
  if (!registries.looks.has(definition.name)) registries.looks.add(definition.name, deepFreeze(definition));
}

// Looks for the v2 engine. Importing this file registers `desk`, `pop`, `cosmos`, `ledger` and `poster` (experimental) in registries.looks
// (once: a second evaluation of this file leaves the registry as it is). Looks are frozen plain data plus pure functions;
// the grid helpers and applyAccent live here. Pure and DOM-free. The fields a look names (`paper`, `halftone`, `cosmos`)
// are registered by engine/fields/index.mjs, which whoever draws the look imports.
import { createRegistry, registries } from '../registry.mjs';
import { unitOf } from '../units.mjs';
// A look must name a sound for every registered cut and device, so they are registered before any look is.
import '../cuts/index.mjs';
import { cutOptionProblems } from '../cuts/resolve.mjs';
import { didYouMean } from '../../shared/errors.mjs';
import { ease } from '../time/ease.mjs';
import '../devices/index.mjs';
// ...and a look must name a caption style, so the styles are registered before any look is.
import '../captions/index.mjs';
// ...and give values (or null) for every named move, so the moves are registered before any look is.
import '../moves/index.mjs';
import { desk } from './desk.mjs';
import { pop } from './pop.mjs';
import { cosmos } from './cosmos.mjs';
import { ledger } from './ledger.mjs';
import { poster } from './poster.mjs';

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
 * @property {{ columns: 12, margin: number, gutter: number }} [gridTall]  the grid of a frame that is not wide (9:16,
 *   1:1, 4:5), when it differs (ledger); a film resolves its format's grid once (lookForFormat), so every reader of
 *   look.grid sees one grid per film
 * @property {(sizeUnits: number, role?: TrackingRole) => number} tracking  letter spacing in em; role defaults to 'display'
 * @property {{ display: boolean, label: boolean }} caps  set in capitals
 * @property {{ display: number, text: number }} lineHeight  multiples of the font size
 * @property {{ display: number, text: number }} maxLines
 * @property {{ text: number }} wordsPerLine
 * @property {{ field: string, params: object }} field  a name in registries.fields and its params
 * @property {'editorial' | 'centred' | 'stack'} composition  how shots lay out: flush left on grid columns, centred, or
 *   a stack of short lines each set at its own size to fill the width, flush left
 * @property {'highlight' | 'recolor-scale' | 'recolor' | 'glow' | 'weight-color'} emphasis  a highlighter band, a
 *   recolour with a pulse, a recolour alone, a glow, or a step to a heavier weight in the accent: a name in the emphasis
 *   table (engine/kinds/emphasis.mjs EMPHASIS), which the kinds read instead of comparing the name; a new emphasis
 *   system is a new entry there
 * @property {{ enter: Move, exit: Move, emphasize: Move, draw: Move, count: Move } & Record<string, Move | null>} moves  the
 *   five the first kinds use, and an entry for every move in registries.moves (engine/moves: rise, wipe, slam, pop, draw,
 *   count, settle), a Move or null where the look does not use it (checked by validateLook as the look registers)
 * @property {Record<string, { experimental?: boolean, experimentalTypes?: string[] }>} [kinds]  see below; a kind entry
 *   with `experimental: true` parks the kind in this look (isParkedKind), `chart.experimentalTypes` parks chart types
 * @property {number} wordStagger  seconds between words that have no spoken time; 0 means words follow their spoken times
 * @property {{ drift: number, style: 'desk' | 'locked' }} camera  drift is a travel in units
 * @property {string[]} cuts  the cuts a film in this look may name: registered cut names (every shipped look lists all)
 * @property {string[]} cutPalette  the look's preferred cuts, in order: a non-empty subset of `cuts` holding "cut" (what
 *   --list cuts names per look and the director reaches for; a cut outside it is not a finding)
 * @property {Record<string, { direction?: string, duration?: number, smear?: boolean, smearAxes?: string[] }>} [cutStyle]
 *   the look's defaults per cut, each checked against that cut's options (engine/cuts/resolve.mjs resolveCut reads them
 *   after the shot's and the film's root cut); `smear: true` makes a smearable cut draw its motion smear, and
 *   `smearAxes` (look data, no film option) limits it to moves along those axes (engine/cuts/smear.mjs smearsAlong)
 * @property {{ line?: { color: string, width: number, alpha: number }, shadow?: { color: string, width: number,
 *   alpha: number, steps: number } }} [coverEdge]  the leading edge of a cover cut's sheet (engine/cuts/cover.mjs):
 *   palette colour names, widths in pixels
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
 * @property {'plain'} [captionVariant]  a variant of the caption style the look selects (lower: 'plain', ledger's strip)
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

const FORMAT_RE = /^(\d+):(\d+)$/;
const DEFAULT_FORMAT = '16:9';

/**
 * The look as a film in `format` ('16:9', '9:16', '1:1', '4:5') sees it: a look with a `gridTall` takes it as its grid
 * on a frame that is not wide; any other look (or a wide frame) is returned as it is, the same object.
 */
export function lookForFormat(look, format = DEFAULT_FORMAT) {
  if (look.gridTall === undefined) return look;
  const match = FORMAT_RE.exec(format);
  if (match === null) throw new Error(`lookForFormat: format must be "w:h", for example "9:16", got ${JSON.stringify(format)}`);
  const wide = Number(match[1]) > Number(match[2]);
  return wide ? look : Object.freeze({ ...look, grid: look.gridTall });
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

const CUT_STYLE_KEYS = Object.freeze(['direction', 'duration', 'smear', 'smearAxes']);
const PALETTE_SHAPE = 'cutPalette must be a non-empty list of its cuts holding "cut"';

// The errors of a look's cut set (`cuts`: registered cut names) and its palette (a non-empty subset holding "cut").
function cutSetErrors(name, look, cuts) {
  if (!Array.isArray(look.cuts)) return [`look "${name}": cuts must be a list of registered cut names, got ${String(look.cuts)}`];
  const unknown = look.cuts.map((cut, i) => (cuts.has(cut) ? null : `look "${name}": cuts.${i} ${JSON.stringify(cut)} is not a registered cut`)).filter(Boolean);
  const palette = look.cutPalette;
  if (!Array.isArray(palette) || palette.length === 0 || !palette.includes('cut')) return [...unknown, `look "${name}": ${PALETTE_SHAPE}, got ${JSON.stringify(palette)}`];
  const outside = palette.map((cut, i) => (look.cuts.includes(cut) ? null : `look "${name}": cutPalette.${i} ${JSON.stringify(cut)} is not one of its cuts`)).filter(Boolean);
  return [...unknown, ...outside];
}

// The errors of a look's cutStyle (absent, or { [cut]: { direction?, duration?, smear? } }), each entry checked against
// that cut's own options (engine/cuts/resolve.mjs cutOptionProblems). The boolean `smear` of earlier looks is refused.
function cutStyleErrors(name, look, cuts) {
  if (look.smear !== undefined) return [`look "${name}": smear is gone; write cutStyle: { slide: { smear: true } } for each cut that smears`];
  const style = look.cutStyle;
  if (style === undefined) return [];
  if (!isPlainObject(style)) return [`look "${name}": cutStyle must be an object of cut names to { direction?, duration?, smear? }, got ${String(style)}`];
  return Object.entries(style).flatMap(([cut, options]) => {
    if (!cuts.has(cut)) {
      const hint = didYouMean(cut, cuts.names());
      return [`look "${name}": cutStyle.${cut} is not a registered cut${hint ? `; did you mean "${hint}"?` : ''}`];
    }
    if (!isPlainObject(options)) return [`look "${name}": cutStyle.${cut} must be an object, got ${String(options)}`];
    return cutOptionProblems(options, cut, { keys: CUT_STYLE_KEYS, cuts }).map((p) => `look "${name}": cutStyle.${cut}.${p.key}: ${p.message}`);
  });
}

const EDGE_PARTS = Object.freeze({ line: ['color', 'width', 'alpha'], shadow: ['color', 'width', 'alpha', 'steps'] });
const MAX_EDGE_STEPS = 16;

// The errors of one part of look.coverEdge ({ color, width, alpha } and a shadow's `steps`).
function edgePartErrors(name, look, part, value) {
  const at = `look "${name}": coverEdge.${part}`;
  if (!isPlainObject(value)) return [`${at} must be an object of ${EDGE_PARTS[part].join(', ')}, got ${String(value)}`];
  const extra = Object.keys(value).filter((key) => !EDGE_PARTS[part].includes(key)).map((key) => `${at}.${key} is not a field; it takes ${EDGE_PARTS[part].join(', ')}`);
  const checks = [
    [typeof look.palette?.[value.color] === 'string', `${at}.color must name a palette colour (${Object.keys(look.palette ?? {}).join(', ')}), got ${JSON.stringify(value.color)}`],
    [typeof value.width === 'number' && value.width > 0, `${at}.width must be a number of pixels > 0, got ${JSON.stringify(value.width)}`],
    [typeof value.alpha === 'number' && value.alpha > 0 && value.alpha <= 1, `${at}.alpha must be a number above 0 and at most 1, got ${JSON.stringify(value.alpha)}`],
    [part !== 'shadow' || (Number.isInteger(value.steps) && value.steps >= 1 && value.steps <= MAX_EDGE_STEPS), `${at}.steps must be a whole number from 1 to ${MAX_EDGE_STEPS}, got ${JSON.stringify(value.steps)}`],
  ];
  return [...extra, ...checks.filter(([ok]) => !ok).map(([, message]) => message)];
}

// The errors of a look's coverEdge (absent, or { line?, shadow? }): the visible leading edge of a cover cut's sheet
// (engine/cuts/cover.mjs).
function coverEdgeErrors(name, look) {
  const edge = look.coverEdge;
  if (edge === undefined) return [];
  if (!isPlainObject(edge)) return [`look "${name}": coverEdge must be an object of line and shadow, got ${String(edge)}`];
  const unknown = Object.keys(edge).filter((key) => !(key in EDGE_PARTS)).map((key) => `look "${name}": coverEdge.${key} is not a field; it takes line, shadow`);
  return [...unknown, ...Object.keys(EDGE_PARTS).filter((part) => edge[part] !== undefined).flatMap((part) => edgePartErrors(name, look, part, edge[part]))];
}

// look.cutMotion (absent, or { punchZoom?, punchEase?, smearShutter?, irisAt? }): how hard the punch lands and on what
// ease (engine/cuts/index.mjs punchParts), the share of a frame the smear's shutter is open (engine/cuts/smear.mjs), and
// the point the iris opens from, [x, y] as fractions of the canvas: a point the look's layouts keep clear of words
// (engine/cuts/layers.mjs; gate-cuts-1 D8).
const isFraction = (v) => typeof v === 'number' && v >= 0 && v <= 1;
const CUT_MOTION = Object.freeze({
  punchZoom: [(v) => typeof v === 'number' && v > 1 && v <= 2, 'must be a number above 1 and at most 2'],
  punchEase: [(v) => typeof v === 'string' && easeProblem(v) === null, 'must be an ease name (linear; in, out or inOut with Quad, Cubic, Quart, Expo or Back)'],
  smearShutter: [(v) => typeof v === 'number' && v > 0 && v <= 1, 'must be a number above 0 and at most 1'],
  irisAt: [(v) => Array.isArray(v) && v.length === 2 && v.every(isFraction), 'must be two numbers from 0 to 1 (x and y as fractions of the canvas)'],
});

// The error ease(name) throws, or null when it names a curve.
function easeProblem(name) {
  try {
    ease(name);
    return null;
  } catch (error) {
    return error.message;
  }
}

function cutMotionErrors(name, look) {
  const motion = look.cutMotion;
  if (motion === undefined) return [];
  if (!isPlainObject(motion)) return [`look "${name}": cutMotion must be an object of ${Object.keys(CUT_MOTION).join(', ')}, got ${String(motion)}`];
  return Object.entries(motion).flatMap(([key, value]) => {
    if (!(key in CUT_MOTION)) return [`look "${name}": cutMotion.${key} is not a field; it takes ${Object.keys(CUT_MOTION).join(', ')}`];
    const [ok, message] = CUT_MOTION[key];
    return ok(value) ? [] : [`look "${name}": cutMotion.${key} ${message}, got ${JSON.stringify(value)}`];
  });
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
  const cutErrors = [...cutSetErrors(look.name, look, cuts), ...cutStyleErrors(look.name, look, cuts), ...coverEdgeErrors(look.name, look), ...cutMotionErrors(look.name, look)];
  if (cutErrors.length > 0) throw new RangeError(cutErrors.join('\n'));
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

for (const definition of [desk, pop, cosmos, ledger, poster]) {
  if (!registries.looks.has(definition.name)) registries.looks.add(definition.name, deepFreeze(definition));
}

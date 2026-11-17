// The one normaliser of a shot's cut. A film names a cut on a shot as a name ("slide") or an object
// { type, direction?, duration?, smear? }; a root `cut` of the same shape is the film's default for every shot after the
// first, and the look's `cutStyle` (engine/looks) holds its defaults per cut. resolveCut turns all of that into the one
// cut every reader uses: the film, the camera, the review, the strips, the sound. Pure and DOM-free.
import { registries } from '../registry.mjs';
import { didYouMean } from '../../shared/errors.mjs';
import { DIRECTION_MEANING, takesEdges } from './edges.mjs';
import './index.mjs';

/** The cut a shot gets when neither it nor the film names one. */
export const DEFAULT_CUT = 'cut';
/** The keys a cut object may hold. */
export const CUT_KEYS = Object.freeze(['type', 'direction', 'duration', 'smear']);
/** The range of a cut's `duration` option, in seconds (the version 1 limits). */
export const CUT_DURATION = Object.freeze({ min: 0.1, max: 2 });

const DEFAULT_MODE = 'pro'; // as engine/graph/film.mjs: the mode of a film that names none

const asObject = (value) => (typeof value === 'string' ? { type: value } : (value ?? null));

/**
 * The cut `value` (a shot's `cut`: a name, an object or undefined) resolves to.
 * @param {string | object | undefined} value
 * @param {{ look?: object | null, rootCut?: string | object, shotDuration?: number, cuts?: object }} [options] the film's
 *   look (its cutStyle gives defaults; null skips them), the film's root `cut`, the length of the shot the cut opens (the
 *   window is clamped to it) and the cuts registry (default the shared one)
 * @returns {{ name: string, entry: object, family: 'node' | 'layer' | 'shader', direction: string | null, dur: number,
 *   smear: boolean, incomingOnly: boolean }} frozen. Defaults, in order: the shot's value, the root cut (when it names the
 *   same cut), look.cutStyle[name], the registry entry. Throws for an unregistered name (the validator reports first).
 */
export function resolveCut(value, { look = null, rootCut, shotDuration, cuts = registries.cuts } = {}) {
  const own = asObject(value), root = asObject(rootCut);
  const name = own?.type ?? root?.type ?? DEFAULT_CUT;
  const entry = cuts.get(name); // the registry's own error, with its did-you-mean, for a name it does not have
  const layers = [own, root?.type === name ? root : null, look?.cutStyle?.[name] ?? null].filter((layer) => layer !== null);
  const pick = (key) => layers.find((layer) => layer[key] !== undefined)?.[key];
  const directions = Array.isArray(entry.directions) ? entry.directions : null;
  const full = entry.dur === 0 ? 0 : (pick('duration') ?? entry.dur);
  return Object.freeze({
    name,
    entry,
    family: entry.family ?? 'node',
    direction: directions === null ? null : (pick('direction') ?? directions[0]),
    dur: Number.isFinite(shotDuration) ? Math.min(full, shotDuration) : full,
    smear: entry.smearable === true && pick('smear') === true,
    incomingOnly: entry.incomingOnly === true,
  });
}

// "a, b or c"
const orList = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`);
const shown = (value) => JSON.stringify(value) ?? String(value);
const smearableNames = (cuts) => cuts.names().filter((name) => cuts.get(name).smearable === true);

function directionProblem(value, name, entry) {
  const directions = Array.isArray(entry.directions) ? entry.directions : null;
  if (directions === null) return `the "${name}" cut takes no direction; remove "direction"`;
  if (directions.includes(value)) return null;
  const meaning = takesEdges(directions) ? ` (${DIRECTION_MEANING})` : '';
  return `the "${name}" cut takes a direction of ${orList(directions)}${meaning}, got ${shown(value)}`;
}

function durationProblem(value, entry) {
  if (entry.dur === 0) return 'a hard cut has no duration; remove "duration"';
  const fits = typeof value === 'number' && value >= CUT_DURATION.min && value <= CUT_DURATION.max;
  return fits ? null : `must be a number of seconds from ${CUT_DURATION.min} to ${CUT_DURATION.max}, got ${shown(value)}`;
}

function smearProblem(value, name, entry, cuts) {
  if (typeof value !== 'boolean') return `must be true or false, got ${shown(value)}`;
  return value && entry.smearable !== true ? `the "${name}" cut takes no smear; the cuts that do: ${smearableNames(cuts).join(', ')}` : null;
}

/**
 * What is wrong with the options of registered cut `name` in `options` (a cut object, or a look's cutStyle entry), as
 * [{ key, message }]: a key outside `keys` (with a did-you-mean), a direction outside the cut's list or on a cut with
 * none, a duration outside CUT_DURATION or on the hard cut, smear that is not a boolean or is true on a cut that cannot
 * smear. The validator (scripts/v2/spec-cuts.mjs) and validateLook (engine/looks) both report through it.
 */
export function cutOptionProblems(options, name, { keys = CUT_KEYS, cuts = registries.cuts } = {}) {
  const entry = cuts.get(name);
  const unknown = Object.keys(options).filter((key) => !keys.includes(key)).map((key) => {
    const hint = didYouMean(key, keys);
    return { key, message: `unknown option ${shown(key)}; ${hint ? `did you mean "${hint}"? A` : 'a'} cut takes: ${keys.join(', ')}` };
  });
  const checks = [
    ['direction', (v) => directionProblem(v, name, entry)],
    ['duration', (v) => durationProblem(v, entry)],
    ['smear', (v) => smearProblem(v, name, entry, cuts)],
  ];
  const known = checks.filter(([key]) => options[key] !== undefined)
    .map(([key, check]) => ({ key, message: check(options[key]) }))
    .filter((problem) => problem.message !== null);
  return [...unknown, ...known];
}

/** The name of the cut `value` (with `rootCut` the film's root cut) names, or null when it is not a name or an object
 *  with a string `type`: for readers that must not throw on a film the validator has not passed. */
export function cutNameOf(value, rootCut) {
  const named = asObject(value) ?? asObject(rootCut);
  if (named === null) return DEFAULT_CUT;
  return typeof named === 'object' && typeof named.type === 'string' ? named.type : null;
}

/** The look a film names, or its mode's default; null when either is unknown (the validator reports it). */
export function filmLook(film, { modes = registries.modes, looks = registries.looks } = {}) {
  const mode = film.mode ?? DEFAULT_MODE;
  if (!modes.has(mode)) return null;
  const name = film.look ?? modes.get(mode).defaultLook;
  return looks.has(name) ? looks.get(name) : null;
}

/**
 * The cut that opens shot `index` of `film` (resolveCut with the film's root cut), or null for the first shot, which
 * nothing is cut from. `look` defaults to the film's own (filmLook).
 */
export function resolveShotCut(film, index, { look = filmLook(film), shotDuration, cuts = registries.cuts } = {}) {
  if (index === 0) return null;
  return resolveCut(film.shots[index].cut, { look, rootCut: film.cut, shotDuration, cuts });
}

/**
 * A resolved cut written out as a shot's `cut` with every option explicit, so a reader that sees only the shot (a kind)
 * resolves it to the same cut without the film's root cut or the look. Give it a cut resolved without `shotDuration`:
 * the reader clamps to the shot itself.
 */
export function explicitCut(cut) {
  if (cut.entry.dur === 0) return Object.freeze({ type: cut.name });
  return Object.freeze({ type: cut.name, ...(cut.direction === null ? {} : { direction: cut.direction }), duration: cut.dur, smear: cut.smear });
}

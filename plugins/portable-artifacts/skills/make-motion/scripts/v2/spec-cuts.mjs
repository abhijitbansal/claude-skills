// The film's cuts, validated: a shot's `cut` and the root `cut` (the default of every shot after the first) are a cut
// name or { type, direction?, duration?, smear? } (engine/cuts/resolve.mjs). Every error is { path, message } with a
// did-you-mean where a near name exists. Split out of spec.mjs.
import { registries as defaultRegistries } from '../../engine/registry.mjs';
import { CUT_KEYS, DEFAULT_CUT, cutOptionProblems } from '../../engine/cuts/resolve.mjs';
import { didYouMean, pathJoin } from '../../shared/errors.mjs';
import { isPlainObject, quote } from './spec-common.mjs';

const SHAPE = '{ "type": name, "direction"?, "duration"?, "smear"? }';

// The cut name `name` at `at`, against the look's cuts (look.cuts): the look and its cuts on a miss.
function nameErrors(name, at, look) {
  if (typeof name !== 'string' || name === '') return [{ path: at, message: `must be a cut name such as "slide", got ${quote(name)}` }];
  if (!look) return [];
  const cuts = look.cuts ?? [];
  if (cuts.includes(name)) return [];
  const hint = didYouMean(name, cuts);
  return [{ path: at, message: `look "${look.name}" has no cut ${quote(name)}; ${hint ? `did you mean "${hint}"? Its` : 'its'} cuts are: ${cuts.join(', ')}` }];
}

// A cut object: a type the look lists, then its options (engine/cuts/resolve.mjs cutOptionProblems, unknown keys included).
function objectErrors(cut, at, look, cuts) {
  if (cut.type === undefined) {
    // only the keys no cut takes: the others cannot be judged without a type
    const unknown = cutOptionProblems(Object.fromEntries(Object.entries(cut).filter(([key]) => !CUT_KEYS.includes(key))), DEFAULT_CUT, { cuts });
    return [...unknown.map((p) => ({ path: pathJoin(at, p.key), message: p.message })), { path: at, message: `a cut object needs "type", the cut's name, for example { "type": "slide", "direction": "left" }` }];
  }
  const named = nameErrors(cut.type, pathJoin(at, 'type'), look);
  if (named.length > 0 || !cuts.has(cut.type)) return named;
  return cutOptionProblems(cut, cut.type, { cuts }).map((p) => ({ path: pathJoin(at, p.key), message: p.message }));
}

/**
 * The errors of the cut value `cut` at path `at`: a name or an object, in `look` (its `cuts`; null skips the name check
 * when the look is unknown, which has its own error). `first`: the film's first shot, which accepts only the hard cut.
 */
export function cutErrors(cut, at, { look, first = false, regs = defaultRegistries }) {
  const cuts = regs.cuts ?? defaultRegistries.cuts;
  const name = typeof cut === 'string' ? cut : cut?.type;
  if (first && name !== DEFAULT_CUT && (typeof cut === 'string' || isPlainObject(cut))) {
    return [{ path: at, message: `the first shot has nothing before it to cut from; remove "cut", or write "cut": "cut" (got ${quote(name ?? cut)})` }];
  }
  if (typeof cut === 'string') return nameErrors(cut, at, look);
  if (isPlainObject(cut)) return objectErrors(cut, at, look, cuts);
  return [{ path: at, message: `must be a cut name such as "slide", or ${SHAPE}; got ${quote(cut)}` }];
}

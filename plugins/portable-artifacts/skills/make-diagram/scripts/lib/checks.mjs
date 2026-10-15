// Error helpers shared by the semantic checks (spec.mjs, stories.mjs): every
// message names the value and the fix, with a did-you-mean over a closed set.
import { didYouMean, pathJoin } from '../../shared/errors.mjs';
import { ID_PATTERN } from './schema.mjs';

const MAX_LISTED = 12;
const q = (v) => JSON.stringify(v);

export function suggestion(value, candidates, label = 'available') {
  const hint = didYouMean(value, candidates);
  if (hint) return `did you mean ${q(hint)}?`;
  const shown = candidates.slice(0, MAX_LISTED).join(', ');
  return `${label}: ${shown}${candidates.length > MAX_LISTED ? `, … (${candidates.length - MAX_LISTED} more)` : ''}`;
}

export function notFound(id, candidates, what = 'ids') {
  if (candidates.length === 0) return `${q(id)} not found; no ${what} are defined`;
  return `${q(id)} not found; ${suggestion(id, candidates)}`;
}

export function checkLength(errors, item, field, base, limit) {
  const value = item[field];
  if (typeof value !== 'string') return;
  const n = [...value].length;
  if (n > limit) errors.push({ path: pathJoin(base, field), message: `${field} is ${n} characters; the limit is ${limit} — shorten it` });
}

export function checkCount(errors, spec, field, limit) {
  const n = spec[field]?.length ?? 0;
  if (n > limit) errors.push({ path: field, message: `${field} has ${n} entries; the limit is ${limit} — split the diagram` });
}

export function checkRefs(errors, ids, base, candidates) {
  (ids ?? []).forEach((id, i) => {
    if (!candidates.includes(id)) errors.push({ path: pathJoin(base, i), message: notFound(id, candidates) });
  });
}

// Registers ids from [listName, items] pairs into `seen` (id -> path of first
// use) and reports bad spelling and duplicates. Items without an id are skipped.
export function registerIds(errors, lists, seen = new Map()) {
  for (const [list, items] of lists) {
    (items ?? []).forEach((item, i) => {
      if (item.id === undefined) return;
      const p = pathJoin(pathJoin(list, i), 'id');
      if (!ID_PATTERN.test(item.id)) {
        errors.push({ path: p, message: `id ${q(item.id)} is invalid; use lowercase letters, digits, - and _, starting with a letter` });
      }
      if (seen.has(item.id)) errors.push({ path: p, message: `duplicate id ${q(item.id)}; first used at ${seen.get(item.id)}; rename one` });
      else seen.set(item.id, p);
    });
  }
  return seen;
}

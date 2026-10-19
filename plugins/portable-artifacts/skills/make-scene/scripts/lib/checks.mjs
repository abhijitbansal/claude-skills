// Error helpers shared by the semantic checks: every message names the value
// and the fix, with a did-you-mean over a closed set.
import { didYouMean, pathJoin } from '../../shared/errors.mjs';

const MAX_LISTED = 12;
export const q = (v) => JSON.stringify(v);

export function suggestion(value, candidates, label = 'available') {
  const hint = didYouMean(value, candidates);
  if (hint) return `did you mean ${q(hint)}?`;
  const shown = candidates.slice(0, MAX_LISTED).join(', ');
  return `${label}: ${shown}${candidates.length > MAX_LISTED ? `, … (${candidates.length - MAX_LISTED} more)` : ''}`;
}

export function checkLength(errors, item, field, base, limit) {
  const value = item[field];
  if (typeof value !== 'string') return;
  const n = [...value].length;
  if (n > limit) errors.push({ path: pathJoin(base, field), message: `${field} is ${n} characters; the limit is ${limit}; shorten it` });
}

export function checkNegative(errors, value, at) {
  if (typeof value === 'number' && value < 0) errors.push({ path: at, message: `value ${value} is negative; values must be 0 or more` });
}

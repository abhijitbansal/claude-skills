// A plan's identity: its hash (does an answers file still fit this plan?) and its key (the answers' storage
// namespace, and the name a file carries). Both are computed from the spec alone, so the page build and the
// answers validator agree without sharing state.
import { createHash } from 'node:crypto';
import { LIMITS } from './schema.mjs';

const HASH_CHARS = 12;
const FALLBACK_CHARS = 6;
const KEY_PREFIX = 'plan-';

// JSON with every object's keys sorted, so key order in the spec file never changes the hash.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map((v) => canonical(v ?? null)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const body = Object.keys(value).filter((k) => value[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`);
    return `{${body.join(',')}}`;
  }
  return JSON.stringify(value);
}

/** First 12 hex characters of SHA-256 over the plan's title and sections (not generatedBy, theme, preset or key). */
export function planHash(spec) {
  return createHash('sha256').update(canonical({ title: spec.title, sections: spec.sections })).digest('hex').slice(0, HASH_CHARS);
}

/** `plan-<slug of the title>`: lowercase letters, digits and dashes, cut to the key limit; empty slugs use the hash. */
function titleKey(spec) {
  const slug = String(spec.title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const room = LIMITS.checklistKey - KEY_PREFIX.length;
  const cut = slug.slice(0, room).replace(/-+$/, '');
  return cut === '' ? `${KEY_PREFIX}${planHash(spec).slice(0, FALLBACK_CHARS)}` : `${KEY_PREFIX}${cut}`;
}

/** The plan's storage key: `spec.key` when set, else one derived from the title. */
export function planKey(spec) {
  return spec.key ?? titleKey(spec);
}

/** The key to suggest when a plan has none. */
export const suggestedPlanKey = (spec) => titleKey(spec);

// --list: what the engine has registered, for an author (or a model) that has to write a film. Every entry has a name
// and a one-line summary; a kind also lists its own fields with their types and gives one example shot as JSON.
import { registries } from '../../engine/registry.mjs';
import '../../engine/looks/index.mjs';
import '../../engine/modes/index.mjs';
import '../../engine/kinds/index.mjs';
import '../../engine/cuts/index.mjs';
import '../../engine/fields/index.mjs';

// Every shot takes these whatever its kind (scripts/v2/spec.mjs); a kind's own fields come on top.
export const COMMON_SHOT_FIELDS = Object.freeze([
  { name: 'id', type: 'string', required: true },
  { name: 'show', type: 'string', required: true },
  { name: 'say', type: 'string', required: false },
  { name: 'hold', type: 'number', required: false },
  { name: 'cut', type: 'string', required: false },
  { name: 'on', type: 'array', required: false },
]);

function typeOf(def) {
  if (Array.isArray(def.enum)) return def.enum.map((v) => JSON.stringify(v)).join(' | ');
  if (def.type === 'array') return def.items?.type ? `array of ${def.items.type}` : 'array';
  if (def.type === 'object' && def.additionalProperties?.type === 'array') return 'object of arrays';
  return def.type ?? 'any';
}

function kindFields(kind) {
  const { properties = {}, required = [] } = kind.schema ?? {};
  return Object.entries(properties).map(([name, def]) => ({ name, type: typeOf(def), required: required.includes(name) }));
}

function entryOf(listName, name) {
  const def = registries[listName].get(name);
  const entry = { name, summary: def.summary ?? '' };
  if (listName === 'kinds') return { ...entry, fields: kindFields(def), example: def.example ?? null };
  return entry;
}

/**
 * @param {'kinds' | 'looks' | 'modes' | 'devices' | 'cuts' | 'fields'} listName
 * @returns {{ name: string, summary: string, fields?: { name: string, type: string, required: boolean }[], example?: object | null }[]}
 */
export const listEntries = (listName) => registries[listName].names().map((name) => entryOf(listName, name));

const fieldText = (f) => `${f.name}${f.required ? '*' : ''}: ${f.type}`;

/** The text --list prints: one block per entry; a kind lists its fields and its example. */
export function formatList(listName, entries) {
  const head = [`${listName} (${entries.length})`];
  if (listName === 'kinds') head.push(`every shot also takes: ${COMMON_SHOT_FIELDS.map(fieldText).join(', ')} (* required; give say or hold, not both)`);
  const blocks = entries.map((e) => {
    const lines = [`${e.name}  ${e.summary}`];
    if (e.fields) lines.push(`  fields: ${e.fields.map(fieldText).join(', ') || 'none of its own'}`);
    if (e.example) lines.push(`  example: ${JSON.stringify(e.example)}`);
    return lines.join('\n');
  });
  return [...head, ...blocks].join('\n');
}

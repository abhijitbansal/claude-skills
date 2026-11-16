// --list: what the engine has registered, for an author (or a model) that has to write a film. Every entry has a name
// and a one-line summary; a kind also lists its own fields with their types and gives one example shot as JSON.
import { registries } from '../../engine/registry.mjs';
import { allLookNames, listedKinds, listedLooksOf } from '../../engine/looks/index.mjs';
import '../../engine/moves/index.mjs';
import '../../engine/modes/index.mjs';
import '../../engine/kinds/index.mjs';
import '../../engine/cuts/index.mjs';
import '../../engine/fields/index.mjs';
import { ACCEPTED_VOICES } from './voice/kokoro.mjs';

// The voices `voice: { name }` accepts (spec-sound.mjs checks against the same list), each with a line on how it sounds.
const VOICE_SUMMARIES = Object.freeze({ af_heart: 'American English, female; Kokoro 82M, made on this machine' });
const voiceEntries = () => ACCEPTED_VOICES.map((name) => ({ name, summary: VOICE_SUMMARIES[name] ?? 'a Kokoro voice' }));

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

// A kind's entry: its fields, its example and the listed looks that ship it; a parked kind (listed only under --all) is
// marked experimental.
function kindEntry(entry, def, name) {
  const parked = !listedKinds().includes(name);
  return { ...entry, ...(parked ? { experimental: true } : {}), fields: kindFields(def), example: def.example ?? null, looks: listedLooksOf(name) };
}

// A move's entry: its values in each listed look (null where the look does not use it).
const moveLooks = (name) => Object.fromEntries(registries.looks.names().map((look) => [look, registries.looks.get(look).moves?.[name] ?? null]));

function entryOf(listName, name) {
  const def = registries[listName].get(name);
  const entry = { name, summary: def.summary ?? '', ...(def.experimental === true ? { experimental: true } : {}) };
  if (listName === 'kinds') return kindEntry(entry, def, name);
  if (listName === 'moves') return { ...entry, looks: moveLooks(name) };
  return entry;
}

// The names a listing shows: every look with --all; the listed kinds (the parked ones too with --all); else the registry's.
function namesOf(listName, all) {
  if (listName === 'looks' && all) return allLookNames();
  if (listName === 'kinds') return all ? registries.kinds.names() : listedKinds();
  return registries[listName].names();
}

/**
 * @param {'kinds' | 'looks' | 'modes' | 'devices' | 'moves' | 'cuts' | 'fields' | 'voices'} listName
 * @param {{ all?: boolean }} [options] all: the experimental looks and the parked kinds too (--list looks --all, --list
 *   kinds --all), each with experimental: true
 * @returns {{ name: string, summary: string, fields?: { name: string, type: string, required: boolean }[], example?: object | null,
 *   looks?: string[] | Record<string, object | null> }[]} a kind's looks: the listed looks that ship it; a move's: its
 *   values in each listed look
 */
export function listEntries(listName, { all = false } = {}) {
  if (listName === 'voices') return voiceEntries();
  return namesOf(listName, all).map((name) => entryOf(listName, name));
}

const fieldText = (f) => `${f.name}${f.required ? '*' : ''}: ${f.type}`;

// A move's values as one short phrase: "outCubic 0.6 s, 24 units, steps at 12 fps, from 0.6", or "not used".
function moveText(move) {
  if (move === null) return 'not used';
  const parts = [`${move.ease} ${move.dur} s`];
  if (move.dist !== undefined) parts.push(`${move.dist} units`);
  if (move.step !== undefined) parts.push(`steps at ${move.step} fps`);
  if (move.scale !== undefined) parts.push(`from ${move.scale}`);
  return parts.join(', ');
}

/** The text --list prints: one block per entry; a kind lists its fields and its example, a move its values per look. */
export function formatList(listName, entries) {
  const head = [`${listName} (${entries.length})`];
  if (listName === 'kinds') head.push(`every shot also takes: ${COMMON_SHOT_FIELDS.map(fieldText).join(', ')} (* required; give say or hold, not both)`);
  const blocks = entries.map((e) => {
    const lines = [`${e.name}  ${e.experimental ? '(experimental) ' : ''}${e.summary}`];
    if (e.fields) lines.push(`  fields: ${e.fields.map(fieldText).join(', ') || 'none of its own'}`);
    if (e.example) lines.push(`  example: ${JSON.stringify(e.example)}`);
    if (listName === 'moves') lines.push(...Object.entries(e.looks).map(([look, move]) => `  ${look}: ${moveText(move)}`));
    return lines.join('\n');
  });
  return [...head, ...blocks].join('\n');
}

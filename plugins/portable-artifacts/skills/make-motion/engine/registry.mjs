// Named-extension registries for the v2 engine: one per extension point (kinds, looks, modes, ...).
// Pure and DOM-free. A Map keeps names like "constructor" from colliding with Object.prototype.
import { didYouMean } from '../shared/errors.mjs';

// kindLabel is the singular noun used in error messages: unknown look "dsk"; did you mean "desk"? (have: desk, pop)
export function createRegistry(kindLabel) {
  const defs = new Map();

  function add(name, def) {
    if (typeof name !== 'string' || name === '') throw new Error(`${kindLabel} name must be a non-empty string`);
    if (defs.has(name)) throw new Error(`${kindLabel} "${name}" is already registered`);
    defs.set(name, def);
  }

  function get(name) {
    if (defs.has(name)) return defs.get(name);
    const have = [...defs.keys()];
    const hint = didYouMean(name, have);
    throw new Error(`unknown ${kindLabel} "${name}"${hint ? `; did you mean "${hint}"?` : ''} (have: ${have.join(', ')})`);
  }

  return { add, get, has: (name) => defs.has(name), names: () => [...defs.keys()] };
}

export const registries = {
  kinds: createRegistry('kind'),
  looks: createRegistry('look'),
  modes: createRegistry('mode'),
  devices: createRegistry('device'),
  moves: createRegistry('move'),
  cuts: createRegistry('cut'),
  fields: createRegistry('field'),
  captions: createRegistry('caption style'),
};

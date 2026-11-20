// The named moves of the v2 engine. Importing this file registers each in registries.moves (once: a second evaluation
// leaves the registry as it is). A move is only a name and a summary here; its values are look data (look.moves.<name>:
// a Move { ease, dur, dist?, step?, scale? }, or null where the look does not use it), which validateLook requires for
// every registered move and moveOf reads. Kinds name moves; `on` events still place devices. Pure and DOM-free.
import { registries } from '../registry.mjs';

export const MOVES = Object.freeze([
  { name: 'rise', summary: 'An entrance that rises a short way into place as it fades in.' },
  { name: 'wipe', summary: 'A reveal that wipes across the part, as a mask opening.' },
  { name: 'slam', summary: 'A hard arrival: the part lands from larger with a spring, or appears at once where the look does not slam.' },
  { name: 'pop', summary: 'A springy entrance that grows the part in from smaller.' },
  { name: 'draw', summary: 'A stroke that draws on along its path.' },
  { name: 'count', summary: 'A figure that counts up to its value.' },
  { name: 'settle', summary: 'A slow ease into a new place or size, for parts that move or rank while on screen.' },
].map(Object.freeze));

export const MOVE_NAMES = Object.freeze(MOVES.map((m) => m.name));

for (const { name, summary } of MOVES) {
  if (!registries.moves.has(name)) registries.moves.add(name, Object.freeze({ summary }));
}

/** look.moves[name], the look's values for a registered move; throws for an unknown name (with did-you-mean) and for a
 *  move the look does not use (its entry is null). */
export function moveOf(look, name) {
  registries.moves.get(name); // throws the registry's own message: the unknown name, the close one and the names it has
  const move = look.moves?.[name];
  if (move === null || move === undefined) throw new Error(`look "${look.name}" does not use the move "${name}"`);
  return move;
}

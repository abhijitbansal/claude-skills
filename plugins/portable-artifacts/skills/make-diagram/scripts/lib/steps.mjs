// Which ids a presentation reveals. The viewer runtime applies the same rules
// (template/story.js): a step reveals its show, focus and highlight ids;
// revealing a node reveals its ancestor groups; revealing a message reveals
// both of its participants.

/** Map of id -> parent group id for every node and nested group (graphs only). */
export function parentMap(spec) {
  const parents = new Map();
  for (const g of spec.groups ?? []) if (g.parent !== undefined) parents.set(g.id, g.parent);
  for (const n of spec.nodes ?? []) if (n.group !== undefined) parents.set(n.id, n.group);
  return parents;
}

/** Every id a list of steps reveals, including ancestor groups and message ends. */
export function revealedBy(spec, steps) {
  const revealed = new Set();
  const parents = parentMap(spec);
  const add = (id) => {
    for (let at = id; at !== undefined && !revealed.has(at); at = parents.get(at)) revealed.add(at);
  };
  for (const s of steps) for (const id of [...(s.show ?? []), ...(s.focus ?? []), ...(s.highlight ?? [])]) add(id);
  for (const m of spec.messages ?? []) if (revealed.has(m.id)) { add(m.from); add(m.to); }
  return revealed;
}

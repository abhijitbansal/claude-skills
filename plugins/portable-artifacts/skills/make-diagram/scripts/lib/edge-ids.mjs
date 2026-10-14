// Every edge's id (stories.mjs resolves beats against the same ids that
// layout-graph.mjs draws): the authored one, else `edge-<index>`, extended with
// `_` while it would reuse a node, group or other edge id (the viewer's id
// space is flat). A leaf module, so validation can name edges without loading ELK.
export function edgeIds(spec) {
  const edges = spec.edges ?? [];
  const taken = new Set([...(spec.groups ?? []), ...(spec.nodes ?? []), ...edges].map((x) => x.id).filter((id) => id !== undefined));
  return edges.map((e, i) => {
    if (e.id !== undefined) return e.id;
    let id = `edge-${i}`;
    while (taken.has(id)) id += '_';
    taken.add(id);
    return id;
  });
}

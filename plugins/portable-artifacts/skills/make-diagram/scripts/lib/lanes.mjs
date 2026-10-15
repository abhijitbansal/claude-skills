// Lanes: top-level groups stacked one above the other (a down-flow of stages,
// a right-architecture whose groups ELK stacked) are stretched to a common left
// and right edge, so they read as swim lanes. Pure: a new geometry, or the same
// object when nothing qualifies. Edges are not re-routed, so a group that an
// edge ends at keeps its box (anchorEdges only moves an end that sits on a box
// side; stretched, the arrow would stop inside the lane).
const round = (v) => Math.round(v * 10) / 10;

const overlapsVertically = (a, b) => a.y < b.y + b.height && b.y < a.y + a.height;
const overlapsBox = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

// The top-level group id a node belongs to (through its group chain), or null when ungrouped.
function topGroupOf(node, byId) {
  let id = node.group;
  while (id !== null && id !== undefined && byId.get(id).parent !== null) id = byId.get(id).parent;
  return id ?? null;
}

/** The geometry with its top-level groups stretched into lanes when they stack; else the same geometry. */
export function stretchLanes(geometry) {
  const top = geometry.groups.filter((g) => g.parent === null);
  if (top.length < 2) return geometry;
  const ids = new Set(top.map((g) => g.id));
  if (geometry.edges.some((e) => ids.has(e.from) || ids.has(e.to))) return geometry;
  for (let i = 0; i < top.length; i++) {
    for (let j = i + 1; j < top.length; j++) if (overlapsVertically(top[i], top[j])) return geometry;
  }
  const left = Math.min(...top.map((g) => g.x));
  const right = Math.max(...top.map((g) => g.x + g.width));
  // A stretched lane must not swallow a node that is not its member: it would read as belonging to the lane.
  const byId = new Map(geometry.groups.map((g) => [g.id, g]));
  const claimsForeign = top.some((g) => {
    const lane = { x: left, width: right - left, y: g.y, height: g.height };
    return geometry.nodes.some((n) => topGroupOf(n, byId) !== g.id && overlapsBox(n, lane));
  });
  if (claimsForeign) return geometry;
  return {
    ...geometry,
    groups: geometry.groups.map((g) => (ids.has(g.id) ? { ...g, x: round(left), width: round(right - left) } : g)),
  };
}

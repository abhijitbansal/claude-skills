// The preview's click-to-copy (engine/page/viewer.mjs): which drawn node is under a point of a frame. `snapshot` is the
// annotated tree window.__snapshot(i) gives (engine/page/bounds.mjs annotate: a canvas-pixel bbox on every node). The
// top-most node is the last one drawn, in draw order (each child after its parent), among the nodes that draw
// something themselves: a group draws only its children, and a field is the shot's background, never a target. A node
// with no opacity hides its subtree, as draw.mjs does. Pure and DOM-free.

const NOT_TARGETS = new Set(['group', 'field']);

const inside = ([bx, by, bw, bh], x, y) => x >= bx && x <= bx + bw && y >= by && y <= by + bh;

// The shot whose id the node's id begins with (`<shot id>` or `<shot id>.<anything>`), longest id first so "a.b" wins
// over "a" for a node "a.b.c".
function shotOf(nodeId, shotIds) {
  const order = shotIds.map((id, index) => ({ id, index })).sort((a, b) => b.id.length - a.id.length);
  return order.find(({ id }) => nodeId === id || nodeId.startsWith(`${id}.`)) ?? null;
}

function lastHit(nodes, x, y) {
  let hit = null;
  for (const n of nodes) {
    if (!(n.opacity > 0)) continue;
    if (!NOT_TARGETS.has(n.type) && Array.isArray(n.bbox) && inside(n.bbox, x, y)) hit = n;
    hit = lastHit(n.children ?? [], x, y) ?? hit;
  }
  return hit;
}

/**
 * @param {object[]} snapshot window.__snapshot(i)
 * @param {number} x canvas pixels
 * @param {number} y canvas pixels
 * @param {string[]} shotIds the film's shot ids, in order
 * @param {{ current?: number }} [opts] current: the index of the shot on screen, for a node whose id names no shot (a
 *   `free` shot keeps the ids its author wrote)
 * @returns {{ shot: number | null, path: string | null, id: string | null, node: string } | null}
 */
export function hitTest(snapshot, x, y, shotIds, { current } = {}) {
  const n = lastHit(snapshot, x, y);
  if (n === null) return null;
  const onScreen = Number.isInteger(current) && current >= 0 && current < shotIds.length ? { id: shotIds[current], index: current } : null;
  const shot = shotOf(n.id, shotIds) ?? onScreen;
  return shot === null ? { shot: null, path: null, id: null, node: n.id } : { shot: shot.index, path: `shots[${shot.index}]`, id: shot.id, node: n.id };
}

/** The line a click copies: `shots[2]  id=price  node=price.hero` (the node alone when it names no shot). */
export const copyLine = (hit) => (hit.path === null ? `node=${hit.node}` : `${hit.path}  id=${hit.id}  node=${hit.node}`);

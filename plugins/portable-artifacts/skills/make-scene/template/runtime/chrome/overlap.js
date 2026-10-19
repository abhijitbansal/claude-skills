// Which of a frame's screen-space label boxes to hide: a box that overlaps a nearer one that is kept. Pure (no DOM).

export const OVERLAP_PAD = 2; // px of breathing room around a box when testing for overlap

const overlaps = (a, b, pad) => a.x - a.w / 2 < b.x + b.w / 2 + pad
  && a.x + a.w / 2 + pad > b.x - b.w / 2
  && a.y - a.h < b.y + pad
  && a.y + pad > b.y - b.h;

/**
 * hiddenByOverlap(boxes) -> Set of ids to hide.
 * A box is { id, x, y, w, h, scale }: its bottom-centre point (x, y), its size in px, and `scale`, pixels per world
 * unit at its depth (larger is nearer). Boxes are placed nearest first (ties: lowest id); one that overlaps a placed
 * box is hidden. A hidden box never hides another.
 */
export function hiddenByOverlap(boxes, pad = OVERLAP_PAD) {
  const placed = [];
  const hidden = new Set();
  const order = [...boxes].sort((a, b) => b.scale - a.scale || a.id - b.id);
  for (const box of order) {
    if (placed.some((p) => overlaps(box, p, pad))) hidden.add(box.id);
    else placed.push(box);
  }
  return hidden;
}

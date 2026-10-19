// Camera bookmarks that look at something with nothing in the way. A world proposes camera positions in order of
// preference; the first whose line of sight to the target crosses none of the world's solid boxes is used.

const EPS = 1e-9;

/** True when the segment a -> b passes through the open box { min, max } (slab test; touching a face does not count). */
export function segmentHitsBox(a, b, { min, max }) {
  let enter = 0;
  let leave = 1;
  for (let axis = 0; axis < 3; axis++) {
    const d = b[axis] - a[axis];
    if (Math.abs(d) < EPS) {
      if (a[axis] <= min[axis] || a[axis] >= max[axis]) return false;
      continue;
    }
    const t1 = (min[axis] - a[axis]) / d;
    const t2 = (max[axis] - a[axis]) / d;
    enter = Math.max(enter, Math.min(t1, t2));
    leave = Math.min(leave, Math.max(t1, t2));
    if (enter >= leave - EPS) return false;
  }
  return true;
}

/** Axis-aligned box for a unit shape scaled [sx, sy, sz] and centred on [x, y, z] (an instance of the graph). */
export const boxOfInstance = (inst) => ({
  min: [inst[0] - inst[3] / 2, inst[1] - inst[4] / 2, inst[2] - inst[5] / 2],
  max: [inst[0] + inst[3] / 2, inst[1] + inst[4] / 2, inst[2] + inst[5] / 2],
});

/**
 * The first of `candidates` (camera positions) with a clear line to `target`; when every one is blocked, the one
 * with the fewest boxes in the way (the earliest of those). `blockers` are boxes { min, max }.
 */
export function clearPosition(target, candidates, blockers) {
  let best = candidates[0];
  let fewest = Infinity;
  for (const position of candidates) {
    const blocked = blockers.reduce((n, box) => n + (segmentHitsBox(position, target, box) ? 1 : 0), 0);
    if (blocked === 0) return position;
    if (blocked < fewest) {
      fewest = blocked;
      best = position;
    }
  }
  return best;
}

/**
 * Camera positions round `target`, `distance` away, lowest elevation first: for each elevation in `elevations`
 * (degrees above the floor, ascending), every heading in `headings` (horizontal [x, z], any length) in order of preference.
 */
export function ringCandidates(target, headings, elevations, distance) {
  const out = [];
  for (const degrees of elevations) {
    const up = (degrees * Math.PI) / 180;
    for (const [hx, hz] of headings) {
      const flat = Math.hypot(hx, hz) || 1;
      out.push([
        target[0] + (hx / flat) * Math.cos(up) * distance,
        target[1] + Math.sin(up) * distance,
        target[2] + (hz / flat) * Math.cos(up) * distance,
      ]);
    }
  }
  return out;
}

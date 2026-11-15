// Hand-drawn look: a path's points displaced by seeded noise. The seed is a hash of the node id, so a node wobbles
// the same way in every frame and every run. Cached per node, path and amplitude.
import { mulberry32 } from '/v1/seeded.mjs';
import { samplePolylines } from './geometry.mjs';

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const ROUGH_STEP_PX = 8; // distance between displaced points along the path

const roughCache = new Map();

// 32-bit FNV-1a of a string.
export function hashString(text) {
  let h = FNV_OFFSET;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

function displaced(polylines, amplitude, rng) {
  return polylines.map(({ points, closed }) => ({
    closed,
    points: points.map(([x, y]) => [x + (rng() * 2 - 1) * amplitude, y + (rng() * 2 - 1) * amplitude]),
  }));
}

function toShape(polylines) {
  const path = new Path2D();
  let length = 0;
  for (const { points, closed } of polylines) {
    path.moveTo(...points[0]);
    for (let i = 1; i < points.length; i++) {
      path.lineTo(...points[i]);
      length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    }
    if (closed) {
      path.closePath();
      length += Math.hypot(points[0][0] - points.at(-1)[0], points[0][1] - points.at(-1)[1]);
    }
  }
  return Object.freeze({ path, length });
}

/** { path: Path2D, length } of path string `d` with every point moved up to `amplitude` px, seeded by `id`. */
export function roughShape(id, d, amplitude) {
  const key = `${id}\n${amplitude}\n${d}`;
  if (!roughCache.has(key)) {
    const rng = mulberry32(hashString(id));
    roughCache.set(key, toShape(displaced(samplePolylines(d, ROUGH_STEP_PX), amplitude, rng)));
  }
  return roughCache.get(key);
}

// Camera framing, pure (no three, no DOM): how far back a camera must sit so a box fits the view,
// and how a focus bookmark's distance is adjusted for the viewport it lands in.

export const FIT_MARGIN = 1.2; // breathing room around the framed box
export const MIN_ELEVATION = (24 * Math.PI) / 180; // a default view is never flatter than this above the floor
export const MAX_ELEVATION_CLAMP = (20 * Math.PI) / 180; // the orbit never goes flatter than this (polar angle <= 90deg - this)

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a) => Math.hypot(a[0], a[1], a[2]);
const scaled = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const unit = (a) => scaled(a, 1 / (length(a) || 1));

/** The 8 corners of the axis-aligned box { min, max }. */
export function boxCorners({ min, max }) {
  const out = [];
  for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) out.push([x, y, z]);
  return out;
}

const RING_SAMPLES = 16;

/**
 * Every point the view must take in, so the fit follows the scene's real shape instead of its bounding box (a ring of
 * star systems is far narrower than the square round it): the corners of each instance, a circle for each ring, tube
 * points, label anchors and the corners of each surface. With none of those, the corners of graph.bounds.
 */
export function framePoints(graph) {
  const pts = [];
  for (const batch of graph.batches ?? []) {
    for (const [x, y, z, sx, sy, sz] of batch.instances) {
      if (batch.shape === 'ring') {
        for (let k = 0; k < RING_SAMPLES; k++) {
          const a = (2 * Math.PI * k) / RING_SAMPLES;
          pts.push([x + (Math.cos(a) * sx) / 2, y, z + (Math.sin(a) * sz) / 2]);
        }
      } else {
        for (const dx of [-sx / 2, sx / 2]) for (const dy of [-sy / 2, sy / 2]) for (const dz of [-sz / 2, sz / 2]) pts.push([x + dx, y + dy, z + dz]);
      }
    }
  }
  for (const tube of graph.tubes ?? []) for (const p of tube.points) pts.push(p);
  for (const label of graph.labels ?? []) pts.push(label.at);
  for (const surface of graph.surfaces ?? []) {
    const [sx, sz, sy] = surface.size;
    const top = surface.heights.reduce((m, h) => Math.max(m, h), 0) * sy;
    for (const x of [-sx / 2, sx / 2]) for (const y of [0, top]) for (const z of [-sz / 2, sz / 2]) pts.push([x, y, z]);
  }
  return pts.length > 0 ? pts : boxCorners(graph.bounds);
}

/**
 * The unit direction from `target` to the camera, with its elevation (above the floor) raised to `minElevation`
 * when it is flatter. A zero direction, or one straight below the target, falls back to a 3/4 view.
 */
export function viewDirection(from, minElevation = MIN_ELEVATION) {
  const len = length(from);
  const flat = Math.hypot(from[0], from[2]);
  if (len < 1e-9 || (flat < 1e-9 && from[1] < 0)) return unit([1, 0.8, 1]);
  if (flat < 1e-9) return scaled(from, 1 / len); // straight down: as steep as a view gets
  const elevation = Math.asin(Math.max(-1, Math.min(1, from[1] / len)));
  if (elevation >= minElevation) return scaled(from, 1 / len);
  const [x, z] = [from[0] / flat, from[2] / flat];
  return [x * Math.cos(minElevation), Math.sin(minElevation), z * Math.cos(minElevation)];
}

export const PORTRAIT_ASPECT = 0.8; // narrower than this counts as a phone held upright
const STRIP_RATIO = 1.8; // a scene this much longer than it is wide...
const FLAT_SHARE = 0.25; // ...and lower than this share of its length is a flat strip (a diagram laid on the floor)

/**
 * In a portrait viewport a flat strip seen side-on is a thin line across the middle; turn the view to look down its
 * length (the camera over one end, the same elevation) so it climbs the screen. The end the camera is nearer to
 * already is kept; any other scene, and any wider viewport, keeps `dir`.
 */
export function alignToStrip(dir, points, aspect) {
  if (aspect >= PORTRAIT_ASPECT || points.length === 0) return dir;
  const span = [0, 1, 2].map((a) => points.reduce((m, p) => Math.max(m, p[a]), -Infinity) - points.reduce((m, p) => Math.min(m, p[a]), Infinity));
  const [dx, dy, dz] = span;
  const long = Math.max(dx, dz);
  if (long < STRIP_RATIO * Math.min(dx, dz) || dy > FLAT_SHARE * long) return dir;
  const along = dx >= dz ? [1, 0] : [0, 1];
  const flat = Math.hypot(dir[0], dir[2]);
  const side = Math.sign(dir[0] * along[0] + dir[2] * along[1]) || 1;
  return [along[0] * side * flat, dir[1], along[1] * side * flat];
}

/**
 * Distance along `dir` (unit, target -> camera) at which every point of `points` is inside the view,
 * looking at `target`, with `margin` to spare. `fov` is the vertical field of view in radians.
 */
export function fitDistance(points, target, dir, { fov, aspect, margin = FIT_MARGIN }) {
  const forward = scaled(dir, -1);
  let right = cross(forward, [0, 1, 0]);
  if (length(right) < 1e-6) right = [1, 0, 0];
  right = unit(right);
  const up = cross(right, forward);
  const tanV = Math.tan(fov / 2);
  const tanH = tanV * Math.max(aspect, 0.05);
  let need = 0;
  for (const p of points) {
    const v = [p[0] - target[0], p[1] - target[1], p[2] - target[2]];
    const ahead = dot(v, forward);
    need = Math.max(need, (Math.abs(dot(v, right)) * margin) / tanH - ahead, (Math.abs(dot(v, up)) * margin) / tanV - ahead);
  }
  return Math.max(need, 1);
}

/**
 * A focus bookmark was authored for a square viewport; in a narrower one the same view would crop it, so its
 * offset from the target grows by 1/aspect, but never past `ceiling` (the overview's distance): a close-up that
 * sits farther out than the overview helps nobody. A landscape viewport keeps the authored distance.
 */
export function focusScale(offsetLength, aspect, ceiling) {
  if (offsetLength <= 0) return 1;
  const wanted = offsetLength / Math.min(1, Math.max(aspect, 0.05));
  return Math.max(1, Math.min(wanted, Math.max(ceiling, offsetLength)) / offsetLength);
}

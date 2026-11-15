// Path geometry for the stage: length and bounding box of an SVG path string, a cached Path2D, and points sampled
// along it. An offscreen SVG path element does the measuring (getTotalLength, getBBox, getPointAtLength); each
// path string is measured once and cached, since the same path is drawn every frame.
const SVG_NS = 'http://www.w3.org/2000/svg';
const SUBPATH_START = /(?=[Mm])/;
const CLOSED_PATH = /[zZ]\s*$/;
const FIRST_POINT_EPSILON = 1e-6;

let host = null;
const metricsCache = new Map();
const path2dCache = new Map();

// Attached (zero size, hidden) so every browser measures it; a detached path can report zeros.
function svgHost() {
  if (host === null) {
    host = document.createElementNS(SVG_NS, 'svg');
    host.setAttribute('width', '0');
    host.setAttribute('height', '0');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
    document.body.append(host);
  }
  return host;
}

function withPathElement(d, fn) {
  const el = document.createElementNS(SVG_NS, 'path');
  el.setAttribute('d', d);
  svgHost().append(el);
  try {
    return fn(el);
  } finally {
    el.remove();
  }
}

/** { length, bbox: [x, y, w, h] } of the path's fill geometry (no stroke), measured once per path string. */
export function measurePath(d) {
  if (!metricsCache.has(d)) {
    metricsCache.set(d, withPathElement(d, (el) => {
      const box = el.getBBox();
      return Object.freeze({ length: el.getTotalLength(), bbox: Object.freeze([box.x, box.y, box.width, box.height]) });
    }));
  }
  return metricsCache.get(d);
}

export function path2D(d) {
  if (!path2dCache.has(d)) path2dCache.set(d, new Path2D(d));
  return path2dCache.get(d);
}

function samplePoints(el, stepPx) {
  const length = el.getTotalLength();
  const count = Math.max(1, Math.ceil(length / stepPx));
  return Array.from({ length: count + 1 }, (_, i) => {
    const p = el.getPointAtLength((length * i) / count);
    return [p.x, p.y];
  });
}

// A closed subpath ends where it began; drop the repeated point so the polyline closes without a zero-length edge.
function openedIfClosed(points, closed) {
  const [fx, fy] = points[0];
  const [lx, ly] = points[points.length - 1];
  const loops = Math.abs(fx - lx) < FIRST_POINT_EPSILON && Math.abs(fy - ly) < FIRST_POINT_EPSILON;
  return closed && loops && points.length > 2 ? points.slice(0, -1) : points;
}

/** Each subpath of `d` as { points: [[x, y], ...], closed }, a point about every `stepPx` along it. */
export function samplePolylines(d, stepPx) {
  return d.split(SUBPATH_START).filter((sub) => sub.trim() !== '').map((sub, index) => {
    if (index > 0 && sub.trimStart().startsWith('m')) {
      throw new Error('rough: a later subpath must start with an absolute M, not a relative m');
    }
    const closed = CLOSED_PATH.test(sub);
    return withPathElement(sub, (el) => ({ points: openedIfClosed(samplePoints(el, stepPx), closed), closed }));
  });
}

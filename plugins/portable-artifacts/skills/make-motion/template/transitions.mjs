// Scene transitions, browser-safe and pure. A scene's `transition` is a name or { type, direction?, duration? }.
// normalizeTransition reads either form; layerStyles says how the two scene layers look at progress p of the window
// (the timeline eases p, template/timeline.mjs), and the renderer sets the styles it returns (template/renderer.mjs).
// `direction` of push, slide and wipe names the edge the incoming scene comes from.

export const TRANSITIONS = Object.freeze(['none', 'fade', 'crossfade', 'push', 'slide', 'wipe', 'zoom', 'blur', 'iris']);
export const TRANSITION_SECONDS = 0.4;
export const MIN_TRANSITION_SECONDS = 0.1;
export const MAX_TRANSITION_SECONDS = 2;

const EDGES = Object.freeze(['left', 'right', 'up', 'down']);
const SCALES = Object.freeze(['in', 'out']);
const DIRECTIONS = new Map([['push', EDGES], ['slide', EDGES], ['wipe', EDGES], ['zoom', SCALES], ['iris', SCALES]]);
const FROM_EDGE = new Map([['left', [-1, 0]], ['right', [1, 0]], ['up', [0, -1]], ['down', [0, 1]]]); // where the incoming scene starts, in canvas sizes
const OVERLAPPING = new Set(['crossfade', 'push', 'slide', 'wipe', 'zoom', 'blur', 'iris']); // the incoming scene comes in over the outgoing one

const ZOOM_FROM = new Map([['in', 1.2], ['out', 0.8]]);
const BLUR_PX = 24;
const IRIS_REACH = 71; // a circle of this radius, in percent of the box's reference length, covers the corners of any box

/** The directions `type` accepts, in order (the first is the default), or null when it takes none. */
export const directionsOf = (type) => DIRECTIONS.get(type) ?? null;

/** True for a transition whose incoming scene comes in over the previous one (every name but none and fade). */
export const comesInOver = (type) => OVERLAPPING.has(type);

/** { type, direction, duration } of a name or object; `direction` is null where the type takes none. Unknown input is "none". */
export function normalizeTransition(value) {
  const written = typeof value === 'string' ? { type: value } : (typeof value === 'object' && value !== null ? value : {});
  const type = TRANSITIONS.includes(written.type) ? written.type : 'none';
  const directions = directionsOf(type);
  const direction = directions ? (directions.includes(written.direction) ? written.direction : directions[0]) : null;
  const wanted = Number.isFinite(written.duration) ? written.duration : TRANSITION_SECONDS;
  return { type, direction, duration: Math.min(MAX_TRANSITION_SECONDS, Math.max(MIN_TRANSITION_SECONDS, wanted)) };
}

/**
 * How long the transition into `scene` (the `si`th) is on screen, in seconds: 0 for none, and for any name but fade on
 * the first scene (a cut there); else its duration, cut short to the scene's own length. Every window is a stretch of
 * change for the audits, whatever it does to the layer.
 */
export function windowSeconds(scene, si) {
  const { type, duration } = normalizeTransition(scene.transition);
  if (type === 'none' || (si === 0 && type !== 'fade')) return 0;
  return Math.min(duration, scene.duration);
}

const PRECISION = 4;
const num = (v) => String(+v.toFixed(PRECISION)); // no float noise, no "-0"
const translate = ([x, y]) => `translate(${num(x)}px, ${num(y)}px)`;
const unset = () => ({ opacity: null, transform: null, clipPath: null, filter: null });

// inset() of the part still hidden, from the edge the incoming scene grows from.
function wipeClip(direction, p) {
  const hidden = 100 * (1 - p);
  const sides = { left: [0, hidden, 0, 0], right: [0, 0, 0, hidden], up: [0, 0, hidden, 0], down: [hidden, 0, 0, 0] }[direction];
  return `inset(${sides.map((v) => `${num(v)}%`).join(' ')})`;
}

const circle = (radius) => `circle(${num(radius)}% at 50% 50%)`;

/**
 * How the two layers of a transition look at progress `p` (0 to 1) of its window, for a canvas of `size` [w, h]:
 * { incoming, outgoing }, each { opacity, transform, clipPath, filter } with null for a property the transition leaves
 * alone (the layer keeps its own opacity and no transform, clip or filter). none, fade and crossfade set nothing.
 */
export function layerStyles(transition, p, size) {
  const { type, direction } = normalizeTransition(transition);
  const incoming = unset();
  const outgoing = unset();
  const [width, height] = size;
  if (type === 'push' || type === 'slide') {
    const [dx, dy] = FROM_EDGE.get(direction);
    incoming.transform = translate([dx * (1 - p) * width, dy * (1 - p) * height]);
    if (type === 'push') outgoing.transform = translate([-dx * p * width, -dy * p * height]);
  } else if (type === 'wipe') {
    incoming.clipPath = wipeClip(direction, p);
  } else if (type === 'zoom') {
    incoming.transform = `scale(${num(ZOOM_FROM.get(direction) * (1 - p) + p)})`;
    incoming.opacity = p;
  } else if (type === 'blur') {
    incoming.filter = `blur(${num(BLUR_PX * (1 - p))}px)`;
    incoming.opacity = p;
  } else if (type === 'iris') {
    if (direction === 'in') incoming.clipPath = circle(IRIS_REACH * p);
    else outgoing.clipPath = circle(IRIS_REACH * (1 - p));
  }
  return { incoming, outgoing };
}

/** The layer that is drawn beneath the other for the window: the incoming one when an iris closes over it, else null. */
export function layerUnder(transition) {
  const { type, direction } = normalizeTransition(transition);
  return type === 'iris' && direction === 'out' ? 'incoming' : null;
}

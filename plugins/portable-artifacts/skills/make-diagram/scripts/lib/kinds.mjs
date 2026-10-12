// Per-type node kinds. Shape encodes kind (colour is never the only signal);
// `icon` is the default icon ref (null = drawn as a pure shape), read from
// icons.mjs so the two tables cannot drift apart. The first kind of each type
// is its default.
import { DEFAULT_ICON } from './icons.mjs';

export const TYPES = Object.freeze(['architecture', 'flow', 'sequence', 'state']);

// kind -> shape, per type, in the order the spec table lists them.
const SHAPES = {
  architecture: {
    service: 'rounded-rect',
    client: 'rounded-rect',
    user: 'rounded-rect',
    database: 'cylinder',
    storage: 'cylinder',
    queue: 'stacked-rect',
    cache: 'rounded-rect',
    function: 'rounded-rect',
    gateway: 'hexagon-rect',
    external: 'dashed-rounded-rect',
    other: 'rounded-rect',
  },
  flow: {
    step: 'rect',
    start: 'stadium',
    end: 'stadium',
    decision: 'diamond',
    io: 'parallelogram',
    subprocess: 'double-bar-rect',
    wait: 'rounded-rect',
  },
  state: {
    state: 'rounded-rect',
    start: 'filled-dot',
    end: 'ringed-dot',
    choice: 'small-diamond',
  },
  // Participants reuse the architecture shapes for the kinds they share.
  sequence: {
    service: 'rounded-rect',
    actor: 'rounded-rect',
    database: 'cylinder',
    queue: 'stacked-rect',
    external: 'dashed-rounded-rect',
  },
};

// Shapes with room for an icon. The others (stadium, diamonds, dots) are drawn
// as a bare shape, so an icon on those kinds would be silently dropped.
const BOX_SHAPES = new Set([
  'rounded-rect', 'rect', 'cylinder', 'stacked-rect', 'hexagon-rect',
  'dashed-rounded-rect', 'parallelogram', 'double-bar-rect',
]);

export function canHoldIcon(type, kind) {
  return BOX_SHAPES.has(KINDS[type].kinds[kind].shape);
}

function build(shapes) {
  const kinds = {};
  for (const [kind, shape] of Object.entries(shapes)) {
    kinds[kind] = Object.freeze({ shape, icon: DEFAULT_ICON[kind] ?? null });
  }
  return Object.freeze({ default: Object.keys(shapes)[0], kinds: Object.freeze(kinds) });
}

export const KINDS = Object.freeze(Object.fromEntries(
  Object.entries(SHAPES).map(([type, shapes]) => [type, build(shapes)]),
));

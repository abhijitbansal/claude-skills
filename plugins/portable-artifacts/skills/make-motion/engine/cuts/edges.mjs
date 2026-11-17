// The one table of what a cut's direction means on screen (look review gate-cuts-1, P-F1): `left` and `right` name the
// edge the incoming shot enters by; `up` and `down` name the way it moves, as a viewer says it, so `down` enters at the
// top edge and travels down and `up` enters at the bottom edge and travels up. Every cut that takes an edge (slide,
// cover, wipe, cube) reads its entry edge here. Canvas y grows downward. Pure and DOM-free.

/** The screen edge the incoming shot enters by, for each direction a moving cut takes, the first the default. */
export const ENTRY_EDGE = Object.freeze({ right: 'right', left: 'left', up: 'bottom', down: 'top' });

/** The unit vector from the centre of the canvas toward each screen edge, canvas y downward. */
export const EDGE_VECTOR = Object.freeze({
  right: Object.freeze([1, 0]), left: Object.freeze([-1, 0]), top: Object.freeze([0, -1]), bottom: Object.freeze([0, 1]),
});

/** The edge across the canvas from each edge. */
export const OPPOSITE_EDGE = Object.freeze({ right: 'left', left: 'right', top: 'bottom', bottom: 'top' });

/** The unit vector from the centre toward the edge the incoming shot of `direction` enters by. */
export const entryVector = (direction) => EDGE_VECTOR[ENTRY_EDGE[direction]];

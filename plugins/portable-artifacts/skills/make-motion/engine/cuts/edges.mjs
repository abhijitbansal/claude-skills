// The one table of what a cut's direction means on screen (look review gate-cuts-1, P-F1; lead ruling 1, round 2): one
// rule for all four, `direction` names the way the incoming content moves, as a viewer says it. `left` moves leftward,
// so it enters by the right edge; `right` enters by the left edge; `up` moves upward and enters by the bottom edge;
// `down` enters by the top edge. Version 2 is a clean break from version 1, where a direction named the entry edge.
// Every cut that takes an edge (slide, cover, wipe, cube) reads its entry edge here. Canvas y grows downward. Pure and
// DOM-free.

/** The screen edge the incoming shot enters by, for each direction a moving cut takes; the first (left: in from the
 *  right edge, the picture slide and cover always had by default) is their default. */
export const ENTRY_EDGE = Object.freeze({ left: 'right', right: 'left', up: 'bottom', down: 'top' });

/** The unit vector from the centre of the canvas toward each screen edge, canvas y downward. */
export const EDGE_VECTOR = Object.freeze({
  right: Object.freeze([1, 0]), left: Object.freeze([-1, 0]), top: Object.freeze([0, -1]), bottom: Object.freeze([0, 1]),
});

/** The edge across the canvas from each edge. */
export const OPPOSITE_EDGE = Object.freeze({ right: 'left', left: 'right', top: 'bottom', bottom: 'top' });

/** The unit vector from the centre toward the edge the incoming shot of `direction` enters by. */
export const entryVector = (direction) => EDGE_VECTOR[ENTRY_EDGE[direction]];

/** Whether a cut's direction list is these edge directions (slide, cover, wipe, cube), not in/out (iris, zoom). */
export const takesEdges = (directions) => Array.isArray(directions) && directions.length > 0 && directions.every((d) => ENTRY_EDGE[d] !== undefined);

/** What an edge direction means, in the words --list cuts and the validator use. */
export const DIRECTION_MEANING = 'the way the next shot moves on screen: "left" moves leftward and enters by the right edge, "up" moves upward and enters by the bottom edge';

// The clear windows a shader cut that shows both pictures at once takes (engine/page/post-cut.mjs, engine/cuts/shaders
// CLEAR_NONE): the outgoing picture fades to the incoming ground over the first half and the incoming one rises from it
// after the middle, so in the middle third only one set of words reads (look review gate-cuts-1; lead ruling 3). The
// two overlap a little, so the cut dips toward the ground for a frame or two instead of holding an empty one. Pure.

/** The uniforms of the clear windows, in progress 0..1: [start, end] of each smoothstep. */
export const MIXED_CLEAR = Object.freeze({ uClearFrom: Object.freeze([0.15, 0.5]), uClearTo: Object.freeze([0.4, 0.8]) });

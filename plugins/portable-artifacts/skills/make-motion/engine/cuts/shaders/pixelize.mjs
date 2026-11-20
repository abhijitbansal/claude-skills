// Author: gre
// License: MIT
// Description: Both images pixelate, crossfade, then sharpen again
// Tags: pixelate, blend
// forked from https://gist.github.com/benraziel/c528607361d90a072e98
// Ported for make-motion from gl-transitions/gl-transitions@e7c6ce2c9173ab57382279b58d056133caed5d1f, transitions/Pixelize.glsl; changes: GLSL ES 3.00 through the make-motion wrapper (engine/page/post-cut.mjs); uniform defaults lifted into params.
// The pixelize shader cut (engine/cuts/shaders/index.mjs). Pure and DOM-free.

const SOURCE = String.raw`
// @param Number of squares at the strongest pixelation
uniform ivec2 squaresMin; // = ivec2(20)
// @param Number of pixelation steps; 0 for a continuous effect
uniform int steps; // = 50

vec4 transition(vec2 uv) {
  float d = min(progress, 1.0 - progress);
  float dist = steps>0 ? ceil(d * float(steps)) / float(steps) : d;
  vec2 squareSize = 2.0 * dist / vec2(squaresMin);
  vec2 p = dist>0.0 ? (floor(uv / squareSize) + 0.5) * squareSize : uv;
  return mix(getFromColor(p), getToColor(p), progress);
}
`;

export const pixelize = Object.freeze({
  name: 'pixelize',
  source: SOURCE,
  params: Object.freeze({ squaresMin: [20, 20], steps: 50 }),
  standIn: 'crossfade',
  license: Object.freeze({ spdx: 'MIT', author: 'gre', origin: 'transitions/Pixelize.glsl', commit: 'e7c6ce2c9173ab57382279b58d056133caed5d1f' }),
  summary: 'Both shots break into squares, cross, and sharpen again, over 0.6 s (WebGL2; a crossfade without it).',
  example: 'pixelize',
});

// Author: gre
// License: MIT
// Description: A ragged left-to-right wipe, as if the image was blown away by the wind
// Tags: wipe, horizontal, noise
// Ported for make-motion from gl-transitions/gl-transitions@e7c6ce2c9173ab57382279b58d056133caed5d1f, transitions/Wind.glsl; changes: GLSL ES 3.00 through the make-motion wrapper (engine/page/post-cut.mjs); uniform defaults lifted into params; rand() built on sin() replaced by the integer hash mmHash seeded with the film seed.
// The wind shader cut (engine/cuts/shaders/index.mjs). Pure and DOM-free.

const SOURCE = String.raw`
// @range(0, 1) Width of the ragged edge
uniform float size; // = 0.2
// @param Wipe from right to left instead
uniform bool reversed; // = false

float rand (vec2 co) {
  return mmHash(co); // was a sin() hash: the wrapper's integer hash, seeded with the film seed
}

vec4 transition (vec2 uv) {
  float x = reversed ? 1. - uv.x : uv.x;
  float r = rand(vec2(0, uv.y));
  float m = smoothstep(0.0, -size, x*(1.0-size) + size*r - (progress * (1.0 + size)));
  return mix(
    getFromColor(uv),
    getToColor(uv),
    m
  );
}
`;

export const wind = Object.freeze({
  name: 'wind',
  source: SOURCE,
  params: Object.freeze({ size: 0.2, reversed: false }),
  standIn: 'wipe',
  license: Object.freeze({ spdx: 'MIT', author: 'gre', origin: 'transitions/Wind.glsl', commit: 'e7c6ce2c9173ab57382279b58d056133caed5d1f' }),
  summary: 'A ragged wipe from the left, as if the shot blew away, over 0.6 s (WebGL2; a wipe without it).',
  example: 'wind',
});

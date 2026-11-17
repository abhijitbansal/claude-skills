// Author: bobylito
// License: MIT
// Description: The incoming image appears through growing polka dots
// Tags: dots, pattern
// Ported for make-motion from gl-transitions/gl-transitions@e7c6ce2c9173ab57382279b58d056133caed5d1f, transitions/PolkaDotsCurtain.glsl; changes: GLSL ES 3.00 through the make-motion wrapper (engine/page/post-cut.mjs); uniform defaults lifted into params.
// The polka-dots shader cut (engine/cuts/shaders/index.mjs). Pure and DOM-free.

const SOURCE = String.raw`const float SQRT_2 = 1.414213562373;
// @param Number of dots across the image
uniform float dots; // = 20.0
uniform vec2 center; // = vec2(0, 0)

vec4 transition(vec2 uv) {
  bool nextImage = distance(fract(uv * dots), vec2(0.5, 0.5)) < ( progress / distance(uv, center));
  return nextImage ? getToColor(uv) : getFromColor(uv);
}
`;

export const polkaDots = Object.freeze({
  name: 'polka-dots',
  source: SOURCE,
  params: Object.freeze({ dots: 20, center: [0, 0] }),
  standIn: 'crossfade',
  license: Object.freeze({ spdx: 'MIT', author: 'bobylito', origin: 'transitions/PolkaDotsCurtain.glsl', commit: 'e7c6ce2c9173ab57382279b58d056133caed5d1f' }),
  summary: 'The next shot shows through polka dots that grow from a corner, over 0.6 s (WebGL2; a crossfade without it).',
  example: 'polka-dots',
});

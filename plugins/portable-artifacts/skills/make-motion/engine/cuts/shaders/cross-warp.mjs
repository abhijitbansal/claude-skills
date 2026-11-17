// Author: Eke Péter <peterekepeter@gmail.com>
// License: MIT
// Description: The outgoing image zooms in while the incoming one zooms out into place, sweeping from right to left
// Tags: warp, zoom, horizontal
// Ported for make-motion from gl-transitions/gl-transitions@e7c6ce2c9173ab57382279b58d056133caed5d1f, transitions/CrossWarp.glsl; changes: GLSL ES 3.00 through the make-motion wrapper (engine/page/post-cut.mjs); uniform defaults lifted into params.
// The cross-warp shader cut (engine/cuts/shaders/index.mjs). Pure and DOM-free.

const SOURCE = String.raw`vec4 transition(vec2 p) {
  float x = progress;
  x=smoothstep(.0,1.0,(x*2.0+p.x-1.0));
  return mix(getFromColor((p-.5)*(1.-x)+.5), getToColor((p-.5)*x+.5), x);
}
`;

export const crossWarp = Object.freeze({
  name: 'cross-warp',
  source: SOURCE,
  params: Object.freeze({}),
  standIn: 'crossfade',
  license: Object.freeze({ spdx: 'MIT', author: 'Eke Péter <peterekepeter@gmail.com>', origin: 'transitions/CrossWarp.glsl', commit: 'e7c6ce2c9173ab57382279b58d056133caed5d1f' }),
  summary: 'The shot zooms in while the next one zooms out into place, sweeping from right to left, over 0.6 s (WebGL2; a crossfade without it).',
  example: 'cross-warp',
});

// Author: Eke Péter <peterekepeter@gmail.com>
// License: MIT
// Description: The outgoing image zooms in while the incoming one zooms out into place, sweeping from right to left
// Tags: warp, zoom, horizontal
// Ported for make-motion from gl-transitions/gl-transitions@e7c6ce2c9173ab57382279b58d056133caed5d1f, transitions/CrossWarp.glsl; changes: GLSL ES 3.00 through the make-motion wrapper (engine/page/post-cut.mjs); uniform defaults lifted into params; each picture is zoomed by one scale per frame (at most 1 / (1 - zoomBy)) while the sweep x only mixes them, since a scale that changed across the frame stretched the incoming words into blobs (look review gate-cuts-1 D14).
// The cross-warp shader cut (engine/cuts/shaders/index.mjs). Pure and DOM-free.

const SOURCE = String.raw`
// @param How far each picture zooms: the outgoing in to 1 / (1 - zoomBy), the incoming out from it
uniform float zoomBy; // = 0.25

vec4 transition(vec2 p) {
  float x = progress;
  x=smoothstep(.0,1.0,(x*2.0+p.x-1.0));
  float zoom = smoothstep(0.0, 1.0, progress);
  vec2 outgoing = (p-.5)*(1.0 - zoomBy*zoom)+.5;
  vec2 incoming = (p-.5)*(1.0 - zoomBy*(1.0 - zoom))+.5;
  return mix(getFromColor(outgoing), getToColor(incoming), x);
}
`;

import { MIXED_CLEAR } from './clear.mjs';

export const crossWarp = Object.freeze({
  name: 'cross-warp',
  source: SOURCE,
  params: Object.freeze({ zoomBy: 0.25, ...MIXED_CLEAR }), // clear windows: no grey ghost glyphs (gate-cuts-1 D14)
  standIn: 'crossfade',
  license: Object.freeze({ spdx: 'MIT', author: 'Eke Péter <peterekepeter@gmail.com>', origin: 'transitions/CrossWarp.glsl', commit: 'e7c6ce2c9173ab57382279b58d056133caed5d1f' }),
  summary: 'The shot zooms in while the next one zooms out into place, sweeping from right to left, over 0.6 s (WebGL2; a crossfade without it).',
  example: 'cross-warp',
});

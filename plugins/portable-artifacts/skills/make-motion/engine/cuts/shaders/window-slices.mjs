// Author: gre
// License: MIT
// Description: The incoming image appears through vertical slices that widen
// Tags: slices, stripes, wipe
// Ported for make-motion from gl-transitions/gl-transitions@e7c6ce2c9173ab57382279b58d056133caed5d1f, transitions/WindowSlices.glsl; changes: GLSL ES 3.00 through the make-motion wrapper (engine/page/post-cut.mjs); uniform defaults lifted into params.
// The window-slices shader cut (engine/cuts/shaders/index.mjs). Pure and DOM-free.

const SOURCE = String.raw`
// @param Number of slices
uniform float count; // = 10.0
// @param Softness of the slices' edges
uniform float smoothness; // = 0.5

vec4 transition (vec2 p) {
  float pr = smoothstep(-smoothness, 0.0, p.x - progress * (1.0 + smoothness));
  float s = step(pr, fract(count * p.x));
  return mix(getFromColor(p), getToColor(p), s);
}
`;

import { MIXED_CLEAR } from './clear.mjs';

export const windowSlices = Object.freeze({
  name: 'window-slices',
  source: SOURCE,
  params: Object.freeze({ count: 10, smoothness: 0.5, ...MIXED_CLEAR }), // clear windows: no A|ftast interleave (gate-cuts-1 D12)
  standIn: 'wipe',
  license: Object.freeze({ spdx: 'MIT', author: 'gre', origin: 'transitions/WindowSlices.glsl', commit: 'e7c6ce2c9173ab57382279b58d056133caed5d1f' }),
  summary: 'The next shot shows through vertical slices that widen from the left, over 0.6 s (WebGL2; a wipe without it).',
  example: 'window-slices',
});

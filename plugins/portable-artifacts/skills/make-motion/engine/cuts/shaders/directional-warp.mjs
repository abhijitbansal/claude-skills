// Author: pschroen
// License: MIT
// Description: A diagonal wipe with a warped, smeared edge
// Tags: wipe, warp, directional
// Ported for make-motion from gl-transitions/gl-transitions@e7c6ce2c9173ab57382279b58d056133caed5d1f, transitions/DirectionalWarp.glsl; changes: GLSL ES 3.00 through the make-motion wrapper (engine/page/post-cut.mjs); uniform defaults lifted into params.
// The directional-warp shader cut (engine/cuts/shaders/index.mjs). Pure and DOM-free.

const SOURCE = String.raw`
// @param Softness of the edge
uniform float smoothness; // = 0.1
// @param Direction of the wipe
uniform vec2 direction; // = vec2(-1.0, 1.0)

const vec2 center = vec2(0.5, 0.5);

vec4 transition (vec2 uv) {
  vec2 v = normalize(direction);
  v /= abs(v.x) + abs(v.y);
  float d = v.x * center.x + v.y * center.y;
  float m = 1.0 - smoothstep(-smoothness, 0.0, v.x * uv.x + v.y * uv.y - (d - 0.5 + progress * (1.0 + smoothness)));
  return mix(getFromColor((uv - 0.5) * (1.0 - m) + 0.5), getToColor((uv - 0.5) * m + 0.5), m);
}
`;

export const directionalWarp = Object.freeze({
  name: 'directional-warp',
  source: SOURCE,
  params: Object.freeze({ smoothness: 0.1, direction: [-1, 1] }),
  standIn: 'wipe',
  license: Object.freeze({ spdx: 'MIT', author: 'pschroen', origin: 'transitions/DirectionalWarp.glsl', commit: 'e7c6ce2c9173ab57382279b58d056133caed5d1f' }),
  summary: 'A diagonal wipe whose edge warps and smears, over 0.6 s (WebGL2; a wipe without it).',
  example: 'directional-warp',
});

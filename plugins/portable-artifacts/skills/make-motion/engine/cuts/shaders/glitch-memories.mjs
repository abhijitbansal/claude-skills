// Author: Gunnar Roth
// based on work from natewave
// License: MIT
// Description: A crossfade with glitchy, color-shifted blocks
// Tags: glitch, chromatic, blend
// Ported for make-motion from gl-transitions/gl-transitions@e7c6ce2c9173ab57382279b58d056133caed5d1f, transitions/GlitchMemories.glsl; changes: GLSL ES 3.00 through the make-motion wrapper (engine/page/post-cut.mjs); uniform defaults lifted into params; a guard on sampler reads outside 0..1 (the shifted reads are mirrored back in, so the edge rows are not repeated as streaks).
// The glitch-memories shader cut (engine/cuts/shaders/index.mjs). Pure and DOM-free.

const SOURCE = String.raw`// make-motion guard: a read shifted past an edge is mirrored back inside 0..1 (the shift is at most 0.075)
vec2 mmMirror(vec2 uv) {
  return 1.0 - abs(1.0 - abs(uv));
}

vec4 transition(vec2 p) {
  vec2 block = floor(p.xy / vec2(16));
  vec2 uv_noise = block / vec2(64);
  uv_noise += floor(vec2(progress) * vec2(1200.0, 3500.0)) / vec2(64);
  vec2 dist = (fract(uv_noise) - 0.5) * 0.3 * (1.0 - progress) * smoothstep(0.0, 0.05, progress);
  vec2 red = mmMirror(p + dist * 0.2);
  vec2 green = mmMirror(p + dist * .3);
  vec2 blue = mmMirror(p + dist * .5);

  vec4 center = mix(getFromColor(green), getToColor(green), progress);
  return vec4(mix(getFromColor(red), getToColor(red), progress).r, center.g, mix(getFromColor(blue), getToColor(blue), progress).b, center.a);
}

`;

import { MIXED_CLEAR } from './clear.mjs';

export const glitchMemories = Object.freeze({
  name: 'glitch-memories',
  source: SOURCE,
  params: Object.freeze({ ...MIXED_CLEAR }), // clear windows: the outgoing words are gone by the middle (gate-cuts-1 P9)
  standIn: 'crossfade',
  license: Object.freeze({ spdx: 'MIT', author: 'Gunnar Roth', origin: 'transitions/GlitchMemories.glsl', commit: 'e7c6ce2c9173ab57382279b58d056133caed5d1f' }),
  summary: 'A crossfade with glitchy, colour-shifted blocks, over 0.6 s (WebGL2; a crossfade without it).',
  example: 'glitch-memories',
});

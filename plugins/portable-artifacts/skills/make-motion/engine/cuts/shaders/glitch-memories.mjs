// Author: Gunnar Roth
// based on work from natewave
// License: MIT
// Description: A crossfade with glitchy, color-shifted blocks
// Tags: glitch, chromatic, blend
// Ported for make-motion from gl-transitions/gl-transitions@e7c6ce2c9173ab57382279b58d056133caed5d1f, transitions/GlitchMemories.glsl; changes: GLSL ES 3.00 through the make-motion wrapper (engine/page/post-cut.mjs); uniform defaults lifted into params.
// The glitch-memories shader cut (engine/cuts/shaders/index.mjs). Pure and DOM-free.

const SOURCE = String.raw`vec4 transition(vec2 p) {
  vec2 block = floor(p.xy / vec2(16));
  vec2 uv_noise = block / vec2(64);
  uv_noise += floor(vec2(progress) * vec2(1200.0, 3500.0)) / vec2(64);
  vec2 dist = (fract(uv_noise) - 0.5) * 0.3 * (1.0 - progress) * smoothstep(0.0, 0.05, progress);
  vec2 red = p + dist * 0.2;
  vec2 green = p + dist * .3;
  vec2 blue = p + dist * .5;

  vec4 center = mix(getFromColor(green), getToColor(green), progress);
  return vec4(mix(getFromColor(red), getToColor(red), progress).r, center.g, mix(getFromColor(blue), getToColor(blue), progress).b, center.a);
}

`;

export const glitchMemories = Object.freeze({
  name: 'glitch-memories',
  source: SOURCE,
  params: Object.freeze({}),
  standIn: 'crossfade',
  license: Object.freeze({ spdx: 'MIT', author: 'Gunnar Roth', origin: 'transitions/GlitchMemories.glsl', commit: 'e7c6ce2c9173ab57382279b58d056133caed5d1f' }),
  summary: 'A crossfade with glitchy, colour-shifted blocks, over 0.6 s (WebGL2; a crossfade without it).',
  example: 'glitch-memories',
});

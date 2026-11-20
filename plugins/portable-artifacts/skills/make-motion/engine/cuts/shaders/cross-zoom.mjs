// License: MIT
// Author: rectalogic
// Description: A crossfade through a strong zoom blur
// Tags: zoom, blur, blend
// ported by gre from https://gist.github.com/rectalogic/b86b90161503a0023231
// Ported for make-motion from gl-transitions/gl-transitions@e7c6ce2c9173ab57382279b58d056133caed5d1f, transitions/CrossZoom.glsl; changes: GLSL ES 3.00 through the make-motion wrapper (engine/page/post-cut.mjs); uniform defaults lifted into params; rand() built on sin() replaced by the integer hash mmHash seeded with the film seed.
// The cross-zoom shader cut (engine/cuts/shaders/index.mjs). Pure and DOM-free.

const SOURCE = String.raw`
// Converted from https://github.com/rectalogic/rendermix-basic-effects/blob/master/assets/com/rendermix/CrossZoom/CrossZoom.frag
// Which is based on https://github.com/evanw/glfx.js/blob/master/src/filters/blur/zoomblur.js
// With additional easing functions from https://github.com/rectalogic/rendermix-basic-effects/blob/master/assets/com/rendermix/Easing/Easing.glsllib

// @range(0, 1) Blur strength
uniform float strength; // = 0.4

const float PI = 3.141592653589793;

float Linear_ease(in float begin, in float change, in float duration, in float time) {
    return change * time / duration + begin;
}

float Exponential_easeInOut(in float begin, in float change, in float duration, in float time) {
    if (time == 0.0)
        return begin;
    else if (time == duration)
        return begin + change;
    time = time / (duration / 2.0);
    if (time < 1.0)
        return change / 2.0 * pow(2.0, 10.0 * (time - 1.0)) + begin;
    return change / 2.0 * (-pow(2.0, -10.0 * (time - 1.0)) + 2.0) + begin;
}

float Sinusoidal_easeInOut(in float begin, in float change, in float duration, in float time) {
    return -change / 2.0 * (cos(PI * time / duration) - 1.0) + begin;
}

float rand (vec2 co) {
  return mmHash(co); // was a sin() hash: the wrapper's integer hash, seeded with the film seed
}

vec4 crossFade(in vec2 uv, in float dissolve) {
    return mix(getFromColor(uv), getToColor(uv), dissolve);
}

vec4 transition(vec2 uv) {
    vec2 texCoord = uv.xy / vec2(1.0).xy;

    vec2 center = vec2(Linear_ease(0.25, 0.5, 1.0, progress), 0.5);
    float dissolve = Exponential_easeInOut(0.0, 1.0, 1.0, progress);

    // Mirrored sinusoidal loop. 0->strength then strength->0
    float strength = Sinusoidal_easeInOut(0.0, strength, 0.5, progress);

    vec4 color = vec4(0.0);
    float total = 0.0;
    vec2 toCenter = center - texCoord;

    /* randomize the lookup values to hide the fixed number of samples */
    float offset = rand(uv);

    for (float t = 0.0; t <= 40.0; t++) {
        float percent = (t + offset) / 40.0;
        float weight = 4.0 * (percent - percent * percent);
        color += crossFade(texCoord + toCenter * percent * strength, dissolve) * weight;
        total += weight;
    }
    return color / total;
}
`;

export const crossZoom = Object.freeze({
  name: 'cross-zoom',
  source: SOURCE,
  params: Object.freeze({ strength: 0.4 }),
  standIn: 'crossfade',
  license: Object.freeze({ spdx: 'MIT', author: 'rectalogic', origin: 'transitions/CrossZoom.glsl', commit: 'e7c6ce2c9173ab57382279b58d056133caed5d1f' }),
  summary: 'A crossfade through a strong zoom blur, over 0.6 s (WebGL2; a crossfade without it).',
  example: 'cross-zoom',
});

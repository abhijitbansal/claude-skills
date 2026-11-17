// The `ripple` shader cut. Written in this repository for make-motion version 1 (template/gl-transitions.mjs,
// `gl-ripple`) and moved here onto the gl-transitions contract (engine/cuts/shaders/index.mjs): both shots ripple out
// from the centre and cross over; the wave dies away at both ends of the window, so progress 0 is the outgoing shot and
// progress 1 the incoming one. Same constants and maths as version 1; only the names changed (uP is progress, the
// aspect is ratio). Pure and DOM-free.
import { MIXED_CLEAR } from './clear.mjs';

// How far a wave pushes a pixel (canvas heights), radians of wave per canvas height from the centre, radians the wave
// travels outwards over the whole window, and how much a crest brightens and a trough darkens: version 1's values.
// Calmer than version 1 (look review gate-cuts-1 P7: moire bands, bow-tie pinches, a dark ring, a lens blob at the
// centre; round 2 ruling 3): about a quarter of its amplitude and shine, rings further apart, and the push fading in
// over the first centreCalm of the distance from the centre, where every direction meets; and the clear windows, so the
// two pictures' words never pile up.
const PARAMS = Object.freeze({ amplitude: 0.008, frequency: 12, speed: 14, shine: 0.012, centreCalm: 0.15, ...MIXED_CLEAR });

const SOURCE = `uniform float amplitude; // = 0.03
uniform float frequency; // = 28.0
uniform float speed; // = 14.0
uniform float shine; // = 0.06
uniform float centreCalm; // = 0.15

vec4 transition(vec2 uv) {
  vec2 d = (uv - 0.5) * vec2(ratio, 1.0);
  float dist = length(d);
  vec2 dir = dist > 0.00001 ? d / dist : vec2(0.0);
  float envelope = sin(3.14159265 * progress);
  float wave = sin(dist * frequency - progress * speed);
  vec2 off = dir * wave * amplitude * envelope * smoothstep(0.0, centreCalm, dist) * vec2(1.0 / ratio, 1.0);
  vec2 st = clamp(uv + off, vec2(0.0), vec2(1.0));
  vec3 from = getFromColor(st).rgb;
  vec3 to = getToColor(st).rgb;
  vec3 colour = mix(from, to, smoothstep(0.2, 0.8, progress)) + wave * envelope * shine;
  return vec4(clamp(colour, 0.0, 1.0), 1.0);
}
`;

export const ripple = Object.freeze({
  name: 'ripple',
  source: SOURCE,
  params: PARAMS,
  standIn: 'crossfade',
  license: null,
  summary: 'Both shots ripple out from the centre and cross over, over 0.6 s (WebGL2; a crossfade without it).',
  example: 'ripple',
});

// WebGL scene transitions, browser-safe and pure: the names, the shader sources, the uniform maths and the validator hooks.
// `gl-ripple` and `gl-cube` are written for this file (no shader code is ported). A render draws the outgoing and the
// incoming scene layer to two images and a software-GL page (scripts/lib/gl-composite.mjs) runs the fragment shader over
// them; the live preview and check.mjs have no such compositor and stand in a CSS transition (glFallback) instead.
// Everything here is a function of the transition, its progress p and the canvas size, so a frame depends on nothing else.

export const GL_TRANSITIONS = Object.freeze(['gl-ripple', 'gl-cube']);

const EDGES = Object.freeze(['left', 'right', 'up', 'down']);
const DIRECTIONS = new Map([['gl-cube', EDGES]]); // gl-ripple spreads from the centre and takes none
// What the preview and check.mjs draw in place of the shader: the cube turns in from the same edge a push slides in from;
// the ripple is a crossfade. template/transitions.mjs turns this into layer styles.
const FALLBACK = new Map([['gl-ripple', 'crossfade'], ['gl-cube', 'push']]);

export const isGlTransition = (type) => GL_TRANSITIONS.includes(type);

/** The directions `type` accepts, in order (the first is the default), or null when it takes none. */
export const glDirections = (type) => DIRECTIONS.get(type) ?? null;

/** The CSS transition the preview and check.mjs show for `type`: "push" or "crossfade"; null for a type that is not GL. */
export const glFallback = (type) => FALLBACK.get(type) ?? null;

/** True when any scene after the first comes in through a GL transition (the first scene has nothing to come in over). */
export const usesGl = (spec) => (spec.scenes ?? []).some((scene, si) => si > 0 && isGlTransition(typeof scene.transition === 'string' ? scene.transition : scene.transition?.type));

// ---- ripple ------------------------------------------------------------------------------------------------------
const RIPPLE_AMPLITUDE = 0.03; // how far a wave pushes a pixel, in canvas heights
const RIPPLE_FREQUENCY = 28; // radians of wave per canvas height from the centre
const RIPPLE_SPEED = 14; // radians the wave travels outwards over the whole window
const RIPPLE_SHINE = 0.06; // how much a crest brightens and a trough darkens

// ---- cube --------------------------------------------------------------------------------------------------------
const CUBE_FOCAL = 2.4; // camera distance from the screen plane, in half widths (half heights when it turns about the other axis)
const CUBE_PULL = 0.5; // how far the cube backs away from the screen at the middle of the turn, in the same unit
const CUBE_SHADE = 0.45; // how much darker a face is as it turns away

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * The uniforms of `type` at progress `p` (0 to 1) for a canvas of `size` [w, h]: { name: number | [x, y] }. The canvas size
 * itself (uRes) is the compositor's. `direction` is the normalised one (null for a type that takes none).
 */
export function glUniforms({ type, direction, p }, size) {
  const progress = clamp01(p);
  const [width, height] = size;
  if (type === 'gl-ripple') {
    return { uP: progress, uAmp: RIPPLE_AMPLITUDE, uFreq: RIPPLE_FREQUENCY, uSpeed: RIPPLE_SPEED, uShine: RIPPLE_SHINE };
  }
  if (type === 'gl-cube') {
    const turn = (Math.PI / 2) * progress;
    const vertical = direction === 'up' || direction === 'down';
    return {
      uSin: Math.sin(turn),
      uCos: Math.cos(turn),
      uPull: CUBE_PULL * Math.sin(2 * turn),
      uFocal: CUBE_FOCAL,
      uSwap: vertical ? 1 : 0, // 1: the cube turns about the horizontal axis
      uFlip: direction === 'right' || direction === 'down' ? 1 : 0, // 1: the incoming face comes from the right or the bottom
      uRatio: vertical ? width / height : height / width, // the face's extent across the turn, in units of its extent along it
      uShadeFrom: 1 - CUBE_SHADE * Math.sin(turn),
      uShadeTo: 1 - CUBE_SHADE * Math.cos(turn),
    };
  }
  throw new Error(`glUniforms: ${JSON.stringify(type)} is not a GL transition (${GL_TRANSITIONS.join(', ')})`);
}

// ---- shaders (WebGL 1, GLSL ES 1.00) -----------------------------------------------------------------------------
export const GL_VERTEX = 'attribute vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }';

// The pixel's place in the image, top-left origin, at the pixel centre: where a texel of the same size sits exactly.
const COMMON = `precision highp float;
uniform sampler2D uFrom;
uniform sampler2D uTo;
uniform vec2 uRes;
vec2 pixelUv() { return vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uRes; }
`;

// Both scenes ripple outwards from the centre and cross over; the wave dies away at both ends of the window, so progress 0
// is the outgoing scene and progress 1 the incoming one, untouched.
const RIPPLE = `${COMMON}uniform float uP;
uniform float uAmp;
uniform float uFreq;
uniform float uSpeed;
uniform float uShine;
void main() {
  vec2 uv = pixelUv();
  float aspect = uRes.x / uRes.y;
  vec2 d = (uv - 0.5) * vec2(aspect, 1.0);
  float dist = length(d);
  vec2 dir = dist > 0.00001 ? d / dist : vec2(0.0);
  float envelope = sin(3.14159265 * uP);
  float wave = sin(dist * uFreq - uP * uSpeed);
  vec2 off = dir * wave * uAmp * envelope * vec2(1.0 / aspect, 1.0);
  vec2 edge = 0.5 / uRes;
  vec2 st = clamp(uv + off, edge, 1.0 - edge);
  vec3 from = texture2D(uFrom, st).rgb;
  vec3 to = texture2D(uTo, st).rgb;
  vec3 colour = mix(from, to, smoothstep(0.2, 0.8, uP)) + wave * envelope * uShine;
  gl_FragColor = vec4(clamp(colour, 0.0, 1.0), 1.0);
}`;

// A box turning about its centre, seen in perspective: the outgoing scene is its front face and the incoming one the face
// that swings round to replace it. Coordinates: s runs along the turn (the incoming face is at negative s), c across it,
// z toward the camera. The front face is at z = 1 when the turn is 0, so the picture is the outgoing scene exactly.
const CUBE = `${COMMON}uniform float uSin;
uniform float uCos;
uniform float uPull;
uniform float uFocal;
uniform float uSwap;
uniform float uFlip;
uniform float uRatio;
uniform float uShadeFrom;
uniform float uShadeTo;
// A point of a face (hit.x along the turn from -1 to 1, hit.y across it from -uRatio to uRatio) as a place in the image.
vec2 faceUv(vec2 hit) {
  float primary = (hit.x * (uFlip > 0.5 ? -1.0 : 1.0) + 1.0) * 0.5;
  float cross = hit.y / uRatio;
  return uSwap > 0.5 ? vec2((cross + 1.0) * 0.5, primary) : vec2(primary, (1.0 - cross) * 0.5);
}
void main() {
  vec2 n = pixelUv() * 2.0 - 1.0;
  float s = (uSwap > 0.5 ? n.y : n.x) * (uFlip > 0.5 ? -1.0 : 1.0);
  float c = uSwap > 0.5 ? n.x * uRatio : -n.y * uRatio;
  float depth = uFocal + 1.0 + uPull;
  vec3 origin = vec3(-uSin * depth, 0.0, uCos * depth);
  vec3 dir = vec3(uCos * s + uSin * uFocal, c, uSin * s - uCos * uFocal);
  float best = 1.0e9;
  vec3 colour = vec3(0.0);
  if (dir.z < 0.0) {
    float t = (1.0 - origin.z) / dir.z;
    vec2 hit = vec2(origin.x + t * dir.x, t * dir.y);
    if (t > 0.0 && abs(hit.x) <= 1.0 && abs(hit.y) <= uRatio) {
      best = t;
      colour = texture2D(uFrom, faceUv(hit)).rgb * uShadeFrom;
    }
  }
  if (dir.x > 0.0) {
    float t = (-1.0 - origin.x) / dir.x;
    vec2 hit = vec2(origin.z + t * dir.z, t * dir.y);
    if (t > 0.0 && t < best && abs(hit.x) <= 1.0 && abs(hit.y) <= uRatio) {
      colour = texture2D(uTo, faceUv(hit)).rgb * uShadeTo;
    }
  }
  gl_FragColor = vec4(colour, 1.0);
}`;

const FRAGMENTS = new Map([['gl-ripple', RIPPLE], ['gl-cube', CUBE]]);

/** The fragment shader source of a GL transition. */
export function glFragment(type) {
  const source = FRAGMENTS.get(type);
  if (!source) throw new Error(`glFragment: ${JSON.stringify(type)} is not a GL transition (${GL_TRANSITIONS.join(', ')})`);
  return source;
}

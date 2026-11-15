// The post pass: the finished 2D frame is shown through one WebGL2 fragment shader that adds bloom (8 taps above 0.7
// luminance), a halftone overlay and film grain. The grain is a hash of the pixel, the film seed and
// floor(t * GRAIN_FPS), so it changes 12 times a second and a held frame between two changes is identical, and the same
// frame is the same pixels every time (an integer hash, no sin(), so no GPU rounding enters it).
//
// Without WebGL2 the frame is copied with the same grain, added the same way from the same hash (grainNoise is the
// shader's hash in integer arithmetic, so the two paths agree to a level), but no bloom and no halftone: `dropped`
// names the ones the look asked for. A shader that will not compile or link falls back to that path on a fresh canvas
// (the old one has taken a WebGL context and cannot give a 2D one) and says why in `unavailable`.
//
// createPost(canvas, { grain, halftone, bloom, seed }) -> { kind: 'webgl2' | '2d', canvas, render(sourceCanvas, t),
//   setStrengths, unavailable?: { reason, failed }, dropped }. render throws when the WebGL context is lost or a GL call
//   failed, so a blank frame is never encoded as if it were good.
export const GRAIN_FPS = 12;
const REFERENCE_SIDE = 1080;
const GRAIN_GAIN = 2; // the grain swings +-strength around the picture: 0.05 is about +-13/255
const BYTE = 255;
const UINT_MAX = 4294967295;
const PCG_MULTIPLY = 747796405;
const PCG_ADD = 2891336365;
const PCG_WORD = 277803737;
const EFFECTS_NEEDING_WEBGL = Object.freeze(['halftone', 'bloom']);

/** Which grain pattern shows at time t: it changes GRAIN_FPS times a second. For t = frame / fps this equals
 *  floor(frame * 12 / fps) at every frame of every fps a film can have (test/v2/post-browser.test.mjs checks it). */
export const grainPhase = (t) => Math.floor(t * GRAIN_FPS);

// The shader's PCG hash in 32-bit integer arithmetic.
function pcg(v) {
  const state = (Math.imul(v, PCG_MULTIPLY) + PCG_ADD) >>> 0;
  const word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, PCG_WORD) >>> 0;
  return ((word >>> 22) ^ word) >>> 0;
}

/** The grain value in 0..1 at pixel (x, y), y from the top: the shader's noise(), for the 2D path and the tests. */
export function grainNoise(x, y, phase, seed) {
  const hashed = pcg((y ^ pcg((phase ^ pcg(seed >>> 0)) >>> 0)) >>> 0);
  return pcg((x ^ hashed) >>> 0) / UINT_MAX;
}

class ShaderError extends Error {}

const VERTEX = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uFrame;
uniform ivec2 uSize;
uniform float uUnit, uGrain, uHalftone, uBloom;
uniform uint uSeed, uPhase;
out vec4 outColor;

uint pcg(uint v) {
  uint state = v * 747796405u + 2891336365u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
float noise(uvec2 p) {
  uint h = pcg(p.x ^ pcg(p.y ^ pcg(uPhase ^ pcg(uSeed))));
  return float(h) / 4294967295.0;
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 fetch(ivec2 p) { return texelFetch(uFrame, clamp(p, ivec2(0), uSize - 1), 0).rgb; }

vec3 bloomOf(ivec2 p) {
  float radius = 10.0 * uUnit;
  vec3 sum = vec3(0.0);
  for (int k = 0; k < 8; k++) {
    float a = 0.7853981634 * float(k);
    vec3 c = fetch(p + ivec2(round(vec2(cos(a), sin(a)) * radius)));
    sum += c * smoothstep(0.7, 1.0, luma(c));
  }
  return sum / 8.0;
}

float halftoneDot(vec2 at, float lum) {
  float cell = max(2.0, 6.0 * uUnit);
  float s = 0.7071067812;
  vec2 q = vec2(at.x * s - at.y * s, at.x * s + at.y * s) / cell;
  float radius = 0.5 * sqrt(1.0 - lum);
  return 1.0 - smoothstep(radius - 0.08, radius + 0.08, length(fract(q) - 0.5));
}

void main() {
  ivec2 p = ivec2(int(gl_FragCoord.x), uSize.y - 1 - int(gl_FragCoord.y));
  vec3 c = fetch(p);
  if (uBloom > 0.0) c += uBloom * bloomOf(p);
  if (uHalftone > 0.0) c *= 1.0 - uHalftone * halftoneDot(vec2(p), luma(c));
  if (uGrain > 0.0) c += (noise(uvec2(p)) - 0.5) * ${GRAIN_GAIN.toFixed(1)} * uGrain;
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new ShaderError(`the ${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'} shader did not compile: ${gl.getShaderInfoLog(shader)}`);
  }
  return shader;
}

function link(gl) {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new ShaderError(`the shader did not link: ${gl.getProgramInfoLog(program)}`);
  return program;
}

// A blank or half-drawn frame must never be encoded: say so the moment the context is gone or a call failed.
function checkGl(gl) {
  if (gl.isContextLost()) throw new Error('post pass: the WebGL context was lost');
  const error = gl.getError();
  if (error !== gl.NO_ERROR) throw new Error(`post pass: WebGL error 0x${error.toString(16)} while drawing the frame`);
}

function glPost(gl, canvas, initial, seed) {
  const program = link(gl);
  gl.useProgram(program);
  const at = (name) => gl.getUniformLocation(program, name);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  for (const [name, value] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) {
    gl.texParameteri(gl.TEXTURE_2D, name, value);
  }
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.uniform1i(at('uFrame'), 0);
  gl.uniform2i(at('uSize'), canvas.width, canvas.height);
  gl.uniform1f(at('uUnit'), Math.min(canvas.width, canvas.height) / REFERENCE_SIDE);
  gl.uniform1ui(at('uSeed'), seed >>> 0);
  let strengths = initial;
  return {
    kind: 'webgl2',
    canvas,
    dropped: [],
    setStrengths(next) { strengths = { ...strengths, ...next }; },
    render(source, t) {
      if (gl.isContextLost()) throw new Error('post pass: the WebGL context was lost');
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.uniform1f(at('uGrain'), strengths.grain);
      gl.uniform1f(at('uHalftone'), strengths.halftone);
      gl.uniform1f(at('uBloom'), strengths.bloom);
      gl.uniform1ui(at('uPhase'), grainPhase(t) >>> 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      checkGl(gl);
    },
  };
}

// Adds the shader's grain to RGBA pixel data in place: +-strength around each channel, rounded to a level.
function addGrain(data, { width, height, strength, phase, seed }) {
  const swing = GRAIN_GAIN * strength * BYTE;
  const inner = pcg((phase ^ pcg(seed >>> 0)) >>> 0);
  for (let y = 0; y < height; y++) {
    const row = pcg((y ^ inner) >>> 0);
    for (let x = 0; x < width; x++) {
      const delta = (pcg((x ^ row) >>> 0) / UINT_MAX - 0.5) * swing;
      const i = (y * width + x) * 4;
      for (let k = 0; k < 3; k++) data[i + k] = Math.min(BYTE, Math.max(0, Math.round(data[i + k] + delta)));
    }
  }
}

function twoDPost(canvas, initial, seed, unavailable) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let strengths = initial;
  return {
    kind: '2d',
    canvas,
    unavailable,
    dropped: EFFECTS_NEEDING_WEBGL.filter((name) => initial[name] > 0),
    setStrengths(next) { strengths = { ...strengths, ...next }; },
    render(source, t) {
      ctx.drawImage(source, 0, 0);
      if (strengths.grain <= 0) return;
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      addGrain(image.data, { width: canvas.width, height: canvas.height, strength: strengths.grain, phase: grainPhase(t), seed });
      ctx.putImageData(image, 0, 0);
    },
  };
}

// A canvas that has taken a WebGL context cannot give a 2D one: put a fresh one in its place.
function freshCanvas(old) {
  const fresh = document.createElement('canvas');
  fresh.id = old.id;
  fresh.width = old.width;
  fresh.height = old.height;
  old.replaceWith(fresh);
  return fresh;
}

/**
 * @param {HTMLCanvasElement} canvas the visible canvas, width and height already set; it takes the first context here
 * @param {{ grain: number, halftone: number, bloom: number, seed: number }} options strengths 0 to 1 and the film seed
 */
export function createPost(canvas, { grain, halftone, bloom, seed }) {
  const strengths = { grain, halftone, bloom };
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false, alpha: false, depth: false, stencil: false });
  if (!gl) return twoDPost(canvas, strengths, seed, { reason: 'this browser has no WebGL2', failed: false });
  try {
    return glPost(gl, canvas, strengths, seed);
  } catch (err) {
    if (!(err instanceof ShaderError)) throw err;
    return twoDPost(freshCanvas(canvas), strengths, seed, { reason: err.message, failed: true });
  }
}

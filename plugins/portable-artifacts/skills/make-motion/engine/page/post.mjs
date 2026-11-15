// The post pass: the finished 2D frame is shown through one WebGL2 fragment shader that adds bloom (8 taps above 0.7
// luminance), a halftone overlay and film grain. The grain is a hash of the pixel, the film seed and
// floor(t * GRAIN_FPS), so it changes 12 times a second and a held frame between two changes is identical, and the same
// frame is the same pixels every time (an integer hash, no sin(), so no GPU rounding enters it). Without WebGL2 the
// frame is copied with a cached noise tile at the grain's strength instead (grain only: no bloom or halftone).
// createPost(canvas, { grain, halftone, bloom, seed }) -> { kind: 'webgl2' | '2d', render(sourceCanvas, t), setStrengths }.
import { mulberry32 } from '../seeded.mjs';

export const GRAIN_FPS = 12;
const REFERENCE_SIDE = 1080;
const NOISE_TILE = 256;
const GRAIN_GAIN = 2; // the grain swings +-strength * GRAIN_GAIN / 2 around the picture: 0.05 is about +-13/255
const HASH_MULTIPLIER = 2654435761;

/** Which grain pattern shows at time t: it changes GRAIN_FPS times a second. For t = frame / fps this equals
 *  floor(frame * 12 / fps) at every frame of every fps a film can have (test/v2/post-browser.test.mjs checks it). */
export const grainPhase = (t) => Math.floor(t * GRAIN_FPS);

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
    throw new Error(`post pass: the ${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'} shader did not compile: ${gl.getShaderInfoLog(shader)}`);
  }
  return shader;
}

function link(gl) {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`post pass: the shader did not link: ${gl.getProgramInfoLog(program)}`);
  return program;
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
    setStrengths(next) { strengths = { ...strengths, ...next }; },
    render(source, t) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.uniform1f(at('uGrain'), strengths.grain);
      gl.uniform1f(at('uHalftone'), strengths.halftone);
      gl.uniform1f(at('uBloom'), strengths.bloom);
      gl.uniform1ui(at('uPhase'), grainPhase(t) >>> 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}

// Mid-grey noise from the film seed, drawn in 'overlay' so its mean leaves the picture's tones where they were.
function noiseTile(seed) {
  const tile = new OffscreenCanvas(NOISE_TILE, NOISE_TILE);
  const ctx = tile.getContext('2d');
  const image = ctx.createImageData(NOISE_TILE, NOISE_TILE);
  const random = mulberry32(seed);
  for (let i = 0; i < image.data.length; i += 4) {
    const v = Math.floor(random() * 256);
    image.data.set([v, v, v, 255], i);
  }
  ctx.putImageData(image, 0, 0);
  return tile;
}

function twoDPost(canvas, initial, seed) {
  const ctx = canvas.getContext('2d');
  const tile = noiseTile(seed);
  let strengths = initial;
  return {
    kind: '2d',
    setStrengths(next) { strengths = { ...strengths, ...next }; },
    render(source, t) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.drawImage(source, 0, 0);
      if (strengths.grain <= 0) return;
      const random = mulberry32((seed ^ Math.imul(grainPhase(t), HASH_MULTIPLIER)) >>> 0);
      const [ox, oy] = [Math.floor(random() * NOISE_TILE), Math.floor(random() * NOISE_TILE)];
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = Math.min(1, strengths.grain * GRAIN_GAIN);
      for (let y = -oy; y < canvas.height; y += NOISE_TILE) {
        for (let x = -ox; x < canvas.width; x += NOISE_TILE) ctx.drawImage(tile, x, y);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    },
  };
}

/**
 * @param {HTMLCanvasElement} canvas the visible canvas, width and height already set; it takes the first context here
 * @param {{ grain: number, halftone: number, bloom: number, seed: number }} options strengths 0 to 1 and the film seed
 */
export function createPost(canvas, { grain, halftone, bloom, seed }) {
  const strengths = { grain, halftone, bloom };
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false, alpha: false, depth: false, stencil: false });
  return gl ? glPost(gl, canvas, strengths, seed) : twoDPost(canvas, strengths, seed);
}

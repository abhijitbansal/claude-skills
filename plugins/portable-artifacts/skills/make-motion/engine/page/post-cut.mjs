// The shader pass of the shader cuts (engine/cuts/shaders): inside a shader cut's window the post pass first runs the
// cut's fragment shader over the two pictures (the outgoing shot frozen at its end, the incoming one live) into a texture
// of its own, then its bloom, halftone and grain over that texture, so the grain is one pattern over the whole frame.
//
// The wrapper is ours (GLSL ES 3.00). It gives a body on the gl-transitions contract its samplers, getFromColor(uv) and
// getToColor(uv) with uv from the bottom-left corner (our pictures are uploaded top row first, so it flips them), the
// uniforms progress, ratio and uRes, an integer hash mmHash(co) seeded with the film seed for a body whose author used a
// sin() hash (GPU rounding would make that differ between machines), and it writes alpha 1. A texel read outside the
// picture is clamped to its edge (CLAMP_TO_EDGE).
//
// createCutPass(gl, { names, seed, width, height }) compiles every named shader cut at once and throws CutShaderError
// for the first that will not compile or link: then the film draws every shader cut's stand-in (engine/page/post.mjs).
import { registries } from '../registry.mjs';
import '../cuts/index.mjs';

/** Thrown when a cut's shader will not compile or link. */
export class CutShaderError extends Error {}

const FROM_UNIT = 1;
const TO_UNIT = 2;

const VERTEX = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/** The fragment shader the wrapper makes of a body on the gl-transitions contract. */
export function wrapTransition(body) {
  return `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uFrom;
uniform sampler2D uTo;
uniform float progress;
uniform float ratio;
uniform vec2 uRes;
uniform uint uSeed;
out vec4 outColor;
vec4 getFromColor(vec2 uv) { return texture(uFrom, vec2(uv.x, 1.0 - uv.y)); }
vec4 getToColor(vec2 uv) { return texture(uTo, vec2(uv.x, 1.0 - uv.y)); }
uint mmPcg(uint v) {
  uint state = v * 747796405u + 2891336365u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
float mmHash(vec2 co) {
  uvec2 q = uvec2(ivec2(round(co * 1024.0)));
  return float(mmPcg(q.x ^ mmPcg(q.y ^ mmPcg(uSeed)))) / 4294967295.0;
}
${body}
void main() {
  // the row this fragment writes is the picture's row counted from the top, as the post pass reads its frame
  vec2 uv = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uRes;
  outColor = vec4(transition(uv).rgb, 1.0);
}`;
}

function compile(gl, name, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new CutShaderError(`shader cut "${name}": the ${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'} shader did not compile: ${gl.getShaderInfoLog(shader)}`);
  }
  return shader;
}

// How to set a uniform of each GL type from a number or a list of numbers.
const SETTERS = {
  FLOAT: (gl, at, v) => gl.uniform1f(at, v),
  FLOAT_VEC2: (gl, at, v) => gl.uniform2fv(at, v),
  FLOAT_VEC3: (gl, at, v) => gl.uniform3fv(at, v),
  FLOAT_VEC4: (gl, at, v) => gl.uniform4fv(at, v),
  INT: (gl, at, v) => gl.uniform1i(at, v),
  BOOL: (gl, at, v) => gl.uniform1i(at, v ? 1 : 0),
  INT_VEC2: (gl, at, v) => gl.uniform2iv(at, v),
  INT_VEC3: (gl, at, v) => gl.uniform3iv(at, v),
  INT_VEC4: (gl, at, v) => gl.uniform4iv(at, v),
  UNSIGNED_INT: (gl, at, v) => gl.uniform1ui(at, v),
  SAMPLER_2D: (gl, at, v) => gl.uniform1i(at, v),
};

// The active uniforms of `program`: name -> (value) => void, for the types SETTERS knows.
function uniformSetters(gl, program) {
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  const types = Object.fromEntries(Object.keys(SETTERS).map((key) => [gl[key], key]));
  const out = new Map();
  for (let i = 0; i < count; i++) {
    const { name, type } = gl.getActiveUniform(program, i);
    const setter = SETTERS[types[type]];
    if (setter) out.set(name, (value) => setter(gl, gl.getUniformLocation(program, name), value));
  }
  return out;
}

function buildProgram(gl, name, body, { seed, width, height }) {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, name, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl, name, gl.FRAGMENT_SHADER, wrapTransition(body)));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new CutShaderError(`shader cut "${name}": the shader did not link: ${gl.getProgramInfoLog(program)}`);
  gl.useProgram(program);
  const set = uniformSetters(gl, program);
  set.get('uFrom')?.(FROM_UNIT);
  set.get('uTo')?.(TO_UNIT);
  set.get('uRes')?.([width, height]);
  set.get('uSeed')?.(seed >>> 0);
  return { program, set };
}

function texture(gl, filter) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  for (const [name, value] of [[gl.TEXTURE_MIN_FILTER, filter], [gl.TEXTURE_MAG_FILTER, filter], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) {
    gl.texParameteri(gl.TEXTURE_2D, name, value);
  }
  return t;
}

// The texture the transition is drawn into, as the colour attachment of its own framebuffer.
function target(gl, width, height) {
  const t = texture(gl, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`post pass: the shader cuts' framebuffer is incomplete (0x${status.toString(16)})`);
  return { texture: t, framebuffer };
}

function upload(gl, unit, tex, picture) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, picture);
}

/**
 * @param {WebGL2RenderingContext} gl the post pass's context
 * @param {{ names: string[], seed: number, width: number, height: number }} options the shader cuts the film uses
 * @returns {{ draw({ from, to, shader, params }): WebGLTexture }} draw runs cut `shader` with `params` (its uniforms,
 *   engine/cuts/shaders shaderUniforms) over the pictures `from` and `to` and returns the texture it drew into. It leaves
 *   the framebuffer, the program and the texture units for the caller to set again.
 */
export function createCutPass(gl, { names, seed, width, height }) {
  const programs = new Map(names.map((name) => [name, buildProgram(gl, name, registries.cuts.get(name).shader.source, { seed, width, height })]));
  const from = texture(gl, gl.LINEAR);
  const to = texture(gl, gl.LINEAR);
  const out = target(gl, width, height);
  return {
    draw({ from: fromPicture, to: toPicture, shader, params }) {
      const built = programs.get(shader);
      if (!built) throw new Error(`post pass: shader cut "${shader}" was not compiled for this film`);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, null); // the target must not be bound to a sampler while it is drawn into
      upload(gl, FROM_UNIT, from, fromPicture);
      upload(gl, TO_UNIT, to, toPicture);
      gl.useProgram(built.program);
      for (const [name, value] of Object.entries(params)) built.set.get(name)?.(value);
      gl.bindFramebuffer(gl.FRAMEBUFFER, out.framebuffer);
      gl.viewport(0, 0, width, height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return out.texture;
    },
  };
}

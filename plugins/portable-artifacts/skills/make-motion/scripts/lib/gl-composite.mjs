// The Node side of gl-ripple and gl-cube (template/gl-transitions.mjs). Inside a GL transition window render.mjs shoots the
// outgoing and the incoming scene layer separately (the page can show one layer alone: window.__motion.seek(sec, layer)),
// and a second page of a second browser runs the fragment shader over the two PNGs; a screenshot of its canvas is the frame.
// The second browser is launched with software WebGL (swiftshader: the spike, test/webgl-spike.test.mjs, hashed the same
// frame on macOS and Ubuntu); the page that draws the scenes keeps its own launch arguments, so a render without a GL
// transition is exactly what it was. Nothing here touches the network: the images go in as base64 and the page is built
// from a string, and guardNetwork refuses anything else.
import { launchBrowser, guardNetwork } from './browser.mjs';
import { boundPage, frameLimit } from './ready.mjs';
import { doctorCommand, npxInstallChromium } from './doctor-hint.mjs';
import { GL_TRANSITIONS, GL_VERTEX, glFragment, glUniforms } from '../../template/gl-transitions.mjs';

export { usesGl } from '../../template/gl-transitions.mjs';

// ANGLE's software Vulkan (no GPU), allowed to be the WebGL backend (current Chromium refuses it otherwise), whatever the
// blocklist says. These are the arguments of the spike that was hashed on both runners.
export const GL_BROWSER_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

const NO_WEBGL = `WebGL is not available in this browser (software rendering with swiftshader failed to start), and gl-ripple and gl-cube need it; use push or crossfade instead, or reinstall Chromium: ${npxInstallChromium()} (doctor: ${doctorCommand()}, id chromium)`;
const BLOCKED_ORIGIN = 'http://127.0.0.1'; // the page is built from a string: it has no origin to allow, so every request is refused

// Runs in the compositing page. `window.__glOk` says whether a WebGL context exists; `window.__compose(type, uniforms, from, to)`
// draws one frame from two base64 PNGs of the canvas's size. Textures are read without colour conversion or premultiplying and
// filtered linearly; the shaders ask for the centre of a pixel, so an untouched pixel comes out as it went in.
const PAGE_SCRIPT = `
const canvas = document.getElementById('c');
const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: true });
window.__glOk = Boolean(gl);
if (gl) {
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(shader));
    return shader;
  };
  const programs = new Map();
  const programOf = (type) => {
    if (!programs.has(type)) {
      const program = gl.createProgram();
      gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENTS[type]));
      gl.bindAttribLocation(program, 0, 'aPos');
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('shader link: ' + gl.getProgramInfoLog(program));
      programs.set(type, program);
    }
    return programs.get(type);
  };
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  const textures = [0, 1].map((unit) => {
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  });
  const upload = async (unit, base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    if (bitmap.width !== canvas.width || bitmap.height !== canvas.height) {
      throw new Error('layer image is ' + bitmap.width + 'x' + bitmap.height + ', the canvas ' + canvas.width + 'x' + canvas.height);
    }
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, textures[unit]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    bitmap.close();
  };
  window.__compose = async (type, uniforms, from, to) => {
    await upload(0, from);
    await upload(1, to);
    const program = programOf(type);
    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, 'uFrom'), 0);
    gl.uniform1i(gl.getUniformLocation(program, 'uTo'), 1);
    gl.uniform2f(gl.getUniformLocation(program, 'uRes'), canvas.width, canvas.height);
    for (const [name, value] of Object.entries(uniforms)) {
      const at = gl.getUniformLocation(program, name);
      if (at === null) throw new Error('shader ' + type + ' has no uniform ' + name);
      if (Array.isArray(value)) gl.uniform2f(at, value[0], value[1]);
      else gl.uniform1f(at, value);
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.finish();
  };
}
`;

const compositingPage = ([width, height]) => `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:#000;overflow:hidden}canvas{display:block}</style>
<canvas id="c" width="${width}" height="${height}"></canvas>
<script>
const VERTEX = ${JSON.stringify(GL_VERTEX)};
const FRAGMENTS = ${JSON.stringify(Object.fromEntries(GL_TRANSITIONS.map((type) => [type, glFragment(type)])))};
${PAGE_SCRIPT}
</script>`;

/**
 * A compositor for frames of `size` [w, h]: `composite(k, fromPng, toPng, { type, direction, p })` returns the PNG of one
 * frame, drawn on page `k` (one per capture page, so parallel workers never wait on each other). The browser and a page
 * are launched on first use, so a render without a GL window never starts them. `composed` counts the frames drawn;
 * `close()` is safe at any time. `args`: the browser's launch arguments (tests pass ones that leave WebGL out); `onBlock`:
 * told of every request the page makes (none is allowed through).
 */
export function createCompositor({ size, onBlock = (url) => process.stderr.write(`blocked network request: ${url}\n`), args = GL_BROWSER_ARGS }) {
  let browser = null;
  const pages = new Map();
  let composed = 0;

  const open = async (k) => {
    browser ??= launchBrowser({ quiet: true, ownSignals: true, args });
    const raw = await (await browser).newPage({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1 });
    raw.on('pageerror', (e) => process.stderr.write(`page error: ${e.message}\n`));
    await guardNetwork(raw, BLOCKED_ORIGIN, onBlock);
    await raw.setContent(compositingPage(size));
    if (!(await raw.evaluate(() => window.__glOk))) throw new Error(NO_WEBGL);
    return boundPage(raw, { ms: frameLimit(), hint: `; the WebGL compositing page ${k}` });
  };

  return {
    get composed() { return composed; },
    async composite(k, fromPng, toPng, { type, direction, p }) {
      if (!pages.has(k)) pages.set(k, open(k));
      const page = await pages.get(k);
      const uniforms = glUniforms({ type, direction, p }, size);
      await page.evaluate(([name, values, from, to]) => window.__compose(name, values, from, to), [type, uniforms, fromPng.toString('base64'), toPng.toString('base64')]);
      composed++;
      return page.screenshot({ type: 'png' });
    },
    async close() {
      if (!browser) return;
      const launched = await browser.catch(() => null); // a launch that failed has nothing to close
      browser = null;
      pages.clear();
      await launched?.close();
    },
  };
}

// Runs in the scene page: seek (to `layer` alone when it is a GL window and one is named), say which GL window the time fell
// in, and put the contact-sheet stamp on a frame that is drawn as it is (a composed frame would warp it). Its source holds
// `.seek(` with the time first in its argument, which is how boundPage knows the time of a frame that did not finish.
const SEEK = async ([sec, layer, text]) => {
  await window.__motion.seek(sec, layer ?? undefined);
  const inWindow = window.__motion.glState();
  if (text !== null) window.__motion.stamp(inWindow ? '' : text);
  return inWindow;
};

/**
 * The PNG of the frame at `sec` from scene page `page`: a plain screenshot outside a GL window, the outgoing layer alone at
 * the window's first frame (progress 0), the incoming layer alone from its end (progress 1), and in between the two layers
 * composed by `compositor` on its page `k`. `stamp`: a contact sheet's label, set when the frame is not composed.
 */
export async function takeFrame({ page, compositor, k }, sec, stamp) {
  const state = await page.evaluate(SEEK, [sec, null, stamp ?? null]);
  if (!state) return page.screenshot({ type: 'png' });
  const shoot = async (layer) => {
    await page.evaluate(SEEK, [sec, layer, null]);
    return page.screenshot({ type: 'png' });
  };
  if (state.p <= 0) return shoot('outgoing');
  if (state.p >= 1) return shoot('incoming');
  const from = await shoot('outgoing');
  const to = await shoot('incoming');
  return compositor.composite(k, from, to, state);
}

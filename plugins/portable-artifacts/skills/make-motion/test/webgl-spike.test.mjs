// Task 29 spike: does a software WebGL (swiftshader) canvas screenshot hash the same twice in a run, and the same
// across runners? Runs only with PA_WEBGL_SPIKE=1. The CI workflow prints one `webgl-spike: <platform> <sha>` line per
// runner (macOS job and the Ubuntu node job); the owner compares them. Equal -> gl transitions may ship; different -> drop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const SIZE = 256;
// --use-angle=swiftshader: ANGLE's software Vulkan, no GPU. --enable-unsafe-swiftshader: current Chromium refuses the
// software fallback for WebGL without it. --disable-partial-raster matches scripts/lib/browser.mjs.
const ARGS = ['--disable-partial-raster', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

const PAGE = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#000}canvas{display:block}</style>
<canvas id="c" width="${SIZE}" height="${SIZE}"></canvas>
<script>
const gl = document.getElementById('c').getContext('webgl', { antialias: false, preserveDrawingBuffer: true });
if (!gl) throw new Error('no webgl');
const compile = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
const program = (vs, fs) => { const p = gl.createProgram(); gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p; };
// 1: a full-screen gradient. 2: a triangle rotated 0.6 rad, drawn over it.
const grad = program('attribute vec2 p; varying vec2 v; void main(){ v = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }',
  'precision mediump float; varying vec2 v; void main(){ gl_FragColor = vec4(v.x, v.y, 1.0 - v.x * 0.5, 1.0); }');
const tri = program('attribute vec2 p; uniform float a; void main(){ gl_Position = vec4(p.x * cos(a) - p.y * sin(a), p.x * sin(a) + p.y * cos(a), 0.0, 1.0); }',
  'precision mediump float; void main(){ gl_FragColor = vec4(0.95, 0.65, 0.35, 1.0); }');
const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
const draw = (prog, data, mode) => { gl.useProgram(prog); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  return loc; };
draw(grad, [-1, -1, 1, -1, -1, 1, 1, 1]); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
draw(tri, [0.0, 0.6, -0.5, -0.4, 0.5, -0.4]); gl.uniform1f(gl.getUniformLocation(tri, 'a'), 0.6); gl.drawArrays(gl.TRIANGLES, 0, 3);
gl.finish();
window.__ready = true;
</script>`;

const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');

test('webgl spike: a swiftshader canvas screenshots to the same bytes twice, and prints its hash', async (t) => {
  if (process.env.PA_WEBGL_SPIKE !== '1') return t.skip('set PA_WEBGL_SPIKE=1 to run the WebGL determinism spike');
  const hashes = [];
  for (let run = 0; run < 2; run++) {
    const browser = await chromium.launch({ args: ARGS });
    try {
      const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
      await page.setContent(PAGE);
      await page.waitForFunction(() => window.__ready === true);
      hashes.push(sha(await page.locator('#c').screenshot()));
      hashes.push(sha(await page.locator('#c').screenshot()));
    } finally {
      await browser.close();
    }
  }
  assert.ok(hashes.every((h) => h === hashes[0]), `screenshots differ within one runner: ${hashes.join(' ')}`);
  process.stdout.write(`webgl-spike: ${process.platform} ${hashes[0]}\n`);
});

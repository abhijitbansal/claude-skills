// Look review gate-cuts-1 PF3, lead ruling 3: in the middle third of a cut that lays the two pictures over each other
// (whole, or interleaved in dots, slats, rows or rings), only one picture's words read at a time. Each shot is white
// paper with one block of ink in the same place, red going out and blue coming in; read off the visible canvas, the
// block must not be strongly red and strongly blue at once. One browser at a time: run with --test-concurrency=1; skips
// without a browser, and the shader cuts without WebGL2.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionOrNull } from './helpers/session.mjs';

const FPS = 30;
const START = 30; // shot b's first frame: shot a holds 1 s
const ZERO = { grain: 0, halftone: 0, bloom: 0 };
const STRONG = 0.3; // a mean ink strength over the block above this reads as words
const MIDDLE = [0.4, 0.5, 0.6];
const BLOCK = [560, 390, 800, 300]; // x, y, w, h
const block = (id, fill) => ({ type: 'path', id, props: { d: `M${BLOCK[0]} ${BLOCK[1]}h${BLOCK[2]}v${BLOCK[3]}h-${BLOCK[2]}Z`, fill } });
const shot = (id, fill, cut) => ({ id, show: 'free', hold: 1, background: '#ffffff', nodes: [block(`${id}.ink`, fill)], ...(cut ? { cut } : {}) });
const film = (cut) => ({ version: 2, mode: 'pro', look: 'desk', fps: FPS, seed: 1, shots: [shot('a', '#ff0000'), shot('b', '#0000ff', cut)] });

// The mean red and blue ink over the block, each 0 (paper) to 1 (full ink), at progress p of the window.
const inkAt = (s, p) => s.page.evaluate(([i, q, [x0, y0, w, h]]) => {
  window.__seek(i, { progress: q });
  const stage = document.getElementById('stage');
  const copy = new OffscreenCanvas(stage.width, stage.height);
  const ctx = copy.getContext('2d');
  ctx.drawImage(stage, 0, 0);
  const { data } = ctx.getImageData(x0, y0, w, h);
  let red = 0, blue = 0;
  for (let k = 0; k < data.length; k += 4) {
    red += Math.max(0, data[k] - data[k + 1]) / 255;
    blue += Math.max(0, data[k + 2] - data[k + 1]) / 255;
  }
  const n = data.length / 4;
  return { red: red / n, blue: blue / n };
}, [START, p, BLOCK]);

const LAYER = ['crossfade', 'zoom', 'blur'];
const SHADER = ['ripple', 'polka-dots', 'glitch-memories', 'water-drop', 'cross-warp', 'window-slices', 'wind', 'page-curl'];

for (const name of [...LAYER, ...SHADER]) {
  test(`${name}: in the middle third the block is never red and blue at once`, async (t) => {
    const session = await sessionOrNull(film(name));
    if (!session) return t.skip('no browser');
    t.after(() => session.close());
    if (SHADER.includes(name) && session.info.post !== 'webgl2') return t.skip('this browser has no WebGL2');
    await session.page.evaluate((zero) => window.__setPost(zero), ZERO);
    for (const p of MIDDLE) {
      const { red, blue } = await inkAt(session, p);
      assert.ok(!(red > STRONG && blue > STRONG), `${name} p ${p}: red ${red.toFixed(2)}, blue ${blue.toFixed(2)}`);
    }
  });
}

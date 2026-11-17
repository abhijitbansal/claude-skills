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

// The share of the block's pixels that are plainly red (outgoing ink) and plainly blue (incoming ink) at progress p: a
// mean over the block cannot see a mask (dots, a curl, a drop) that keeps whole patches of one picture, a count can.
const PLAIN = 128; // a channel this far over green is plainly that colour's ink, not paper, ground or a blend's edge
const patchesAt = (s, p) => s.page.evaluate(([i, q, [x0, y0, w, h], plain]) => {
  window.__seek(i, { progress: q });
  const stage = document.getElementById('stage');
  const copy = new OffscreenCanvas(stage.width, stage.height);
  const ctx = copy.getContext('2d');
  ctx.drawImage(stage, 0, 0);
  const { data } = ctx.getImageData(x0, y0, w, h);
  let red = 0, blue = 0;
  for (let k = 0; k < data.length; k += 4) {
    // plainly one ink over both other channels: a glitch's split channels (magenta, cyan edges) are neither
    const [r, g, b] = [data[k], data[k + 1], data[k + 2]];
    if (r - g > plain && r - b > plain) red += 1;
    if (b - g > plain && b - r > plain) blue += 1;
  }
  return { red: red / (data.length / 4), blue: blue / (data.length / 4) };
}, [START, p, BLOCK, PLAIN]);

// Round 2 ruling 6: the outgoing picture is cleared by p 0.5 in every one of these cuts (layers.mjs CLEAR_OUT, the
// shaders' MIXED_CLEAR) and the incoming one starts at p 0.3 (layers) or 0.4 (shaders): so just after the one, and just
// before the other, the block holds no patch of that picture at all.
const GONE_BY = 0.55;
const NOT_YET = 0.25;
const STRAY = 0.002; // the share of the block a few edge pixels may take
// and through the middle, where a wipe-like mask (a curl, a drop's ring) crosses the block, never a plain patch of each
const PATCH_STEPS = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6];

const LAYER = ['crossfade', 'zoom', 'blur'];
// window-slices is not here since round 2: it is a slatted wipe with no clear window (window-slices.mjs), and like the
// wipe it shows the two pictures either side of its moving edge; cuts-round2-browser checks its slats instead.
const SHADER = ['ripple', 'polka-dots', 'glitch-memories', 'water-drop', 'cross-warp', 'wind', 'page-curl'];

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
    const gone = await patchesAt(session, GONE_BY);
    assert.ok(gone.red <= STRAY, `${name} p ${GONE_BY}: ${(gone.red * 100).toFixed(2)}% of the block is still outgoing ink`);
    const early = await patchesAt(session, NOT_YET);
    assert.ok(early.blue <= STRAY, `${name} p ${NOT_YET}: ${(early.blue * 100).toFixed(2)}% of the block is already incoming ink`);
    for (const p of PATCH_STEPS) {
      const { red, blue } = await patchesAt(session, p);
      assert.ok(red <= STRAY || blue <= STRAY, `${name} p ${p}: plain outgoing ink on ${(red * 100).toFixed(2)}% and plain incoming ink on ${(blue * 100).toFixed(2)}% of the block at once`);
    }
  });
}

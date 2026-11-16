// The cosmos sun drawn by the real draw layer in the browser while it lights (gate review 3: a half-faded disc read as
// a grey planet on the sheets): on every frame of its lift, the pixel at its centre is the hot near-white core, never a
// grey or lavender mix of the gold and the field. Run with --test-concurrency=1.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openStage } from './helpers/stage.mjs';

const FILM = { version: 2, mode: 'pro', look: 'cosmos', format: '16:9', fps: 30, seed: 1, shots: [{ id: 's', show: 'statement', hold: 1, text: 'Sun' }] };

let stage = null;
before(async () => { stage = await openStage(FILM); });
after(async () => { if (stage) await stage.close(); });

// The sun lighting from t = 0.1 s, drawn on the field's deep colour at times across its lift; the centre pixel's
// channels at each, and the look's lift.
function centrePixels() {
  return stage.page.evaluate(async () => {
    const { registries } = await import('/engine/registry.mjs');
    await import('/engine/looks/index.mjs');
    const { sampleGraph } = await import('/engine/graph/sample.mjs');
    const { drawFrame } = await import('/engine/page/draw.mjs');
    const { sunNodes } = await import('/engine/devices/sun.mjs');
    const look = registries.looks.get('cosmos');
    const size = 400, at = 0.1;
    const nodes = sunNodes('sun', look, { cx: size / 2, cy: size / 2, r: 180, at });
    const times = Array.from({ length: 12 }, (_, i) => at + ((i + 1) / 12) * look.sun.lift);
    return times.map((t) => {
      const c = new OffscreenCanvas(size, size).getContext('2d');
      c.fillStyle = look.palette.deep;
      c.fillRect(0, 0, size, size);
      drawFrame(c, sampleGraph(nodes, t), { canvas: { w: size, h: size } });
      const [r, g, b] = c.getImageData(size / 2, size / 2, 1, 1).data;
      return { t, r, g, b };
    });
  });
}

test('sun: every frame of its lift shows a hot core at its centre (never a grey or lavender disc)', async (t) => {
  if (!stage) return t.skip('no browser');
  for (const { t: at, r, g, b } of await centrePixels()) {
    assert.ok(r >= 240 && g >= 220 && b >= 180, `at ${at.toFixed(2)} s the centre is rgb(${r}, ${g}, ${b})`);
  }
});
